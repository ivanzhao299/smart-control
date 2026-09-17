import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DriverTemplate } from '../../entities/driver-template.entity';
import type { DriverDescriptor } from '../../adapters/driver-descriptor';
import { BrandsService } from '../brands/brands.service';

/**
 * 驱动模板的日常查询与非内置模板管理。
 *
 * 内置模板由版本化迁移建立和升级，服务启动不得改写权威目录。新增或修改 adapter
 * 支持时必须同时新增显式迁移，保留已有管理员状态并提供可审计版本边界。
 */
@Injectable()
export class DriverRegistryService {
  constructor(
    @InjectRepository(DriverTemplate) private readonly repo: Repository<DriverTemplate>,
    private readonly brandsService: BrandsService,
  ) {}

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
    return this.brandsService.withReference(d.vendor, async (manager) => {
      const repo = manager.getRepository(DriverTemplate);
      const exists = await repo.findOne({ where: { kind: d.kind } });
      if (exists) throw new Error(`driver_template kind 已存在: ${d.kind}`);
      const row = repo.create({
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
      return repo.save(row);
    });
  }

  async deleteNonBuiltin(kind: string): Promise<void> {
    await this.brandsService.withReference(undefined, async (manager) => {
      const repo = manager.getRepository(DriverTemplate);
      const row = await repo.findOne({ where: { kind } });
      if (!row) return;
      if (row.builtin) throw new Error(`不能删除 builtin driver: ${kind}`);
      await repo.delete({ id: row.id });
    });
  }
}
