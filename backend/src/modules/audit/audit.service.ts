import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { AuditLog } from '../../entities/audit-log.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { CyDali64aAdapter } from '../../adapters/lighting/cy-dali64a.adapter';
import { NovaLedAdapter } from '../../adapters/led/nova-led.adapter';
import { EkxDspAdapter } from '../../adapters/audio/ekx808.adapter';
import { ModbusHvacAdapter } from '../../adapters/hvac/modbus-hvac.adapter';

export interface RecordParams {
  entityType: 'hardware_unit' | 'driver_template' | 'device' | 'scene';
  entityId: string | number;
  action: 'create' | 'update' | 'delete' | 'rollback';
  operator?: string;
  snapshotBefore?: unknown;
  snapshotAfter?: unknown;
  remark?: string;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    private readonly daliAdapter: CyDali64aAdapter,
    private readonly ledAdapter: NovaLedAdapter,
    private readonly audioAdapter: EkxDspAdapter,
    private readonly hvacAdapter: ModbusHvacAdapter,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async record(p: RecordParams): Promise<AuditLog> {
    const row = this.repo.create({
      entityType: p.entityType,
      entityId: String(p.entityId),
      action: p.action,
      operator: p.operator ?? 'admin',
      snapshotBefore: p.snapshotBefore != null ? JSON.stringify(p.snapshotBefore) : null,
      snapshotAfter: p.snapshotAfter != null ? JSON.stringify(p.snapshotAfter) : null,
      remark: p.remark ?? null,
    });
    return this.repo.save(row);
  }

  async list(filters: {
    entityType?: string;
    entityId?: string;
    action?: string;
    operator?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ list: AuditLog[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const qb = this.repo.createQueryBuilder('a');
    if (filters.entityType) qb.andWhere('a.entityType = :t', { t: filters.entityType });
    if (filters.entityId) qb.andWhere('a.entityId = :id', { id: filters.entityId });
    if (filters.action) qb.andWhere('a.action = :ac', { ac: filters.action });
    if (filters.operator) qb.andWhere('a.operator = :op', { op: filters.operator });
    qb.orderBy('a.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  async detail(id: number): Promise<AuditLog | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * 回滚: 把 snapshotBefore 写回去. 仅支持 hardware_unit (其它 entity 类型按需扩).
   * 写完会再记一条 action='rollback' 的 audit, snapshotBefore=当前态, snapshotAfter=回滚目标态.
   */
  async rollback(auditId: number, operator = 'admin'): Promise<HardwareUnit> {
    const audit = await this.repo.findOne({ where: { id: auditId } });
    if (!audit) throw new Error(`audit#${auditId} 不存在`);
    if (audit.entityType !== 'hardware_unit') {
      throw new Error(`只支持回滚 hardware_unit, 该 audit 是 ${audit.entityType}`);
    }
    if (!audit.snapshotBefore) {
      throw new Error(`audit#${auditId} 没有 snapshotBefore (可能是 create), 无法回滚`);
    }
    const target = JSON.parse(audit.snapshotBefore) as Partial<HardwareUnit> & { id?: number };
    const id = target.id ?? Number(audit.entityId);
    if (!id) throw new Error(`audit#${auditId} 缺少 entityId, 无法定位回滚目标`);

    const current = await this.hwRepo.findOne({ where: { id } });
    if (!current) throw new Error(`hardware_unit#${id} 已删除, 无法回滚`);

    // 不允许从 audit 改 id / createdAt 这些 immutable 字段
    delete (target as { id?: number }).id;
    delete (target as { createdAt?: unknown }).createdAt;
    delete (target as { updatedAt?: unknown }).updatedAt;

    const before = JSON.parse(JSON.stringify(current));
    Object.assign(current, target);
    const saved = await this.hwRepo.save(current);
    await this.record({
      entityType: 'hardware_unit',
      entityId: id,
      action: 'rollback',
      operator,
      snapshotBefore: before,
      snapshotAfter: JSON.parse(JSON.stringify(saved)),
      remark: `rollback from audit#${auditId}`,
    });

    // 清掉对应 adapter 的 DB cache, 让 IO 立即用回滚后的值
    this.invalidateAdaptersFor(saved.code, saved.category);

    this.logger.warn(`Audit rollback hardware_unit#${id} (from audit#${auditId}) by ${operator}`, {
      context: 'AuditService',
    });
    return saved;
  }

  private invalidateAdaptersFor(code: string, category: string): void {
    if (code === 'CONV-RTU-1' || category === 'rtu-tcp-converter' || category === 'dali-converter') {
      this.daliAdapter.invalidateConfigCache();
    }
    if (code === 'LED-NOVA-1' || category === 'led-controller') {
      this.ledAdapter.invalidateConfigCache();
    }
    if (code === 'AUDIO-DSP-1' || category === 'audio-dsp') {
      this.audioAdapter.invalidateConfigCache();
    }
    if (category === 'hvac-gateway') {
      this.hvacAdapter.invalidateConfigCache();
    }
  }
}
