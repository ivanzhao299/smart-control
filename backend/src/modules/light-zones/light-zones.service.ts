import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { LightZone } from '../../entities/light-zone.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';

export interface LightZoneView {
  id: number;
  code: string;
  name: string;
  floor: string;
  gatewayCode: string;
  daliGroup: number;
  sortOrder: number;
  icon: string | null;
  description: string | null;
  enabled: boolean;
  /** 帮前端展示的派生字段: 网关在 hardware_unit 表里查到的 slaveId, 没查到给 null */
  gatewaySlaveId: number | null;
  /** 网关显示名 (hardware_unit.name), 找不到时填 gatewayCode */
  gatewayDisplayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LightZoneUpsertDto {
  code: string;
  name: string;
  floor: string;
  gatewayCode: string;
  daliGroup: number;
  sortOrder?: number;
  icon?: string | null;
  description?: string | null;
  enabled?: boolean;
}

/**
 * 启动自动注入种子数据用. SeedService 的 seedLightZones 也写一份, 双保险:
 * - 全新装机走 SeedService (npm run seed)
 * - 老库升级 (e.g. 远程部署 watcher 拉到 Sprint E) 走 onModuleInit, 无人值守
 *
 * 跟 SeedService 的清单保持同步.
 */
const SEED_ZONES: Array<{
  code: string; name: string; floor: string; gatewayCode: string;
  daliGroup: number; sortOrder: number; icon: string; description?: string;
}> = [
  { code: '1f-front-hall',    name: '一层前厅 / 园区展示', floor: '1F', gatewayCode: 'GW-DALI-1', daliGroup: 1, sortOrder: 10, icon: 'Lightbulb' },
  { code: '1f-roadshow',      name: '一层路演 / 洽谈区',   floor: '1F', gatewayCode: 'GW-DALI-1', daliGroup: 2, sortOrder: 20, icon: 'Lightbulb' },
  { code: '1f-corridor',      name: '一层走廊',           floor: '1F', gatewayCode: 'GW-DALI-1', daliGroup: 3, sortOrder: 30, icon: 'Lightbulb' },
  { code: '1f-accent',        name: '一层重点照明 / 灯箱', floor: '1F', gatewayCode: 'GW-DALI-1', daliGroup: 4, sortOrder: 40, icon: 'Sparkles' },
  { code: '1f-enterprise',    name: '一层企业展位区',     floor: '1F', gatewayCode: 'GW-DALI-1', daliGroup: 5, sortOrder: 50, icon: 'Lightbulb' },
  { code: '1f-general',       name: '一层综合展销区',     floor: '1F', gatewayCode: 'GW-DALI-1', daliGroup: 6, sortOrder: 60, icon: 'Lightbulb' },
  { code: '1f-trade',         name: '一层物贸交易展示区', floor: '1F', gatewayCode: 'GW-DALI-1', daliGroup: 7, sortOrder: 70, icon: 'Lightbulb' },
  { code: '2f-test-a',        name: '二层测试灯 A',       floor: '2F', gatewayCode: 'GW-DALI-2', daliGroup: 3, sortOrder: 5,  icon: 'Lightbulb', description: '2026-05-31 现场调试 USB 直连找到, group 3' },
  { code: '2f-test-b',        name: '二层测试灯 B',       floor: '2F', gatewayCode: 'GW-DALI-2', daliGroup: 4, sortOrder: 6,  icon: 'Lightbulb', description: '2026-05-31 现场调试 USB 直连找到, group 4' },
  { code: '2f-front-hall',    name: '二层前厅 / 走廊',     floor: '2F', gatewayCode: 'GW-DALI-2', daliGroup: 8, sortOrder: 10, icon: 'Lightbulb', description: '灯具未安装, 占位' },
  { code: '2f-enterprise-svc',name: '二层企业服务中心',   floor: '2F', gatewayCode: 'GW-DALI-2', daliGroup: 9, sortOrder: 20, icon: 'Lightbulb', description: '灯具未安装, 占位' },
  { code: '2f-coworking',     name: '二层共享办公',       floor: '2F', gatewayCode: 'GW-DALI-2', daliGroup: 10, sortOrder: 30, icon: 'Lightbulb', description: '灯具未安装, 占位' },
  { code: '2f-research',      name: '二层产业研究 / 接待', floor: '2F', gatewayCode: 'GW-DALI-2', daliGroup: 11, sortOrder: 40, icon: 'Lightbulb', description: '灯具未安装, 占位' },
  { code: '2f-control',       name: '二层运营指挥中心',   floor: '2F', gatewayCode: 'GW-DALI-2', daliGroup: 12, sortOrder: 50, icon: 'Sparkles',  description: '灯具未安装, 占位' },
];

@Injectable()
export class LightZonesService implements OnModuleInit {
  constructor(
    @InjectRepository(LightZone) private readonly zoneRepo: Repository<LightZone>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /** 启动自动注入种子 — code 唯一, 已存在跳过, 业主改过的不会被覆盖. */
  async onModuleInit(): Promise<void> {
    let created = 0;
    for (const z of SEED_ZONES) {
      const exists = await this.zoneRepo.findOne({ where: { code: z.code } });
      if (exists) continue;
      await this.zoneRepo.save(
        this.zoneRepo.create({
          code: z.code,
          name: z.name,
          floor: z.floor,
          gatewayCode: z.gatewayCode,
          daliGroup: z.daliGroup,
          sortOrder: z.sortOrder,
          icon: z.icon,
          description: z.description ?? null,
          enabled: true,
        }),
      );
      created += 1;
    }
    if (created > 0) {
      this.logger.info(`LightZonesService bootstrap: 自动注入 ${created} 个分区`, {
        context: 'LightZonesService',
      });
    }
  }

  /** 列表 — 前端 LightingPage 拉这个就够 */
  async list(opts: { includeDisabled?: boolean } = {}): Promise<LightZoneView[]> {
    const where = opts.includeDisabled ? {} : { enabled: true };
    const rows = await this.zoneRepo.find({
      where,
      order: { floor: 'ASC', sortOrder: 'ASC', id: 'ASC' },
    });
    const gatewayCodes = Array.from(new Set(rows.map((r) => r.gatewayCode)));
    const hwRows = gatewayCodes.length
      ? await this.hwRepo
          .createQueryBuilder('h')
          .where('h.code IN (:...codes)', { codes: gatewayCodes })
          .getMany()
      : [];
    const hwMap = new Map(hwRows.map((h) => [h.code, h]));
    return rows.map((r) => this.toView(r, hwMap.get(r.gatewayCode)));
  }

  async detail(id: number): Promise<LightZoneView> {
    const row = await this.zoneRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`light zone #${id} 不存在`);
    const hw = await this.hwRepo.findOne({ where: { code: row.gatewayCode } });
    return this.toView(row, hw ?? undefined);
  }

  /** 按 code 查 (供 controller 路由用) — 不存在抛 404 */
  async byCode(code: string): Promise<LightZoneView> {
    const row = await this.zoneRepo.findOne({ where: { code } });
    if (!row) throw new NotFoundException(`light zone code "${code}" 不存在`);
    const hw = await this.hwRepo.findOne({ where: { code: row.gatewayCode } });
    return this.toView(row, hw ?? undefined);
  }

  /** 按 id 拿原始 entity (controller 给 adapter 派发命令用) */
  async resolveForCommand(id: number): Promise<{ zone: LightZone; slaveId: number }> {
    const zone = await this.zoneRepo.findOne({ where: { id } });
    if (!zone) throw new NotFoundException(`light zone #${id} 不存在`);
    if (!zone.enabled) throw new ConflictException(`light zone #${id} (${zone.name}) 已禁用`);
    const hw = await this.hwRepo.findOne({ where: { code: zone.gatewayCode } });
    if (!hw) {
      throw new NotFoundException(
        `light zone #${id} 关联的网关 ${zone.gatewayCode} 在 hardware_unit 表里不存在`,
      );
    }
    if (!hw.enabled) {
      throw new ConflictException(`网关 ${zone.gatewayCode} 已禁用`);
    }
    let slaveId: number | undefined;
    if (hw.addressing) {
      try {
        const a = JSON.parse(hw.addressing) as { slaveId?: number };
        if (typeof a.slaveId === 'number') slaveId = a.slaveId;
      } catch {/* 老数据非 JSON 兜底 */}
    }
    if (!slaveId) {
      throw new ConflictException(
        `网关 ${zone.gatewayCode} 的 addressing 里没有 slaveId 字段, 没法路由`,
      );
    }
    return { zone, slaveId };
  }

  async create(dto: LightZoneUpsertDto): Promise<LightZoneView> {
    this.validate(dto);
    const dup = await this.zoneRepo.findOne({ where: { code: dto.code } });
    if (dup) throw new ConflictException(`zone code 已存在: ${dto.code}`);
    const row = this.zoneRepo.create({
      code: dto.code,
      name: dto.name,
      floor: dto.floor,
      gatewayCode: dto.gatewayCode,
      daliGroup: dto.daliGroup,
      sortOrder: dto.sortOrder ?? 100,
      icon: dto.icon ?? null,
      description: dto.description ?? null,
      enabled: dto.enabled ?? true,
    });
    const saved = await this.zoneRepo.save(row);
    return this.detail(saved.id);
  }

  async update(id: number, dto: Partial<LightZoneUpsertDto>): Promise<LightZoneView> {
    const row = await this.zoneRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`light zone #${id} 不存在`);
    if (dto.code && dto.code !== row.code) {
      const dup = await this.zoneRepo.findOne({ where: { code: dto.code } });
      if (dup && dup.id !== id) throw new ConflictException(`zone code 已存在: ${dto.code}`);
    }
    if (dto.daliGroup !== undefined) {
      if (!Number.isInteger(dto.daliGroup) || dto.daliGroup < 1 || dto.daliGroup > 16) {
        throw new ConflictException('daliGroup 必须是 1-16');
      }
    }
    Object.assign(row, {
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.floor !== undefined && { floor: dto.floor }),
      ...(dto.gatewayCode !== undefined && { gatewayCode: dto.gatewayCode }),
      ...(dto.daliGroup !== undefined && { daliGroup: dto.daliGroup }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.icon !== undefined && { icon: dto.icon }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
    });
    const saved = await this.zoneRepo.save(row);
    return this.detail(saved.id);
  }

  async remove(id: number): Promise<void> {
    const row = await this.zoneRepo.findOne({ where: { id } });
    if (!row) return;
    await this.zoneRepo.delete({ id });
    this.logger.info(`删除 light zone #${id} (${row.name})`, { context: 'LightZonesService' });
  }

  /** 启动时 seed 用 (上层 SeedService 调) — code 唯一, 已存在跳过 */
  async upsertByCode(dto: LightZoneUpsertDto): Promise<{ created: boolean; row: LightZone }> {
    const existing = await this.zoneRepo.findOne({ where: { code: dto.code } });
    if (existing) return { created: false, row: existing };
    this.validate(dto);
    const saved = await this.zoneRepo.save(
      this.zoneRepo.create({
        code: dto.code,
        name: dto.name,
        floor: dto.floor,
        gatewayCode: dto.gatewayCode,
        daliGroup: dto.daliGroup,
        sortOrder: dto.sortOrder ?? 100,
        icon: dto.icon ?? null,
        description: dto.description ?? null,
        enabled: dto.enabled ?? true,
      }),
    );
    return { created: true, row: saved };
  }

  private validate(dto: LightZoneUpsertDto): void {
    if (!dto.code || dto.code.length > 64) throw new ConflictException('code 必填且 ≤64');
    if (!dto.name || dto.name.length > 128) throw new ConflictException('name 必填且 ≤128');
    if (!dto.floor || dto.floor.length > 16) throw new ConflictException('floor 必填且 ≤16');
    if (!dto.gatewayCode) throw new ConflictException('gatewayCode 必填');
    if (!Number.isInteger(dto.daliGroup) || dto.daliGroup < 1 || dto.daliGroup > 16) {
      throw new ConflictException('daliGroup 必须是 1-16');
    }
  }

  private toView(row: LightZone, hw?: HardwareUnit): LightZoneView {
    let slaveId: number | null = null;
    let displayName: string = row.gatewayCode;
    if (hw) {
      displayName = hw.name || hw.code;
      if (hw.addressing) {
        try {
          const a = JSON.parse(hw.addressing) as { slaveId?: number };
          if (typeof a.slaveId === 'number') slaveId = a.slaveId;
        } catch {/* 老数据 */}
      }
    }
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      floor: row.floor,
      gatewayCode: row.gatewayCode,
      daliGroup: row.daliGroup,
      sortOrder: row.sortOrder,
      icon: row.icon,
      description: row.description,
      enabled: row.enabled,
      gatewaySlaveId: slaveId,
      gatewayDisplayName: displayName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
