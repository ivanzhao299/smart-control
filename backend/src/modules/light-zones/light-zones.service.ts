import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { In, Repository } from 'typeorm';
import { Logger } from 'winston';
import { LightZone } from '../../entities/light-zone.entity';
import { LightGroup } from '../../entities/light-group.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';

/** 一个物理 DALI 组 (网关 + 组号唯一确定) */
export interface LightGroupView {
  id: number;
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

export interface LightZoneUpsertDto {
  code: string;
  name: string;
  floor?: string;
  sortOrder?: number;
  icon?: string | null;
  description?: string | null;
  enabled?: boolean;
}

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
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  // 注意: 这里**没有** onModuleInit 自动灌种子。
  // 原来有一份 SEED_ZONES 副本在这里"双保险", 结果是: SeedService 按现场实际删掉
  // 作废的旧分区后, 下次启动这里又把它们原样建回来 —— 业主删不掉。种子只留
  // SeedService 一处 (seedLightZones), 免得两份清单互相打架。

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
      order: { gatewayCode: 'ASC', daliGroup: 'ASC' },
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

  async create(dto: LightZoneUpsertDto): Promise<LightZoneView> {
    if (!dto.code?.trim()) throw new ConflictException('code 不能为空');
    if (!dto.name?.trim()) throw new ConflictException('name 不能为空');
    const dup = await this.zoneRepo.findOne({ where: { code: dto.code } });
    if (dup) throw new ConflictException(`zone code 已存在: ${dto.code}`);
    const saved = await this.zoneRepo.save(
      this.zoneRepo.create({
        code: dto.code.trim(),
        name: dto.name.trim(),
        floor: dto.floor ?? '1F',
        gatewayCode: null,
        daliGroup: null,
        sortOrder: dto.sortOrder ?? 100,
        icon: dto.icon ?? 'Lightbulb',
        description: dto.description ?? null,
        enabled: dto.enabled ?? true,
      }),
    );
    return this.detail(saved.id);
  }

  async update(id: number, dto: Partial<LightZoneUpsertDto>): Promise<LightZoneView> {
    const row = await this.zoneRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`light zone #${id} 不存在`);
    if (dto.code && dto.code !== row.code) {
      const dup = await this.zoneRepo.findOne({ where: { code: dto.code } });
      if (dup && dup.id !== id) throw new ConflictException(`zone code 已存在: ${dto.code}`);
      // 改 code 会让成员组的 zoneCode 指向虚空, 一并迁过去
      await this.groupRepo.update({ zoneCode: row.code }, { zoneCode: dto.code });
      row.code = dto.code;
    }
    if (dto.name !== undefined) row.name = dto.name;
    if (dto.floor !== undefined) row.floor = dto.floor;
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.icon !== undefined) row.icon = dto.icon;
    if (dto.description !== undefined) row.description = dto.description;
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    await this.zoneRepo.save(row);
    return this.detail(id);
  }

  /** 删分区 — 成员组不删, 只是变回"未分配" */
  async remove(id: number): Promise<{ code: string; releasedGroups: number }> {
    const row = await this.zoneRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`light zone #${id} 不存在`);
    const members = await this.groupRepo.find({ where: { zoneCode: row.code } });
    for (const m of members) m.zoneCode = null;
    if (members.length > 0) await this.groupRepo.save(members);
    await this.zoneRepo.remove(row);
    return { code: row.code, releasedGroups: members.length };
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
