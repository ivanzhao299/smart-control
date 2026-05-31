import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Between, FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { Logger } from 'winston';
import {
  Alert,
  AlertLevel,
  AlertStatus,
} from '../../entities/alert.entity';
import { ControlBus } from '../../services/control-bus';
import { QueryAlertDto } from './dto/alert.dto';
import { PagedResult } from '../devices/devices.service';

export interface CreateAlertInput {
  level: AlertLevel;
  type: string;
  sourceType: string;
  sourceId?: string | null;
  title: string;
  message?: string;
  /** 同一 sourceType+sourceId+type 的 active 报警去重: 若已有则更新 message 并返回, 不再重复创建 */
  dedupe?: boolean;
}

export interface AlertSummary {
  active: number;
  byLevel: Record<AlertLevel, number>;
  last24h: number;
  latest: Alert | null;
}

@Injectable()
export class AlertService {
  constructor(
    @InjectRepository(Alert) private readonly repo: Repository<Alert>,
    private readonly bus: ControlBus,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async create(input: CreateAlertInput): Promise<Alert> {
    if (input.dedupe) {
      const existing = await this.repo.findOne({
        where: {
          status: 'active',
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? IsNull(),
          type: input.type,
        },
        order: { id: 'DESC' },
      });
      if (existing) {
        existing.message = input.message ?? existing.message;
        existing.title = input.title;
        existing.level = input.level;
        await this.repo.save(existing);
        return existing;
      }
    }
    const entity = this.repo.create({
      level: input.level,
      type: input.type,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      title: input.title,
      message: input.message ?? null,
      status: 'active',
    });
    const saved = await this.repo.save(entity);
    this.logger.warn(`Alert created: [${saved.level}] ${saved.title}`, {
      context: 'AlertService',
    });
    this.bus.publish({
      type: 'alarm',
      source: input.sourceId ?? input.sourceType,
      level: this.toAlarmLevel(input.level),
      message: `${input.title}${input.message ? ' — ' + input.message : ''}`,
      at: new Date().toISOString(),
    });
    this.bus.publish({
      type: 'alert_created',
      alertId: saved.id,
      level: saved.level,
      alertType: saved.type,
      sourceType: saved.sourceType,
      sourceId: saved.sourceId,
      title: saved.title,
      message: saved.message,
      at: saved.createdAt.toISOString(),
    });
    return saved;
  }

  async findAll(q: QueryAlertDto): Promise<PagedResult<Alert>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: FindOptionsWhere<Alert> = {};
    if (q.level) where.level = q.level as AlertLevel;
    if (q.status) where.status = q.status as AlertStatus;
    if (q.sourceType) where.sourceType = q.sourceType;
    if (q.type) where.type = q.type;
    if (q.startTime && q.endTime) {
      where.createdAt = Between(new Date(q.startTime), new Date(q.endTime));
    }
    const [list, total] = await this.repo.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  async findOne(id: number): Promise<Alert> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException(`报警不存在: id=${id}`);
    return r;
  }

  async resolve(id: number, resolvedBy = 'admin'): Promise<Alert> {
    const alert = await this.findOne(id);
    if (alert.status === 'resolved') return alert;
    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    alert.resolvedBy = resolvedBy;
    const saved = await this.repo.save(alert);
    this.logger.info(`Alert resolved: #${id} ${alert.title} by ${resolvedBy}`, {
      context: 'AlertService',
    });
    this.bus.publish({
      type: 'alert_resolved',
      alertId: saved.id,
      sourceType: saved.sourceType,
      sourceId: saved.sourceId,
      resolvedBy,
      at: saved.resolvedAt!.toISOString(),
    });
    return saved;
  }

  async ignore(id: number, operator = 'admin'): Promise<Alert> {
    const alert = await this.findOne(id);
    if (alert.status === 'ignored') return alert;
    alert.status = 'ignored';
    alert.resolvedAt = new Date();
    alert.resolvedBy = operator;
    const saved = await this.repo.save(alert);
    this.logger.info(`Alert ignored: #${id} ${alert.title} by ${operator}`, {
      context: 'AlertService',
    });
    return saved;
  }

  /** 操作员手动 "X 全部清除", 等同 autoResolveBySource 但带 manual 标记 */
  async resolveBySource(sourceType: string, sourceId: string | null, resolvedBy = 'admin'): Promise<number> {
    return this.autoResolveBySource(sourceType, sourceId, undefined, resolvedBy);
  }

  /** 当对应来源恢复正常时, 把所有 active 报警一并 resolve */
  async autoResolveBySource(
    sourceType: string,
    sourceId: string | null,
    type?: string,
    resolvedBy = 'system',
  ): Promise<number> {
    const where: FindOptionsWhere<Alert> = {
      status: 'active',
      sourceType,
      sourceId: sourceId ?? IsNull(),
    };
    if (type) where.type = type;
    const list = await this.repo.find({ where });
    for (const a of list) {
      a.status = 'resolved';
      a.resolvedAt = new Date();
      a.resolvedBy = resolvedBy;
    }
    if (list.length > 0) {
      await this.repo.save(list);
      this.logger.info(
        `Auto-resolved ${list.length} alert(s) for ${sourceType}/${sourceId ?? '-'}`,
        { context: 'AlertService' },
      );
      for (const a of list) {
        this.bus.publish({
          type: 'alert_resolved',
          alertId: a.id,
          sourceType: a.sourceType,
          sourceId: a.sourceId,
          resolvedBy,
          at: a.resolvedAt!.toISOString(),
        });
      }
    }
    return list.length;
  }

  async summary(): Promise<AlertSummary> {
    const active = await this.repo.count({ where: { status: 'active' } });
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last24h = await this.repo.count({ where: { createdAt: Between(since, new Date()) } });
    const latest = await this.repo.findOne({
      where: { status: 'active' },
      order: { id: 'DESC' },
    });
    const byLevel: Record<AlertLevel, number> = {
      info: 0,
      warning: 0,
      critical: 0,
      emergency: 0,
    };
    for (const lv of Object.keys(byLevel) as AlertLevel[]) {
      byLevel[lv] = await this.repo.count({ where: { status: 'active', level: lv } });
    }
    return { active, byLevel, last24h, latest };
  }

  private toAlarmLevel(level: AlertLevel): 'info' | 'warning' | 'error' {
    if (level === 'info') return 'info';
    if (level === 'warning') return 'warning';
    return 'error';
  }
}
