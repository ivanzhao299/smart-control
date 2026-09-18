import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { EntityManager, In, Repository } from 'typeorm';
import { Logger } from 'winston';
import { LightZone } from '../../entities/light-zone.entity';
import { LightGroup } from '../../entities/light-group.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { CreateLightZoneDto, UpdateLightZoneDto } from './dto/light-zone.dto';
import { AuditLog } from '../../entities/audit-log.entity';
import type { Actor } from '../../common/auth/actor';
import { serializedTransaction } from '../../common/utils/serialized-transaction';

/** 一个物理 DALI 组 (网关 + 组号唯一确定) */
export interface LightGroupView {
  id: number;
  configRevision: number;
  gatewayCode: string;
  daliGroup: number;
  zoneCode: string | null;
  /** 实测填入的灯具短地址; 没扫过是空数组 */
  shorts: number[];
  sortOrder: number;
  enabled: boolean;
  /** 派生: 网关的 Modbus 从机号 (hardware_unit.addressing.slaveId), 查不到给 null */
  slaveId: number | null;
  /** 派生: 网关显示名, 找不到就填 gatewayCode */
  gatewayDisplayName: string;
}

/**
 * 一个分区 = 一个名字 + 若干 DALI 组.
 *
 * 2026-07-16 改造: 原来分区上直接挂单个 (gatewayCode, daliGroup), 一个分区只能对
 * 应一个组。现场是 7 分区 / 11 组, 好几个分区由多组灯拼成 —— 所以成员关系搬到
 * LightGroup.zoneCode 上, 这里用 groups[] 呈现。
 */
export interface LightZoneView {
  id: number;
  configRevision: number;
  code: string;
  name: string;
  floor: string;
  sortOrder: number;
  icon: string | null;
  description: string | null;
  enabled: boolean;
  /** 该分区包含的 DALI 组 (可以是 0 个 —— 新建的空分区照常显示, 否则没法往里放组) */
  groups: LightGroupView[];
  createdAt: Date;
  updatedAt: Date;
}

export type LightZoneUpsertDto = CreateLightZoneDto;

/** resolveForCommand 的结果: 分区 + 它下面每个组的实际下发目标 */
export interface ZoneCommandTargets {
  zone: LightZone;
  targets: Array<{ slaveId: number; daliGroup: number; gatewayCode: string }>;
}

@Injectable()
export class LightZonesService {
  constructor(
    @InjectRepository(LightZone) private readonly zoneRepo: Repository<LightZone>,
    @InjectRepository(LightGroup) private readonly groupRepo: Repository<LightGroup>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  // 这里没有启动建档。新安装默认分区只存在于版本化迁移快照中；本服务只读写
  // SQLite 里的现场权威配置，避免两份清单互相重建管理员删除的分区。

  // ============ 查询 ============

  /** 网关 code -> {slaveId, displayName}; 一次查完, 避免 N+1 */
  private async gatewayMap(codes: string[]): Promise<Map<string, { slaveId: number | null; name: string }>> {
    const map = new Map<string, { slaveId: number | null; name: string }>();
    const uniq = Array.from(new Set(codes.filter(Boolean)));
    if (uniq.length === 0) return map;
    const rows = await this.hwRepo.find({ where: { code: In(uniq) } });
    for (const h of rows) {
      let slaveId: number | null = null;
      if (h.addressing) {
        try {
          const a = JSON.parse(h.addressing) as { slaveId?: number };
          if (typeof a.slaveId === 'number') slaveId = a.slaveId;
        } catch { /* 老数据非 JSON */ }
      }
      map.set(h.code, { slaveId, name: h.name || h.code });
    }
    return map;
  }

  private parseShorts(raw: string | null): number[] {
    if (!raw) return [];
    try {
      const a = JSON.parse(raw) as unknown;
      return Array.isArray(a) ? a.filter((x): x is number => typeof x === 'number') : [];
    } catch {
      return [];
    }
  }

  private groupToView(g: LightGroup, hw: Map<string, { slaveId: number | null; name: string }>): LightGroupView {
    const info = hw.get(g.gatewayCode);
    return {
      id: g.id,
      configRevision: g.configRevision,
      gatewayCode: g.gatewayCode,
      daliGroup: g.daliGroup,
      zoneCode: g.zoneCode,
      shorts: this.parseShorts(g.shorts),
      sortOrder: g.sortOrder,
      enabled: g.enabled,
      slaveId: info?.slaveId ?? null,
      gatewayDisplayName: info?.name ?? g.gatewayCode,
    };
  }

  /** 所有 DALI 组 (含未分配的) — 前端编组界面用 */
  async listGroups(): Promise<LightGroupView[]> {
    const rows = await this.groupRepo.find({
      where: { enabled: true },
      // sortOrder 优先 —— 业主拖出来的顺序要作数。原来只按 (网关, 组号) 排,
      // 那样 reorderGroups 存进去的顺序读出来又被覆盖, 等于白拖。
      // 同 sortOrder 时再退回 (网关, 组号), 保证顺序稳定 (否则每次读顺序可能不同)。
      order: { sortOrder: 'ASC', gatewayCode: 'ASC', daliGroup: 'ASC' },
    });
    const hw = await this.gatewayMap(rows.map((r) => r.gatewayCode));
    return rows.map((r) => this.groupToView(r, hw));
  }

  /**
   * 分区列表 (含成员组).
   * 空分区照常返回 —— 新建的分区一个组都没有, 过滤掉的话前端就点不到它、
   * 永远没法往里放组 (空调那边已经栽过这个坑)。
   */
  async list(opts: { includeDisabled?: boolean } = {}): Promise<LightZoneView[]> {
    const zones = await this.zoneRepo.find({
      where: opts.includeDisabled ? {} : { enabled: true },
      order: { floor: 'ASC', sortOrder: 'ASC', id: 'ASC' },
    });
    const groups = await this.groupRepo.find({ where: { enabled: true }, order: { sortOrder: 'ASC' } });
    const hw = await this.gatewayMap(groups.map((g) => g.gatewayCode));
    return zones.map((z) => this.toView(z, groups.filter((g) => g.zoneCode === z.code), hw));
  }

  async detail(id: number): Promise<LightZoneView> {
    const row = await this.zoneRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`light zone #${id} 不存在`);
    const groups = await this.groupRepo.find({ where: { zoneCode: row.code, enabled: true } });
    const hw = await this.gatewayMap(groups.map((g) => g.gatewayCode));
    return this.toView(row, groups, hw);
  }

  async byCode(code: string): Promise<LightZoneView> {
    const row = await this.zoneRepo.findOne({ where: { code } });
    if (!row) throw new NotFoundException(`light zone code "${code}" 不存在`);
    const groups = await this.groupRepo.find({ where: { zoneCode: code, enabled: true } });
    const hw = await this.gatewayMap(groups.map((g) => g.gatewayCode));
    return this.toView(row, groups, hw);
  }

  // ============ 控制路由 ============

  /**
   * 分区 id -> 该分区所有组的下发目标.
   *
   * 一个分区可能横跨两台网关 (组号在网关间会重复, 所以每个目标都要带自己的
   * slaveId, 不能只传组号)。空分区返回空 targets, 由 controller 决定怎么处理 ——
   * 不在这里抛错, 因为"分区暂时没有组"是编组过程中的正常状态, 不是故障。
   */
  async resolveForCommand(id: number): Promise<ZoneCommandTargets> {
    const zone = await this.zoneRepo.findOne({ where: { id } });
    if (!zone) throw new NotFoundException(`light zone #${id} 不存在`);
    if (!zone.enabled) throw new ConflictException(`light zone #${id} (${zone.name}) 已禁用`);

    const groups = await this.groupRepo.find({
      where: { zoneCode: zone.code, enabled: true },
      order: { sortOrder: 'ASC' },
    });
    const hw = await this.gatewayMap(groups.map((g) => g.gatewayCode));

    const targets: ZoneCommandTargets['targets'] = [];
    for (const g of groups) {
      const info = hw.get(g.gatewayCode);
      if (!info) {
        this.logger.warn(
          `分区 ${zone.code} 的组 ${g.gatewayCode}/${g.daliGroup}: 网关不在 hardware_unit 表里, 跳过`,
          { context: 'LightZonesService' },
        );
        continue;
      }
      if (info.slaveId === null) {
        this.logger.warn(
          `分区 ${zone.code} 的组 ${g.gatewayCode}/${g.daliGroup}: 网关 addressing 里没有 slaveId, 跳过`,
          { context: 'LightZonesService' },
        );
        continue;
      }
      targets.push({ slaveId: info.slaveId, daliGroup: g.daliGroup, gatewayCode: g.gatewayCode });
    }
    return { zone, targets };
  }

  // ============ 分区增删改 ============

  async create(dto: CreateLightZoneDto, actor?: Actor): Promise<LightZoneView> {
    if (!dto.code?.trim()) throw new ConflictException('code 不能为空');
    if (!dto.name?.trim()) throw new ConflictException('name 不能为空');
    const saved = await serializedTransaction(this.zoneRepo.manager.connection, async (manager) => {
      const repo = manager.getRepository(LightZone);
      const dup = await repo.findOne({ where: { code: dto.code.trim() } });
      if (dup) throw new ConflictException(`zone code 已存在: ${dto.code}`);
      const row = await repo.save(repo.create({
        configRevision: 1,
        code: dto.code.trim(), name: dto.name.trim(), floor: dto.floor ?? '1F',
        gatewayCode: null, daliGroup: null, sortOrder: dto.sortOrder ?? 100,
        icon: dto.icon ?? 'Lightbulb', description: dto.description ?? null,
        enabled: dto.enabled ?? true,
      }));
      await this.writeAudit(manager, 'create', row.id, null, row, actor, 'light-zone:create');
      return row;
    });
    return this.detail(saved.id);
  }

  async update(id: number, dto: UpdateLightZoneDto, actor?: Actor): Promise<LightZoneView> {
    await serializedTransaction(this.zoneRepo.manager.connection, async (manager) => {
      const repo = manager.getRepository(LightZone);
      const groups = manager.getRepository(LightGroup);
      const row = await repo.findOne({ where: { id } });
      if (!row) throw new NotFoundException(`light zone #${id} 不存在`);
      this.assertRevision(row.configRevision, dto.expectedRevision);
      const before = { ...row };
      const nextCode = dto.code?.trim();
      if (nextCode && nextCode !== row.code) {
        const dup = await repo.findOne({ where: { code: nextCode } });
        if (dup && dup.id !== id) throw new ConflictException(`zone code 已存在: ${nextCode}`);
        const members = await groups.find({ where: { zoneCode: row.code } });
        for (const member of members) { member.zoneCode = nextCode; member.configRevision += 1; }
        if (members.length) await groups.save(members);
        row.code = nextCode;
      }
      if (dto.name !== undefined) row.name = dto.name.trim();
      if (dto.floor !== undefined) row.floor = dto.floor.trim();
      if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
      if (dto.icon !== undefined) row.icon = dto.icon?.trim() || null;
      if (dto.description !== undefined) row.description = dto.description?.trim() || null;
      if (dto.enabled !== undefined) row.enabled = dto.enabled;
      if (JSON.stringify(before) === JSON.stringify(row)) return;
      row.configRevision += 1;
      const result = await repo.update({ id, configRevision: dto.expectedRevision }, row);
      if (result.affected !== 1) throw this.revisionConflict();
      const saved = await repo.findOneByOrFail({ id });
      await this.writeAudit(manager, 'update', id, before, saved, actor, 'light-zone:update');
    });
    return this.detail(id);
  }

  /** 删分区 — 成员组不删, 只是变回"未分配" */
  async remove(id: number, expectedRevision: number, actor?: Actor): Promise<{ code: string; releasedGroups: number }> {
    return serializedTransaction(this.zoneRepo.manager.connection, async (manager) => {
      const repo = manager.getRepository(LightZone);
      const groups = manager.getRepository(LightGroup);
      const row = await repo.findOne({ where: { id } });
      if (!row) throw new NotFoundException(`light zone #${id} 不存在`);
      this.assertRevision(row.configRevision, expectedRevision);
      const members = await groups.find({ where: { zoneCode: row.code } });
      for (const member of members) { member.zoneCode = null; member.configRevision += 1; }
      if (members.length) await groups.save(members);
      const result = await repo.delete({ id, configRevision: expectedRevision });
      if (result.affected !== 1) throw this.revisionConflict();
      await this.writeAudit(manager, 'delete', id, row, null, actor, 'light-zone:delete');
      return { code: row.code, releasedGroups: members.length };
    });
  }

  private assertRevision(actual: number, expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 1 || actual !== expected) throw this.revisionConflict();
  }

  private revisionConflict(): ConflictException {
    return new ConflictException({ code: 'LIGHT_ZONE_REVISION_CONFLICT', message: '灯光分区已被其他管理员修改，请重新读取后再保存' });
  }

  private async writeAudit(
    manager: EntityManager, action: 'create' | 'update' | 'delete', id: number,
    before: unknown, after: unknown, actor: Actor | undefined, remark: string,
  ): Promise<void> {
    await manager.insert(AuditLog, {
      entityType: 'light_zone', entityId: String(id), action,
      operator: actor?.username ?? 'system',
      snapshotBefore: before == null ? null : JSON.stringify(before),
      snapshotAfter: after == null ? null : JSON.stringify(after), remark,
    });
  }

  // ============ 组新建 ============

  /**
   * 登记一个新的物理 DALI 组 —— 只是元数据登记, 不碰硬件 (那条 DALI 总线上这个组
   * 组号本来就存在或不存在, 我们只是让系统"认识"它)。
   * (gatewayCode, daliGroup) 唯一, 建重了给友好报错而不是让 DB 唯一约束抛裸异常。
   */
  async createGroup(dto: { gatewayCode: string; daliGroup: number; zoneCode?: string | null }): Promise<LightGroupView> {
    const gatewayCode = dto.gatewayCode.trim();
    if (!gatewayCode) throw new ConflictException('gatewayCode 不能为空');

    const dup = await this.groupRepo.findOne({ where: { gatewayCode, daliGroup: dto.daliGroup } });
    if (dup) throw new ConflictException(`${gatewayCode} 上的 ${dto.daliGroup} 组已经登记过了`);

    let zoneCode: string | null = null;
    const target = (dto.zoneCode ?? '').trim();
    if (target) {
      const zone = await this.zoneRepo.findOne({ where: { code: target } });
      if (!zone) throw new NotFoundException(`分区 "${target}" 不存在`);
      zoneCode = zone.code;
    }

    const saved = await this.groupRepo.save(
      this.groupRepo.create({
        gatewayCode,
        daliGroup: dto.daliGroup,
        zoneCode,
        shorts: null,
        sortOrder: 100,
        enabled: true,
      }),
    );
    const hw = await this.gatewayMap([saved.gatewayCode]);
    return this.groupToView(saved, hw);
  }

  // ============ 组归属 ============

  /** 把若干组划进某分区; zoneCode 传空 = 移出分区 */
  async assignGroups(groupIds: number[], zoneCode: string | null): Promise<{ count: number; zoneCode: string | null }> {
    const target = (zoneCode ?? '').trim();
    let normalized: string | null = null;
    if (target) {
      const zone = await this.zoneRepo.findOne({ where: { code: target } });
      if (!zone) throw new NotFoundException(`分区 "${target}" 不存在`);
      normalized = zone.code;
    }
    const rows = await this.groupRepo.find({ where: { id: In(groupIds) } });
    if (rows.length === 0) throw new NotFoundException('选中的组都不存在');
    for (const r of rows) r.zoneCode = normalized;
    await this.groupRepo.save(rows);
    return { count: rows.length, zoneCode: normalized };
  }

  // ============ 排序 ============

  /**
   * 按业主拖拽出来的顺序重排分区。
   *
   * 为什么存后端而不是前端 (2026-07-17 业主问"看是在前端还是在后端来实现比较容易"):
   * 现场有主控机 + 平板 + 手机多个终端。排序只存前端 (localStorage) 的话, 每台设备
   * 顺序都不一样, 等于没排。sortOrder 字段本来就在实体上, list() 也早就按它排
   * (order: floor, sortOrder, id), 只是从来没人写入 —— 补上这个写入口即可, 前端
   * 拖完把 id 顺序发过来。
   *
   * 传全量有序 id 列表, 按下标重写 sortOrder。用 10 的倍数留空隙, 以后想在两个之间
   * 手工插一个不用整体重排。
   */
  async reorderZones(orderedIds: number[]): Promise<{ count: number }> {
    const rows = await this.zoneRepo.find({ where: { id: In(orderedIds) } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const touched: LightZone[] = [];
    orderedIds.forEach((id, i) => {
      const row = byId.get(id);
      if (row) { row.sortOrder = (i + 1) * 10; touched.push(row); }
    });
    if (touched.length) await this.zoneRepo.save(touched);
    return { count: touched.length };
  }

  /** 同上, 重排某分区内的灯组 (跨分区拖动请用 assignGroups, 这里只管顺序) */
  async reorderGroups(orderedIds: number[]): Promise<{ count: number }> {
    const rows = await this.groupRepo.find({ where: { id: In(orderedIds) } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const touched: LightGroup[] = [];
    orderedIds.forEach((id, i) => {
      const row = byId.get(id);
      if (row) { row.sortOrder = (i + 1) * 10; touched.push(row); }
    });
    if (touched.length) await this.groupRepo.save(touched);
    return { count: touched.length };
  }

  /** 记录某组实测出来的灯具短地址 (逐组点亮回读扫描的结果) */
  async setGroupShorts(groupId: number, shorts: number[]): Promise<LightGroupView> {
    const row = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!row) throw new NotFoundException(`light group #${groupId} 不存在`);
    row.shorts = JSON.stringify(shorts);
    await this.groupRepo.save(row);
    const hw = await this.gatewayMap([row.gatewayCode]);
    return this.groupToView(row, hw);
  }

  private toView(
    row: LightZone,
    groups: LightGroup[],
    hw: Map<string, { slaveId: number | null; name: string }>,
  ): LightZoneView {
    return {
      id: row.id,
      configRevision: row.configRevision,
      code: row.code,
      name: row.name,
      floor: row.floor,
      sortOrder: row.sortOrder,
      icon: row.icon,
      description: row.description,
      enabled: row.enabled,
      groups: groups
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((g) => this.groupToView(g, hw)),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
