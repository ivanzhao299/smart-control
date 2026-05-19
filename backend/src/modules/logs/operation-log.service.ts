import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Between, FindOptionsWhere, In, Like, MoreThanOrEqual, Repository } from 'typeorm';
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
export class OperationLogService {
  constructor(
    @InjectRepository(OperationLog) private readonly repo: Repository<OperationLog>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

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
