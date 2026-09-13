import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { Scene } from '../entities/scene.entity';
import { SceneAction } from '../entities/scene-action.entity';
import {
  ExecutionStatusValue,
  SceneExecution,
  TriggerType,
} from '../entities/scene-execution.entity';
import { CommandDispatcherService, DispatchInput } from './command-dispatcher.service';
import { OperationLogService } from '../modules/logs/operation-log.service';
import { ControlBus, SceneExecutionEventName } from './control-bus';
import { AbortedError, sleep } from '../adapters/adapter.types';
import { AdapterConnectionRegistry } from '../adapters/connection-registry';

export interface ExecutionFailure {
  deviceType: string;
  deviceId: string;
  command: string;
  error: string;
  attempts: number;
}

export interface SceneExecutionSnapshot {
  executionId: string;
  sceneId: number;
  sceneCode: string;
  sceneName: string;
  triggerType: TriggerType;
  triggerSource: string;
  status: ExecutionStatusValue;
  startedAt?: string;
  finishedAt?: string;
  totalActions: number;
  succeeded: number;
  failed: number;
  failures: ExecutionFailure[];
  durationMs: number;
}

export interface ExecuteOptions {
  triggerType?: TriggerType;
  triggerSource?: string;
  force?: boolean;
}

interface RunningHandle {
  snapshot: SceneExecutionSnapshot;
  record: SceneExecution;
  controller: AbortController;
  scene: Scene;
}

interface QueueItem {
  scene: Scene;
  record: SceneExecution;
  controller: AbortController;
  resolve: (snap: SceneExecutionSnapshot) => void;
  reject: (err: Error) => void;
}

// 场景执行的 fail-fast 策略 (2026-05-30 用户反馈):
//   - 网关 offline 的设备直接跳过, 不浪费 3s connect timeout
//   - 单次失败不再重试 (老的 3 次 × 1s 间隔 = 9s 浪费一个 action 太蠢)
//   - "尽快启动场景, 找不到设备就过去" — 失败动作的明细落 OperationLog,
//     不阻塞场景结束
const MAX_ACTION_RETRIES = 1;
const RETRY_DELAY_MS = 0; // 没用了, 留着兼容旧代码引用

@Injectable()
export class SceneEngineService {
  /** 正在执行的场景 (key=sceneCode) — 并发锁 */
  private readonly running = new Map<string, RunningHandle>();
  /** FIFO 队列 — 避免设备命令并发冲突 */
  private readonly queue: QueueItem[] = [];
  private queueWorkerActive = false;

  constructor(
    @InjectRepository(Scene) private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(SceneExecution)
    private readonly executionRepo: Repository<SceneExecution>,
    private readonly dispatcher: CommandDispatcherService,
    private readonly logService: OperationLogService,
    private readonly bus: ControlBus,
    private readonly registry: AdapterConnectionRegistry,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * Fail-fast pre-check: 看 deviceType 对应的网关在 registry 里是不是全 offline.
   *
   * - lighting → 任何 lighting-* 网关在线就算
   * - led → 任何 led-* 网关在线就算
   * - audio → 任何 audio-* 网关在线就算
   * - hvac / hvac-zone → 任何 hvac-* 网关在线就算 (单 device 走特定 gwHost 会
   *   在底层失败, 但场景级别我们不预测哪台具体网关挂)
   *
   * 没注册任何匹配网关 (mock 模式 / 启动早期) → 返回 true 让它正常派发, 不阻塞.
   */
  private isAnyGatewayOnline(deviceType: string): boolean {
    const prefix = deviceType.startsWith('hvac') ? 'hvac-' : `${deviceType}-`;
    const matching = this.registry.list().filter((g) => g.gateway.startsWith(prefix));
    if (matching.length === 0) return true;
    return matching.some((g) => g.state === 'online' || g.state === 'reconnecting');
  }

  // ---------- 公共查询 ----------

  listRunning(): SceneExecutionSnapshot[] {
    return Array.from(this.running.values()).map((h) => h.snapshot);
  }

  getRunning(sceneCode: string): SceneExecutionSnapshot | undefined {
    return this.running.get(sceneCode)?.snapshot;
  }

  listQueued(): Array<{ executionId: string; sceneCode: string; sceneName: string; triggerSource: string }> {
    return this.queue.map((q) => ({
      executionId: q.record.executionId,
      sceneCode: q.scene.code,
      sceneName: q.scene.name,
      triggerSource: q.record.triggerSource,
    }));
  }

  // ---------- 触发执行 ----------

  async execute(sceneCode: string, operator = 'system', opts: ExecuteOptions = {}): Promise<SceneExecutionSnapshot> {
    const triggerType = opts.triggerType ?? 'manual';
    const triggerSource = opts.triggerSource ?? operator;

    const scene = await this.sceneRepo.findOne({ where: { code: sceneCode } });
    if (!scene) throw new NotFoundException(`场景不存在: ${sceneCode}`);
    if (!scene.enabled) throw new ConflictException(`场景已禁用: ${sceneCode}`);

    if (!opts.force) {
      if (this.running.has(sceneCode)) {
        throw new ConflictException(`该场景正在执行中: ${sceneCode}`);
      }
      if (this.queue.some((q) => q.scene.code === sceneCode)) {
        throw new ConflictException(`该场景已在执行队列中: ${sceneCode}`);
      }
    }

    const executionId = randomUUID();
    const totalActions = (scene.actions ?? []).filter((a) => a.enabled).length;
    const record = this.executionRepo.create({
      executionId,
      sceneCode: scene.code,
      sceneName: scene.name,
      triggerType,
      triggerSource,
      status: 'pending',
      totalActions,
      successCount: 0,
      failedCount: 0,
      durationMs: 0,
    });
    await this.executionRepo.save(record);

    const controller = new AbortController();
    const snap: SceneExecutionSnapshot = {
      executionId,
      sceneId: scene.id,
      sceneCode: scene.code,
      sceneName: scene.name,
      triggerType,
      triggerSource,
      status: 'pending',
      totalActions,
      succeeded: 0,
      failed: 0,
      failures: [],
      durationMs: 0,
    };

    this.queue.push({
      scene,
      record,
      controller,
      resolve: () => undefined,
      reject: () => undefined,
    });
    void this.kickQueue();
    return snap;
  }

  // ---------- 取消 ----------

  async cancel(sceneCode: string, operator = 'system'): Promise<SceneExecutionSnapshot> {
    const handle = this.running.get(sceneCode);
    if (handle) {
      handle.controller.abort();
      handle.snapshot.status = 'cancelled';
      this.logger.info(`Scene cancel: ${sceneCode} (running)`, { context: 'SceneEngine' });
      await this.logService.record({
        operator,
        action: 'scene.cancel',
        targetType: 'scene',
        targetId: String(handle.scene.id),
        result: 'success',
        message: handle.scene.code,
      });
      return handle.snapshot;
    }
    const idx = this.queue.findIndex((q) => q.scene.code === sceneCode);
    if (idx >= 0) {
      const item = this.queue.splice(idx, 1)[0];
      item.record.status = 'cancelled';
      item.record.finishedAt = new Date();
      await this.executionRepo.save(item.record);
      this.publishExecutionEvent('scene_execution_cancelled', item.scene, item.record, {
        totalActions: item.record.totalActions,
        successCount: 0,
        failedCount: 0,
      });
      await this.logService.record({
        operator,
        action: 'scene.cancel',
        targetType: 'scene',
        targetId: String(item.scene.id),
        result: 'success',
        message: `${item.scene.code} (queued)`,
      });
      this.logger.info(`Scene cancel: ${sceneCode} (queued)`, { context: 'SceneEngine' });
      return {
        executionId: item.record.executionId,
        sceneId: item.scene.id,
        sceneCode: item.scene.code,
        sceneName: item.scene.name,
        triggerType: item.record.triggerType,
        triggerSource: item.record.triggerSource,
        status: 'cancelled',
        totalActions: item.record.totalActions,
        succeeded: 0,
        failed: 0,
        failures: [],
        durationMs: 0,
      };
    }
    throw new NotFoundException(`场景未在执行或队列中: ${sceneCode}`);
  }

  /** 兼容 Sprint-03 接口名 */
  stop(sceneCode: string, operator = 'system'): Promise<SceneExecutionSnapshot> {
    return this.cancel(sceneCode, operator);
  }

  // ---------- 队列 worker ----------

  private async kickQueue(): Promise<void> {
    if (this.queueWorkerActive) return;
    this.queueWorkerActive = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) break;
        try {
          await this.runOne(item);
        } catch (err) {
          this.logger.error(`Queue worker error: ${(err as Error).message}`, {
            context: 'SceneEngine',
          });
        }
      }
    } finally {
      this.queueWorkerActive = false;
    }
  }

  private async runOne(item: QueueItem): Promise<void> {
    const { scene, record, controller } = item;
    if (controller.signal.aborted) return;

    const enabledActions = (scene.actions ?? []).filter((a) => a.enabled);
    record.startedAt = new Date();
    record.status = 'running';
    record.totalActions = enabledActions.length;
    await this.executionRepo.save(record);

    const snapshot: SceneExecutionSnapshot = {
      executionId: record.executionId,
      sceneId: scene.id,
      sceneCode: scene.code,
      sceneName: scene.name,
      triggerType: record.triggerType,
      triggerSource: record.triggerSource,
      status: 'running',
      startedAt: record.startedAt.toISOString(),
      totalActions: enabledActions.length,
      succeeded: 0,
      failed: 0,
      failures: [],
      durationMs: 0,
    };
    const handle: RunningHandle = { snapshot, record, controller, scene };
    this.running.set(scene.code, handle);

    this.bus.publish({
      type: 'scene',
      scene: scene.code,
      executionId: record.executionId,
      status: 'running',
      failures: 0,
      at: new Date().toISOString(),
    });
    this.publishExecutionEvent('scene_execution_started', scene, record, {
      totalActions: enabledActions.length,
      successCount: 0,
      failedCount: 0,
    });

    this.logger.info(
      `Scene execute begin: ${scene.code} executionId=${record.executionId} actions=${enabledActions.length} trigger=${record.triggerType}:${record.triggerSource}`,
      { context: 'SceneEngine' },
    );

    try {
      const groups = this.groupBySortOrder(enabledActions);
      for (const group of groups) {
        if (controller.signal.aborted) break;
        await this.runGroup(handle, group);
      }
    } catch (err) {
      this.logger.error(
        `Scene engine internal error: ${(err as Error).message}`,
        { context: 'SceneEngine' },
      );
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - record.startedAt.getTime();
    let finalStatus: ExecutionStatusValue;
    if (controller.signal.aborted) {
      finalStatus = 'cancelled';
    } else if (snapshot.failed === 0 && snapshot.succeeded === enabledActions.length) {
      finalStatus = 'success';
    } else if (snapshot.succeeded === 0 && snapshot.failed > 0) {
      finalStatus = 'failed';
    } else if (snapshot.failed > 0) {
      finalStatus = 'partial_failed';
    } else {
      // 都是 0 (空动作集) 视为 success
      finalStatus = 'success';
    }

    snapshot.status = finalStatus;
    snapshot.finishedAt = finishedAt.toISOString();
    snapshot.durationMs = durationMs;

    record.status = finalStatus;
    record.finishedAt = finishedAt;
    record.durationMs = durationMs;
    record.successCount = snapshot.succeeded;
    record.failedCount = snapshot.failed;
    record.resultSummary = JSON.stringify({
      failures: snapshot.failures,
      sceneCode: scene.code,
    });
    try {
      await this.executionRepo.save(record);
    } catch (err) {
      this.logger.error(`Failed to persist SceneExecution: ${(err as Error).message}`, {
        context: 'SceneEngine',
      });
    }

    const endEvent: SceneExecutionEventName = (() => {
      switch (finalStatus) {
        case 'success': return 'scene_execution_success';
        case 'partial_failed': return 'scene_execution_partial_failed';
        case 'failed': return 'scene_execution_failed';
        case 'cancelled': return 'scene_execution_cancelled';
        default: return 'scene_execution_failed';
      }
    })();
    this.publishExecutionEvent(endEvent, scene, record, {
      totalActions: snapshot.totalActions,
      successCount: snapshot.succeeded,
      failedCount: snapshot.failed,
      durationMs,
    });
    this.bus.publish({
      type: 'scene',
      scene: scene.code,
      executionId: record.executionId,
      status: finalStatus === 'success' ? 'completed' : finalStatus === 'cancelled' ? 'stopped' : 'failed',
      failures: snapshot.failed,
      at: finishedAt.toISOString(),
    });

    await this.logService.record({
      operator: record.triggerSource || 'system',
      action: record.triggerType === 'schedule' ? 'scene.execute.scheduled' : 'scene.execute',
      targetType: 'scene',
      targetId: String(scene.id),
      result: finalStatus === 'success' ? 'success' : 'failure',
      message: JSON.stringify({
        executionId: record.executionId,
        sceneCode: scene.code,
        status: finalStatus,
        total: snapshot.totalActions,
        succeeded: snapshot.succeeded,
        failed: snapshot.failed,
        durationMs,
        triggerType: record.triggerType,
        triggerSource: record.triggerSource,
        failures: snapshot.failures,
      }),
    });

    this.logger.info(
      `Scene execute end: ${scene.code} status=${finalStatus} ok=${snapshot.succeeded} fail=${snapshot.failed} duration=${durationMs}ms`,
      { context: 'SceneEngine' },
    );

    this.running.delete(scene.code);
    item.resolve(snapshot);
  }

  private async runGroup(handle: RunningHandle, group: SceneAction[]): Promise<void> {
    const tasks = group.map(async (action) => {
      if (handle.controller.signal.aborted) return;
      try {
        if (action.delayMs > 0) {
          await sleep(action.delayMs, handle.controller.signal);
        }
      } catch (err) {
        if (err instanceof AbortedError) return;
        throw err;
      }
      if (handle.controller.signal.aborted) return;

      const params = this.parseParams(action.params);
      const result = await this.dispatchWithRetry(action, params, handle);

      if (result.ok) {
        handle.snapshot.succeeded += 1;
      } else {
        handle.snapshot.failed += 1;
        handle.snapshot.failures.push({
          deviceType: action.deviceType,
          deviceId: action.deviceId,
          command: action.command,
          error: result.error ?? 'unknown',
          attempts: result.attempts,
        });
      }

      this.publishExecutionEvent('scene_execution_progress', handle.scene, handle.record, {
        totalActions: handle.snapshot.totalActions,
        successCount: handle.snapshot.succeeded,
        failedCount: handle.snapshot.failed,
        step: `${action.deviceType}.${action.command} on ${action.deviceId} -> ${result.ok ? 'ok' : 'fail'}`,
      });
      this.bus.publish({
        type: 'scene',
        scene: handle.scene.code,
        executionId: handle.record.executionId,
        status: 'action',
        step: `${action.deviceType}.${action.command} on ${action.deviceId} -> ${result.ok ? 'ok' : 'fail'}${result.error ? ': ' + result.error : ''}`,
        at: new Date().toISOString(),
      });
    });

    await Promise.allSettled(tasks);
  }

  private async dispatchWithRetry(
    action: SceneAction,
    params: Record<string, unknown>,
    handle: RunningHandle,
  ): Promise<{ ok: boolean; error?: string; attempts: number }> {
    // Fail-fast: 网关全 offline 直接跳过 (0 ms), 不浪费 3s connect timeout
    if (!this.isAnyGatewayOnline(action.deviceType)) {
      return { ok: false, error: 'skipped: gateway offline', attempts: 0 };
    }

    let lastError: string | undefined;
    for (let attempt = 1; attempt <= MAX_ACTION_RETRIES; attempt += 1) {
      if (handle.controller.signal.aborted) {
        return { ok: false, error: 'cancelled', attempts: attempt };
      }
      const input: DispatchInput = {
        deviceType: action.deviceType,
        deviceId: action.deviceId,
        command: action.command,
        params,
      };
      try {
        const result = await this.dispatcher.dispatch(input, {
          signal: handle.controller.signal,
          operator: handle.record.triggerSource,
          executionId: handle.record.executionId,
        });
        if (result.ok) {
          return { ok: true, attempts: attempt };
        }
        lastError = result.error ?? 'unknown';
      } catch (err) {
        lastError = (err as Error).message;
      }
      if (attempt < MAX_ACTION_RETRIES && RETRY_DELAY_MS > 0) {
        this.logger.warn(
          `Action retry ${attempt + 1}/${MAX_ACTION_RETRIES}: ${action.deviceType}.${action.command} on ${action.deviceId} -> ${lastError}`,
          { context: 'SceneEngine' },
        );
        try {
          await sleep(RETRY_DELAY_MS, handle.controller.signal);
        } catch {
          return { ok: false, error: 'cancelled', attempts: attempt };
        }
      }
    }
    return { ok: false, error: lastError ?? 'unknown', attempts: MAX_ACTION_RETRIES };
  }

  // ---------- 工具 ----------

  private groupBySortOrder(actions: SceneAction[]): SceneAction[][] {
    const sorted = [...actions].sort((a, b) => a.sortOrder - b.sortOrder);
    const groups: SceneAction[][] = [];
    let currentKey: number | null = null;
    let bucket: SceneAction[] = [];
    for (const a of sorted) {
      if (currentKey === null || a.sortOrder !== currentKey) {
        if (bucket.length > 0) groups.push(bucket);
        bucket = [];
        currentKey = a.sortOrder;
      }
      bucket.push(a);
    }
    if (bucket.length > 0) groups.push(bucket);
    return groups;
  }

  private parseParams(raw: string | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      this.logger.warn(`SceneAction.params 无法解析: ${raw}`, { context: 'SceneEngine' });
      return {};
    }
  }

  private publishExecutionEvent(
    type: SceneExecutionEventName,
    scene: Scene,
    record: SceneExecution,
    extra: {
      totalActions: number;
      successCount: number;
      failedCount: number;
      durationMs?: number;
      step?: string;
    },
  ): void {
    const statusMap: Record<SceneExecutionEventName, ExecutionStatusValue> = {
      scene_execution_started: 'running',
      scene_execution_progress: 'running',
      scene_execution_success: 'success',
      scene_execution_partial_failed: 'partial_failed',
      scene_execution_failed: 'failed',
      scene_execution_cancelled: 'cancelled',
    };
    this.bus.publish({
      type,
      executionId: record.executionId,
      sceneCode: scene.code,
      sceneName: scene.name,
      triggerType: record.triggerType,
      triggerSource: record.triggerSource,
      status: statusMap[type],
      totalActions: extra.totalActions,
      successCount: extra.successCount,
      failedCount: extra.failedCount,
      durationMs: extra.durationMs,
      step: extra.step,
      at: new Date().toISOString(),
    });
  }
}
