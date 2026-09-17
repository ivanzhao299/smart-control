import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
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
export class BrandsService {
  constructor(
    @InjectRepository(Brand) private readonly brandRepo: Repository<Brand>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    @InjectRepository(DriverTemplate) private readonly driverRepo: Repository<DriverTemplate>,
  ) {}

  /** Standalone catalog maintenance only; reference writers must use withReference. */
  async ensureReferenced(name: string): Promise<void> {
    await this.withReference(name, async () => undefined);
  }

  /**
   * Catalog establishment and its referencing row are one transaction. Callers must
   * use the supplied manager, and keep physical I/O and post-commit logging outside.
   * Exact vendor strings are intentional: never normalize an existing soft-link key.
   */
  async withReference<T>(
    name: string | undefined,
    writeReference: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return serializedTransaction(this.brandRepo.manager.connection, async (manager) => {
      if (name?.trim()) {
        await manager.query(
          `INSERT INTO brands (name, enabled, created_at, updated_at)
           SELECT ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
           WHERE NOT EXISTS (SELECT 1 FROM brands WHERE name = ?)`,
          [name, name],
        );
      }
      return writeReference(manager);
    });
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
    return this.detailWithManager(id, this.brandRepo.manager);
  }

  private async detailWithManager(id: number, manager: EntityManager): Promise<BrandView> {
    const row = await manager.findOneBy(Brand, { id });
    if (!row) throw new NotFoundException(`brand#${id} 不存在`);
    const [hwCount, driverCount] = await Promise.all([
      manager.countBy(HardwareUnit, { vendor: row.name }),
      manager.countBy(DriverTemplate, { vendor: row.name }),
    ]);
    return this.toView(row, hwCount, driverCount);
  }

  async create(dto: BrandUpsertDto): Promise<BrandView> {
    this.assertValidName(dto.name);
    return serializedTransaction(this.brandRepo.manager.connection, async (manager) => {
      const repo = manager.getRepository(Brand);
      const dup = await repo.findOne({ where: { name: dto.name } });
      if (dup) throw new ConflictException(`品牌名已存在: ${dto.name}`);
      const row = repo.create({
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
      const saved = await repo.save(row);
      return this.toView(saved, 0, 0);
    });
  }

  async update(id: number, dto: Partial<BrandUpsertDto>): Promise<BrandView> {
    if (dto.name !== undefined) this.assertValidName(dto.name);
    return serializedTransaction(this.brandRepo.manager.connection, async (manager) => {
      const repo = manager.getRepository(Brand);
      const row = await repo.findOne({ where: { id } });
      if (!row) throw new NotFoundException(`brand#${id} 不存在`);
      if (dto.name !== undefined && dto.name !== row.name) {
        await this.assertUnreferenced(row, manager);
        const dup = await repo.findOne({ where: { name: dto.name } });
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
      const saved = await repo.save(row);
      return this.detailWithManager(saved.id, manager);
    });
  }

  async remove(id: number): Promise<void> {
    return serializedTransaction(this.brandRepo.manager.connection, async (manager) => {
      const row = await manager.findOneBy(Brand, { id });
      if (!row) return;
      await this.assertUnreferenced(row, manager);
      await manager.delete(Brand, { id });
    });
  }

  private async assertUnreferenced(row: Brand, manager: EntityManager): Promise<void> {
    const [hwCount, driverCount] = await Promise.all([
      manager.countBy(HardwareUnit, { vendor: row.name }),
      manager.countBy(DriverTemplate, { vendor: row.name }),
    ]);
    if (hwCount + driverCount > 0) {
      throw new ConflictException({
        code: 'BRAND_REFERENCED',
        message: `品牌 "${row.name}" 被 ${hwCount} 台设备 / ${driverCount} 个驱动引用，不能改标识或删除；可修改显示名称。`,
        hardwareCount: hwCount,
        driverCount,
      });
    }
  }

  private assertValidName(name: unknown): void {
    if (typeof name !== 'string' || !name.trim() || name.length > 128) {
      throw new BadRequestException({
        code: 'BRAND_NAME_INVALID',
        message: '品牌标识必须是 1–128 字符的非空文本',
      });
    }
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
