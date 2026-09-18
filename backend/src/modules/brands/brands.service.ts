import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Actor } from '../../common/auth/actor';
import { AuditLog } from '../../entities/audit-log.entity';
import { User } from '../../entities/user.entity';
import { CreateBrandConfigDto, LegacyUpdateBrandConfigDto, safeBrandUrl } from './brand-config.dto';
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
  configRevision: number;
  /** 统计: 这个品牌在 hardware_unit 表里被多少台设备引用 */
  hardwareCount: number;
  /** 统计: 在 driver_template 表里被多少个驱动引用 */
  driverCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type BrandUpsertDto = CreateBrandConfigDto;

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
      if (name?.trim() && !(await manager.findOneBy(Brand, { name }))) {
        const saved = await manager.save(
          Brand,
          manager.create(Brand, { name, enabled: true, configRevision: 1 }),
        );
        await this.audit(manager, null, saved, undefined, 'brand-reference:create');
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
    if (!row)
      throw new NotFoundException({
        code: 'BRAND_CONFIG_NOT_FOUND',
        message: '品牌不存在或已删除',
      });
    const [hwCount, driverCount] = await Promise.all([
      manager.countBy(HardwareUnit, { vendor: row.name }),
      manager.countBy(DriverTemplate, { vendor: row.name }),
    ]);
    return this.toView(row, hwCount, driverCount);
  }

  async create(dto: CreateBrandConfigDto, actor?: Actor): Promise<BrandView> {
    return this.write(null, dto, actor) as Promise<BrandView>;
  }

  async update(id: number, dto: LegacyUpdateBrandConfigDto, actor?: Actor): Promise<BrandView> {
    return this.write(id, dto, actor) as Promise<BrandView>;
  }

  async remove(id: number, expectedRevision?: number, actor?: Actor): Promise<void> {
    await this.write(id, { expectedRevision }, actor, true);
  }

  private async write(
    id: number | null,
    input: CreateBrandConfigDto | LegacyUpdateBrandConfigDto,
    actor?: Actor,
    remove = false,
  ): Promise<BrandView | null> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('品牌配置必须是对象');
    const type: new () => LegacyUpdateBrandConfigDto =
      id === null ? CreateBrandConfigDto : LegacyUpdateBrandConfigDto;
    const dto = plainToInstance(type, input);
    if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
      throw new BadRequestException({
        code: 'BRAND_CONFIG_INVALID',
        message: '品牌字段、链接或修订号无效',
      });
    const { expectedRevision, ...fields } = dto;
    const patch = Object.fromEntries(
      Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [
          key,
          key !== 'name' && typeof value === 'string' ? value.trim() || null : value,
        ]),
    );
    const conflict = () =>
      new ConflictException({
        code: 'BRAND_CONFIG_REVISION_CONFLICT',
        message: '品牌已被修改，请保留草稿并重新读取',
      });
    try {
      return await serializedTransaction(this.brandRepo.manager.connection, async (manager) => {
        if (actor) {
          if (actor.role !== 'admin' || actor.kind === 'legacy')
            throw new ForbiddenException('仅管理员可修改品牌配置');
          if (
            actor.kind === 'user' &&
            !(await manager.findOneBy(User, { id: actor.userId!, role: 'admin', enabled: true }))
          )
            throw new ForbiddenException('管理员权限已失效');
        }
        const repo = manager.getRepository(Brand);
        const before = id === null ? null : await repo.findOneBy({ id });
        if (id !== null && !before) {
          if (remove && expectedRevision === undefined) return null; // Explicit legacy idempotent delete.
          throw new NotFoundException({
            code: 'BRAND_CONFIG_NOT_FOUND',
            message: '品牌不存在或已删除',
          });
        }
        if (before && expectedRevision !== undefined && expectedRevision !== before.configRevision)
          throw conflict();
        let saved: Brand | null;
        if (before && remove) {
          await this.assertUnreferenced(before, manager);
          if (
            (await repo.delete({ id: before.id, configRevision: before.configRevision }))
              .affected !== 1
          )
            throw conflict();
          saved = null;
        } else if (!before) {
          saved = await repo.save(
            repo.create({
              ...patch,
              configRevision: 1,
              enabled: (patch.enabled as boolean) ?? true,
            }),
          );
        } else {
          if (patch.name !== undefined && patch.name !== before.name)
            await this.assertUnreferenced(before, manager);
          const changes = Object.fromEntries(
            Object.entries(patch).filter(([key, value]) => before[key as keyof Brand] !== value),
          );
          if (!Object.keys(changes).length) return this.detailWithManager(before.id, manager);
          if (
            !Number.isSafeInteger(before.configRevision) ||
            before.configRevision < 1 ||
            before.configRevision >= Number.MAX_SAFE_INTEGER
          )
            throw new BadRequestException({
              code: 'BRAND_CONFIG_INVALID',
              message: '品牌修订号超出安全范围',
            });
          if (
            (
              await repo.update(
                { id: before.id, configRevision: before.configRevision },
                { ...changes, configRevision: before.configRevision + 1 },
              )
            ).affected !== 1
          )
            throw conflict();
          saved = await repo.findOneByOrFail({ id: before.id });
        }
        await this.audit(manager, before, saved, actor);
        return saved ? this.detailWithManager(saved.id, manager) : null;
      });
    } catch (error) {
      if (/UNIQUE constraint failed: brands\.name/.test((error as Error).message))
        throw new ConflictException({
          code: 'BRAND_CONFIG_KEY_CONFLICT',
          message: '品牌标识已被使用',
        });
      throw error;
    }
  }

  private async audit(
    manager: EntityManager,
    before: Brand | null,
    after: Brand | null,
    actor?: Actor,
    source = 'brand-config:write',
  ): Promise<void> {
    // URLs may contain private signed query parameters; audit changes without retaining those tokens.
    const link = (value: string | null, media = false) =>
      !value ? null : safeBrandUrl(value, media) ? value.split(/[?#]/)[0] : '[invalid-url]';
    const snapshot = (row: Brand | null) =>
      row
        ? JSON.stringify({ ...row, logoUrl: link(row.logoUrl, true), website: link(row.website) })
        : null;
    await manager.insert(AuditLog, {
      entityType: 'brand',
      entityId: String((after ?? before)!.id),
      action: !after ? 'delete' : before ? 'update' : 'create',
      operator: actor?.username || 'system',
      snapshotBefore: snapshot(before),
      snapshotAfter: snapshot(after),
      remark: source,
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
      configRevision: row.configRevision,
      hardwareCount,
      driverCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
