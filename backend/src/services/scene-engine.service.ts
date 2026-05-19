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
import { CommandDispatcherService, DispatchInput } from './command-dispatcher.service';
import { OperationLogService } from '../modules/logs/operation-log.service';
import { ControlBus } from './control-bus';
import { AbortedError, sleep } from '../adapters/adapter.types';

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';

export interface ExecutionFailure {
  deviceType: string;
  deviceId: string;
  command: string;
  error: string;
}

export interface SceneExecution {
  executionId: string;
  sceneId: number;
  sceneCode: string;
  sceneName: string;
  operator: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt?: string;
  totalActions: number;
  succeeded: number;
  failed: number;
  failures: ExecutionFailure[];
}

interface RunningHandle extends SceneExecution {
  controller: AbortController;
}

@Injectable()
export class SceneEngineService {
  private readonly running = new Map<string, RunningHandle>();

  constructor(
    @InjectRepository(Scene) private readonly sceneRepo: Repository<Scene>,
    private readonly dispatcher: CommandDispatcherService,
    private readonly logService: OperationLogService,
    private readonly bus: ControlBus,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  listRunning(): SceneExecution[] {
    return Array.from(this.running.values()).map(this.toPublic);
  }

  getRunning(sceneCode: string): SceneExecution | undefined {
    const h = this.running.get(sceneCode);
    return h ? this.toPublic(h) : undefined;
  }

  async execute(sceneCode: string, operator = 'system'): Promise<SceneExecution> {
    const scene = await this.sceneRepo.findOne({ where: { code: sceneCode } });
    if (!scene) throw new NotFoundException(`场景不存在: ${sceneCode}`);
    if (!scene.enabled) throw new ConflictException(`场景已禁用: ${sceneCode}`);
    if (this.running.has(sceneCode)) {
      throw new ConflictException(`场景正在执行中: ${sceneCode}`);
    }

    const enabledActions = (scene.actions ?? []).filter((a) => a.enabled);
    const handle: RunningHandle = {
      executionId: randomUUID(),
      sceneId: scene.id,
      sceneCode: scene.code,
      sceneName: scene.name,
      operator,
      status: 'running',
      startedAt: new Date().toISOString(),
      totalActions: enabledActions.length,
      succeeded: 0,
      failed: 0,
      failures: [],
      controller: new AbortController(),
    };
    this.running.set(sceneCode, handle);

    this.publishScene(handle, 'running');
    this.logger.info(
      `Scene execute begin: ${sceneCode} executionId=${handle.executionId} actions=${enabledActions.length}`,
      { context: 'SceneEngine' },
    );

    void this.runActions(handle, enabledActions);

    return this.toPublic(handle);
  }

  async stop(sceneCode: string, operator = 'system'): Promise<SceneExecution> {
    const handle = this.running.get(sceneCode);
    if (!handle) throw new NotFoundException(`场景未在执行: ${sceneCode}`);
    handle.controller.abort();
    handle.status = 'stopped';
    this.logger.info(`Scene stop requested: ${sceneCode}`, { context: 'SceneEngine' });
    await this.logService.record({
      operator,
      action: 'scene.stop',
      targetType: 'scene',
      targetId: String(handle.sceneId),
      result: 'success',
      message: handle.sceneCode,
    });
    return this.toPublic(handle);
  }

  private async runActions(handle: RunningHandle, actions: SceneAction[]): Promise<void> {
    const groups = this.groupBySortOrder(actions);

    try {
      for (const group of groups) {
        if (handle.controller.signal.aborted) break;
        await this.runGroup(handle, group);
      }
    } catch (err) {
      this.logger.error(
        `Scene engine internal error: ${(err as Error).message}`,
        { context: 'SceneEngine' },
      );
    }

    if (handle.status !== 'stopped') {
      handle.status = handle.failed > 0 ? 'failed' : 'completed';
    }
    handle.finishedAt = new Date().toISOString();

    this.publishScene(handle, handle.status);

    await this.logService.record({
      operator: handle.operator,
      action: 'scene.execute',
      targetType: 'scene',
      targetId: String(handle.sceneId),
      result: handle.failed > 0 || handle.status === 'stopped' ? 'failure' : 'success',
      message: JSON.stringify({
        executionId: handle.executionId,
        sceneCode: handle.sceneCode,
        status: handle.status,
        total: handle.totalActions,
        succeeded: handle.succeeded,
        failed: handle.failed,
        startedAt: handle.startedAt,
        finishedAt: handle.finishedAt,
        failures: handle.failures,
      }),
    });

    this.logger.info(
      `Scene execute end: ${handle.sceneCode} status=${handle.status} ok=${handle.succeeded} fail=${handle.failed}`,
      { context: 'SceneEngine' },
    );

    this.running.delete(handle.sceneCode);
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
      const input: DispatchInput = {
        deviceType: action.deviceType,
        deviceId: action.deviceId,
        command: action.command,
        params,
      };

      const result = await this.dispatcher.dispatch(input, {
        signal: handle.controller.signal,
        operator: handle.operator,
        executionId: handle.executionId,
      });

      if (result.ok) {
        handle.succeeded += 1;
      } else {
        handle.failed += 1;
        handle.failures.push({
          deviceType: action.deviceType,
          deviceId: action.deviceId,
          command: action.command,
          error: result.error ?? 'unknown',
        });
      }
      this.publishAction(handle, action, result.ok, result.error);
    });

    await Promise.allSettled(tasks);
  }

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

  private publishScene(
    handle: RunningHandle,
    status: ExecutionStatus,
  ): void {
    this.bus.publish({
      type: 'scene',
      scene: handle.sceneCode,
      executionId: handle.executionId,
      status: status as Exclude<ExecutionStatus, 'pending'>,
      failures: handle.failed,
      at: new Date().toISOString(),
    });
  }

  private publishAction(
    handle: RunningHandle,
    action: SceneAction,
    ok: boolean,
    error?: string,
  ): void {
    this.bus.publish({
      type: 'scene',
      scene: handle.sceneCode,
      executionId: handle.executionId,
      status: 'action',
      step: `${action.deviceType}.${action.command} on ${action.deviceId} -> ${ok ? 'ok' : 'fail'}${error ? ': ' + error : ''}`,
      at: new Date().toISOString(),
    });
  }

  private toPublic(h: RunningHandle): SceneExecution {
    const { controller: _controller, ...rest } = h;
    return rest;
  }
}
