import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { Brand } from '../../entities/brand.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { AddBrandConfigRevision1789710000000 } from '../../migrations/1789710000000-AddBrandConfigRevision';
import { DriverTemplate } from '../../entities/driver-template.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { InitialBaseline1784561601801 } from '../../migrations/1784561601801-InitialBaseline';
import { EstablishBuiltinDriverTemplates1789610000000 } from '../../migrations/1789610000000-EstablishBuiltinDriverTemplates';
import { EstablishBrandCatalog1789620000000 } from '../../migrations/1789620000000-EstablishBrandCatalog';
import { BrandsService } from './brands.service';

const CATALOG_SHA256 = '58bd22ed134e119565623ae4c5fcb27943fd5b2ee7eb37254a29180ce794d036';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

describe('EstablishBrandCatalog migration', () => {
  let directory: string;
  let dataSource: DataSource;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'brand-catalog-migration-'));
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: join(directory, 'migration.sqlite'),
      entities: [Brand, DriverTemplate, HardwareUnit, AuditLog],
      migrations: [
        InitialBaseline1784561601801,
        EstablishBuiltinDriverTemplates1789610000000,
        EstablishBrandCatalog1789620000000,
        AddBrandConfigRevision1789710000000,
      ],
      migrationsTableName: 'migrations',
      synchronize: false,
    });
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    rmSync(directory, { recursive: true, force: true });
  });

  async function resetToPreMigration(rowsSql: string[] = []): Promise<void> {
    await dataSource.runMigrations();
    await dataSource.query('DELETE FROM migrations WHERE name = ?', [
      'EstablishBrandCatalog1789620000000',
    ]);
    await dataSource.query('DELETE FROM brands');
    for (const sql of rowsSql) await dataSource.query(sql);
  }

  it('creates the twelve product brands with the production catalog fingerprint', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();

    const rows = (await dataSource.query(
      `SELECT name, "displayName", "logoUrl", country, website, "salesContact",
              "techContact", remark, enabled FROM brands ORDER BY name`,
    )) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.enabled === 1)).toBe(true);
    expect(createHash('sha256').update(stableJson(rows), 'utf8').digest('hex')).toBe(
      CATALOG_SHA256,
    );
    expect(await dataSource.runMigrations()).toEqual([]);
  });

  it('preserves maintained brands and fills current referenced vendors without overwriting', async () => {
    await dataSource.initialize();
    await resetToPreMigration([
      `INSERT INTO brands
       (name, "displayName", "logoUrl", country, website, "salesContact", "techContact",
        remark, enabled, created_at, updated_at)
       VALUES
       ('JBT', '现场显示名', '/media/logo.png', '中国', 'https://example.test', 'sales',
        'support', 'keep me', 0, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
       ('现场保留品牌', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0,
        '2026-01-03 00:00:00', '2026-01-04 00:00:00')`,
      `INSERT INTO driver_templates
       (kind, "displayName", vendor, category, protocol, "capabilitiesJson", builtin, enabled,
        created_at, updated_at)
       VALUES ('site-driver', '现场驱动', '现场引用品牌', 'custom', 'custom', '[]', 0, 1,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ]);

    const before = await dataSource.query(
      `SELECT * FROM brands WHERE name IN ('JBT', '现场保留品牌') ORDER BY name`,
    );
    await dataSource.runMigrations();
    const after = await dataSource.query(
      `SELECT * FROM brands WHERE name IN ('JBT', '现场保留品牌') ORDER BY name`,
    );

    expect(after).toEqual(before);
    expect(await dataSource.getRepository(Brand).count()).toBe(14);
    expect(
      await dataSource.getRepository(Brand).findOneByOrFail({ name: '现场引用品牌' }),
    ).toMatchObject({
      enabled: true,
      displayName: null,
    });
  });

  it('refuses an unarchived rollback while authoritative brands exist', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    const runner = dataSource.createQueryRunner();
    await expect(new EstablishBrandCatalog1789620000000().down(runner)).rejects.toThrow(
      'BRAND_CATALOG_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await runner.release();
  });

  it('establishes a brand at reference-write time without changing maintained metadata', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    const brandRepo = dataSource.getRepository(Brand);
    const service = new BrandsService(
      brandRepo,
      dataSource.getRepository(HardwareUnit),
      dataSource.getRepository(DriverTemplate),
    );
    await brandRepo.update(
      { name: 'JBT' },
      { displayName: '现场显示名', logoUrl: '/media/logo.png', enabled: false },
    );
    const before = await brandRepo.findOneByOrFail({ name: 'JBT' });

    await service.ensureReferenced('JBT');
    await service.ensureReferenced('新增引用品牌');
    await service.ensureReferenced('新增引用品牌');
    await service.ensureReferenced('   ');

    expect(await brandRepo.findOneByOrFail({ name: 'JBT' })).toEqual(before);
    expect(await brandRepo.findOneByOrFail({ name: '新增引用品牌' })).toMatchObject({
      enabled: true,
      displayName: null,
    });
    expect(await brandRepo.countBy({ name: '新增引用品牌' })).toBe(1);
    expect(await brandRepo.countBy({ name: '   ' })).toBe(0);
  });
});
