import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Between, FindOptionsWhere, In, LessThan, Like, MoreThanOrEqual, Repository } from 'typeorm';
import { Logger } from 'winston';
import { LogResult, OperationLog } from '../../entities/operation-log.entity';
import { QueryLogDto } from './dto/query-log.dto';
import { PagedResult } from '../devices/devices.service';

export interface RecordLogInput {
  operator?: string;
  terminal?: string;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  result?: LogResult;
  message?: string;
  /** Sprint-04 spec Task-016 */
  durationMs?: number;
  retryCount?: number;
  timeoutMs?: number;
  rawResponse?: unknown;
}

@Injectable()
export class OperationLogService implements OnModuleInit, OnModuleDestroy {
  /**
   * 日志留存天数 — 默认 90 天, 用 LOG_RETENTION_DAYS 调; <=0 关闭清理.
   *
   * 背景: operation_log 每次设备操作都写一行, 之前**没有任何留存策略**, SQLite 只涨不减.
   * 展厅每天几百到几千条, 一年就是几十万行 —— 拖慢日志页分页查询, 也把 DB 文件撑大
   * (备份跟着变慢). 90 天足够追溯现场问题, 再老的没人看.
   */
  private readonly retentionDays = Number.parseInt(process.env.LOG_RETENTION_DAYS ?? '90', 10);
  private purgeTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(OperationLog) private readonly repo: Repository<OperationLog>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    if (!Number.isFinite(this.retentionDays) || this.retentionDays <= 0) {
      this.logger.info('操作日志留存清理已关闭 (LOG_RETENTION_DAYS<=0)', {
        context: 'OperationLogService',
      });
      return;
    }
    // 启动 5 分钟后先清一次积压 (避开启动高峰), 之后每 24h 一次.
    // 用 setTimeout/setInterval 而不是引入 ScheduleModule: 自包含、不动全局模块布线.
    setTimeout(() => void this.purgeExpired(), 5 * 60_000).unref?.();
    this.purgeTimer = setInterval(() => void this.purgeExpired(), 24 * 3600_000);
    this.purgeTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  /** 删除超过留存期的操作日志, 返回删除条数 */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 3600_000);
    try {
      const res = await this.repo.delete({ createdAt: LessThan(cutoff) });
      const removed = res.affected ?? 0;
      if (removed > 0) {
        this.logger.info(
          `操作日志清理: 删除 ${removed} 条 (早于 ${cutoff.toISOString()}, 留存 ${this.retentionDays} 天)`,
          { context: 'OperationLogService' },
        );
      }
      return removed;
    } catch (err) {
      // 清理失败不能影响主流程 (写日志/查日志照常)
      this.logger.error(`操作日志清理失败: ${(err as Error).message}`, {
        context: 'OperationLogService',
      });
      return 0;
    }
  }

  async record(input: RecordLogInput): Promise<OperationLog> {
    const entity = this.repo.create({
      operator: input.operator ?? 'system',
      terminal: input.terminal ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId !== undefined && input.targetId !== null ? String(input.targetId) : null,
      result: input.result ?? 'success',
      message: input.message ?? null,
      durationMs: input.durationMs ?? 0,
      retryCount: input.retryCount ?? 1,
      timeoutMs: input.timeoutMs ?? null,
      rawResponse:
        input.rawResponse === undefined || input.rawResponse === null
          ? null
          : typeof input.rawResponse === 'string'
            ? input.rawResponse
            : JSON.stringify(input.rawResponse),
    });
    try {
      return await this.repo.save(entity);
    } catch (err) {
      this.logger.error(`Failed to write operation log: ${(err as Error).message}`, {
        context: 'OperationLogService',
      });
      throw err;
    }
  }

  async findAll(query: QueryLogDto): Promise<PagedResult<OperationLog>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const where: FindOptionsWhere<OperationLog> = {};
    if (query.operator) where.operator = query.operator;
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.result) where.result = query.result;
    if (query.startTime && query.endTime) {
      where.createdAt = Between(new Date(query.startTime), new Date(query.endTime));
    }

    const [list, total] = await this.repo.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  /** Sprint-08: 今日运行汇总 */
  async todaySummary(): Promise<{
    operations: number;
    alerts: number;
    sceneExecutions: number;
    sceneFailures: number;
    deviceOffline: number;
    rangeStart: string;
    rangeEnd: string;
  }> {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const [
      operations,
      sceneExecutions,
      sceneFailures,
      deviceOffline,
      alertWritten,
    ] = await Promise.all([
      this.repo.count({ where: { createdAt: MoreThanOrEqual(start) } }),
      this.repo.count({
        where: {
          createdAt: MoreThanOrEqual(start),
          action: In(['scene.execute', 'scene.execute.scheduled']),
        },
      }),
      this.repo.count({
        where: {
          createdAt: MoreThanOrEqual(start),
          action: In(['scene.execute', 'scene.execute.scheduled']),
          result: 'failure',
        },
      }),
      this.repo.count({
        where: {
          createdAt: MoreThanOrEqual(start),
          message: Like('%gateway_offline%'),
        },
      }),
      // 操作日志里的 alarm.* 也算 (历史兼容)
      this.repo.count({
        where: {
          createdAt: MoreThanOrEqual(start),
          targetType: 'gateway',
        },
      }),
    ]);

    return {
      operations,
      alerts: alertWritten,
      sceneExecutions,
      sceneFailures,
      deviceOffline,
      rangeStart: start.toISOString(),
      rangeEnd: now.toISOString(),
    };
  }
}
