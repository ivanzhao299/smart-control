import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { DriverTemplate } from '../../entities/driver-template.entity';
import type { DriverDescriptor } from '../../adapters/driver-descriptor';
import { CyDali64aAdapter } from '../../adapters/lighting/cy-dali64a.adapter';
import { NovaLedAdapter } from '../../adapters/led/nova-led.adapter';
import { EkxDspAdapter } from '../../adapters/audio/ekx808.adapter';
import { ModbusHvacAdapter } from '../../adapters/hvac/modbus-hvac.adapter';
import { Epo802pAdapter } from '../../adapters/power/epo802p.adapter';
import { EpaBreakerAdapter } from '../../adapters/power/epa-breaker.adapter';

/**
 * 启动时把代码里所有 adapter 的 describe() 上报到 driver_template 表 (upsert by kind, builtin=true).
 * UI 上 /admin/drivers 拉这张表; 实例化硬件时下拉选 driverKind 也拉这张表.
 *
 * 添加新 driver 类: 写新 adapter class → 加 static describe() → 在 BUILTIN_DESCRIBERS 注册.
 */
@Injectable()
export class DriverRegistryService implements OnModuleInit {
  constructor(
    @InjectRepository(DriverTemplate) private readonly repo: Repository<DriverTemplate>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /** 代码内置 driver 的 describe() 收集点 — 新增 adapter 后在这里加一行 */
  private readonly BUILTIN_DESCRIBERS: Array<() => DriverDescriptor> = [
    () => CyDali64aAdapter.describe(),
    () => NovaLedAdapter.describe(),
    () => EkxDspAdapter.describe(),
    () => ModbusHvacAdapter.describe(),
    () => Epo802pAdapter.describe(),
    // 空开: 协议层已就绪, adapter 待真机联调; 先登记进目录, 让它能被选型/配置
    () => EpaBreakerAdapter.describe(),
  ];

  async onModuleInit(): Promise<void> {
    let upserted = 0;
    for (const describer of this.BUILTIN_DESCRIBERS) {
      try {
        const d = describer();
        await this.upsertBuiltin(d);
        upserted += 1;
      } catch (err) {
        this.logger.error(
          `Driver describe() 失败 (跳过这条): ${(err as Error).message}`,
          { context: 'DriverRegistryService' },
        );
      }
    }
    this.logger.info(`Driver template registry: upserted ${upserted} builtin drivers`, {
      context: 'DriverRegistryService',
    });
  }

  private async upsertBuiltin(d: DriverDescriptor): Promise<void> {
    const existing = await this.repo.findOne({ where: { kind: d.kind } });
    const fields: Partial<DriverTemplate> = {
      kind: d.kind,
      displayName: d.displayName,
      vendor: d.vendor,
      category: d.category,
      protocol: d.protocol,
      capabilitiesJson: JSON.stringify(d.capabilities ?? []),
      defaultAddressingJson: d.defaultAddressing ? JSON.stringify(d.defaultAddressing) : null,
      paramSchemaJson: d.paramSchema ? JSON.stringify(d.paramSchema) : null,
      remark: d.remark ?? null,
      builtin: true,
      enabled: true,
    };
    if (existing) {
      await this.repo.update({ id: existing.id }, fields);
    } else {
      await this.repo.save(this.repo.create(fields));
    }
  }

  /** 列所有 enabled driver, builtin 优先排在前面 */
  async list(): Promise<DriverTemplate[]> {
    return this.repo.find({
      where: { enabled: true },
      order: { builtin: 'DESC', category: 'ASC', kind: 'ASC' },
    });
  }

  async detail(kind: string): Promise<DriverTemplate | null> {
    return this.repo.findOne({ where: { kind } });
  }

  /** P4 用 — UI 创建非 builtin 模板 (协议帧编解码仍然要靠代码里某个 adapter) */
  async createNonBuiltin(d: DriverDescriptor): Promise<DriverTemplate> {
    const exists = await this.repo.findOne({ where: { kind: d.kind } });
    if (exists) throw new Error(`driver_template kind 已存在: ${d.kind}`);
    const row = this.repo.create({
      kind: d.kind,
      displayName: d.displayName,
      vendor: d.vendor,
      category: d.category,
      protocol: d.protocol,
      capabilitiesJson: JSON.stringify(d.capabilities ?? []),
      defaultAddressingJson: d.defaultAddressing ? JSON.stringify(d.defaultAddressing) : null,
      paramSchemaJson: d.paramSchema ? JSON.stringify(d.paramSchema) : null,
      remark: d.remark ?? null,
      builtin: false,
      enabled: true,
    });
    return this.repo.save(row);
  }

  async deleteNonBuiltin(kind: string): Promise<void> {
    const row = await this.repo.findOne({ where: { kind } });
    if (!row) return;
    if (row.builtin) throw new Error(`不能删除 builtin driver: ${kind}`);
    await this.repo.delete({ id: row.id });
  }
}
