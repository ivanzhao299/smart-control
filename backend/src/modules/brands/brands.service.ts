import { ConflictException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { Brand } from '../../entities/brand.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { DriverTemplate } from '../../entities/driver-template.entity';

export interface BrandView {
  id: number;
  name: string;
  displayName: string | null;
  logoUrl: string | null;
  country: string | null;
  website: string | null;
  salesContact: string | null;
  techContact: string | null;
  remark: string | null;
  enabled: boolean;
  /** 统计: 这个品牌在 hardware_unit 表里被多少台设备引用 */
  hardwareCount: number;
  /** 统计: 在 driver_template 表里被多少个驱动引用 */
  driverCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrandUpsertDto {
  name: string;
  displayName?: string | null;
  logoUrl?: string | null;
  country?: string | null;
  website?: string | null;
  salesContact?: string | null;
  techContact?: string | null;
  remark?: string | null;
  enabled?: boolean;
}

@Injectable()
export class BrandsService implements OnModuleInit {
  constructor(
    @InjectRepository(Brand) private readonly brandRepo: Repository<Brand>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    @InjectRepository(DriverTemplate) private readonly driverRepo: Repository<DriverTemplate>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * 启动时把 hardware_unit / driver_template 里已用到的 vendor 字符串自动
   * 注入 brand 表 (跟 DriverRegistry 同模式). 已存在的不覆盖, 让 admin 加完
   * logo / 联系方式后保留.
   */
  async onModuleInit(): Promise<void> {
    const hwVendors = await this.hwRepo
      .createQueryBuilder('h')
      .select('DISTINCT h.vendor', 'vendor')
      .getRawMany<{ vendor: string }>();
    const driverVendors = await this.driverRepo
      .createQueryBuilder('d')
      .select('DISTINCT d.vendor', 'vendor')
      .getRawMany<{ vendor: string }>();
    const all = new Set([
      ...hwVendors.map((r) => r.vendor).filter(Boolean),
      ...driverVendors.map((r) => r.vendor).filter(Boolean),
    ]);
    let added = 0;
    for (const name of all) {
      const existing = await this.brandRepo.findOne({ where: { name } });
      if (!existing) {
        await this.brandRepo.save(this.brandRepo.create({ name, enabled: true }));
        added += 1;
      }
    }
    if (added > 0) {
      this.logger.info(`BrandsService bootstrap: 自动注入 ${added} 个 vendor 到 brands 表`, {
        context: 'BrandsService',
      });
    }
  }

  async list(): Promise<BrandView[]> {
    const brands = await this.brandRepo.find({ order: { enabled: 'DESC', name: 'ASC' } });
    // 一次性算每个 vendor 的引用计数, 避免 N+1
    const hwCounts = await this.hwRepo
      .createQueryBuilder('h')
      .select('h.vendor', 'vendor')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('h.vendor')
      .getRawMany<{ vendor: string; cnt: string | number }>();
    const driverCounts = await this.driverRepo
      .createQueryBuilder('d')
      .select('d.vendor', 'vendor')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('d.vendor')
      .getRawMany<{ vendor: string; cnt: string | number }>();
    const hwMap = new Map(hwCounts.map((r) => [r.vendor, Number(r.cnt)]));
    const driverMap = new Map(driverCounts.map((r) => [r.vendor, Number(r.cnt)]));
    return brands.map((b) => this.toView(b, hwMap.get(b.name) ?? 0, driverMap.get(b.name) ?? 0));
  }

  async detail(id: number): Promise<BrandView> {
    const row = await this.brandRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`brand#${id} 不存在`);
    const [hwCount, driverCount] = await Promise.all([
      this.hwRepo.count({ where: { vendor: row.name } }),
      this.driverRepo.count({ where: { vendor: row.name } }),
    ]);
    return this.toView(row, hwCount, driverCount);
  }

  async create(dto: BrandUpsertDto): Promise<BrandView> {
    const dup = await this.brandRepo.findOne({ where: { name: dto.name } });
    if (dup) throw new ConflictException(`品牌名已存在: ${dto.name}`);
    const row = this.brandRepo.create({
      name: dto.name,
      displayName: dto.displayName ?? null,
      logoUrl: dto.logoUrl ?? null,
      country: dto.country ?? null,
      website: dto.website ?? null,
      salesContact: dto.salesContact ?? null,
      techContact: dto.techContact ?? null,
      remark: dto.remark ?? null,
      enabled: dto.enabled ?? true,
    });
    const saved = await this.brandRepo.save(row);
    return this.toView(saved, 0, 0);
  }

  async update(id: number, dto: Partial<BrandUpsertDto>): Promise<BrandView> {
    const row = await this.brandRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`brand#${id} 不存在`);
    if (dto.name && dto.name !== row.name) {
      const dup = await this.brandRepo.findOne({ where: { name: dto.name } });
      if (dup && dup.id !== id) throw new ConflictException(`品牌名已存在: ${dto.name}`);
    }
    Object.assign(row, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.displayName !== undefined && { displayName: dto.displayName }),
      ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
      ...(dto.country !== undefined && { country: dto.country }),
      ...(dto.website !== undefined && { website: dto.website }),
      ...(dto.salesContact !== undefined && { salesContact: dto.salesContact }),
      ...(dto.techContact !== undefined && { techContact: dto.techContact }),
      ...(dto.remark !== undefined && { remark: dto.remark }),
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
    });
    const saved = await this.brandRepo.save(row);
    return this.detail(saved.id);
  }

  async remove(id: number): Promise<void> {
    const row = await this.brandRepo.findOne({ where: { id } });
    if (!row) return;
    const [hwCount, driverCount] = await Promise.all([
      this.hwRepo.count({ where: { vendor: row.name } }),
      this.driverRepo.count({ where: { vendor: row.name } }),
    ]);
    if (hwCount + driverCount > 0) {
      throw new ConflictException(
        `不能删除: 品牌 "${row.name}" 还被 ${hwCount} 台设备 / ${driverCount} 个驱动引用. 先把那些记录的 vendor 改掉.`,
      );
    }
    await this.brandRepo.delete({ id });
  }

  private toView(row: Brand, hardwareCount: number, driverCount: number): BrandView {
    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      logoUrl: row.logoUrl,
      country: row.country,
      website: row.website,
      salesContact: row.salesContact,
      techContact: row.techContact,
      remark: row.remark,
      enabled: row.enabled,
      hardwareCount,
      driverCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
