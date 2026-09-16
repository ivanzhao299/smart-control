import { createHash } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import { RuntimeConfigDocument } from '../../entities/runtime-config-document.entity';
import { RuntimeConfigRevision } from '../../entities/runtime-config-revision.entity';
import { PARK_OPS_METRICS_CONFIG_KEY } from './park-ops-metrics-config';
import { ParkOpsMetricsService } from './park-ops-metrics.service';

const fixture = (source = '园区月报', occupancy = 95) => ({
  version: 1 as const,
  source,
  updatedAt: '2026-09-16T00:00:00+08:00',
  placeholderKeys: ['occupancy'],
  metrics: { occupancy, visitors: null },
  content: { headline: '运营正常', notices: ['消防巡检完成'] },
});

describe('ParkOpsMetricsService', () => {
  const originalDataDir = process.env.DATA_DIR;
  let directory: string;
  let dataSource: DataSource;
  let store: RuntimeConfigStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'park-ops-metrics-service-'));
    process.env.DATA_DIR = directory;
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: join(directory, 'service.sqlite'),
      entities: [RuntimeConfigDocument, RuntimeConfigRevision],
      synchronize: true,
    });
    await dataSource.initialize();
    store = new RuntimeConfigStore(dataSource);
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(directory, { recursive: true, force: true });
  });

  it('imports the legacy document once and never rewrites it', async () => {
    const original = JSON.stringify(fixture(), null, 2);
    const path = join(directory, 'park-ops-metrics.json');
    writeFileSync(path, original);
    const service = new ParkOpsMetricsService(store);

    await service.onModuleInit();

    expect(service.get()).toEqual(fixture());
    expect(readFileSync(path, 'utf8')).toBe(original);
    const revision = await dataSource.getRepository(RuntimeConfigRevision).findOneByOrFail({
      key: PARK_OPS_METRICS_CONFIG_KEY,
      revision: 1,
    });
    expect(revision).toMatchObject({
      actor: 'migration',
      source: 'legacy-json:park-ops-metrics.json',
    });
    expect(revision.documentSha256).toBe(
      createHash('sha256').update(revision.document, 'utf8').digest('hex'),
    );
  });

  it('uses a valid backup without replacing a corrupt primary', async () => {
    const primary = join(directory, 'park-ops-metrics.json');
    const backup = `${primary}.bak`;
    writeFileSync(primary, '{invalid');
    writeFileSync(backup, JSON.stringify(fixture('备份')));
    const service = new ParkOpsMetricsService(store);

    await service.onModuleInit();

    expect(service.get()?.source).toBe('备份');
    expect(readFileSync(primary, 'utf8')).toBe('{invalid');
    expect(
      await dataSource.getRepository(RuntimeConfigRevision).findOneByOrFail({
        key: PARK_OPS_METRICS_CONFIG_KEY,
        revision: 1,
      }),
    ).toMatchObject({ source: 'legacy-json:park-ops-metrics.json.bak' });
  });

  it('fails closed when every existing legacy copy is invalid', async () => {
    writeFileSync(join(directory, 'park-ops-metrics.json'), '{invalid');
    writeFileSync(join(directory, 'park-ops-metrics.json.bak'), '{also-invalid');
    const service = new ParkOpsMetricsService(store);

    await expect(service.onModuleInit()).rejects.toThrow('PARK_OPS_METRICS_IMPORT_FAILED');
    await expect(
      dataSource.getRepository(RuntimeConfigDocument).findOneBy({
        key: PARK_OPS_METRICS_CONFIG_KEY,
      }),
    ).resolves.toBeNull();
  });

  it('keeps an unpublished domain null, then serializes API revisions in SQLite only', async () => {
    const service = new ParkOpsMetricsService(store);
    await service.onModuleInit();
    expect(service.get()).toBeNull();

    const first = service.update(fixture('第一次', 91));
    const second = service.update(fixture('第二次', 92));
    await expect(first).resolves.toMatchObject({ source: '第一次' });
    await expect(second).resolves.toMatchObject({ source: '第二次' });

    expect(service.get()).toMatchObject({ source: '第二次', metrics: { occupancy: 92 } });
    expect(existsSync(join(directory, 'park-ops-metrics.json'))).toBe(false);
    const current = await dataSource.getRepository(RuntimeConfigDocument).findOneByOrFail({
      key: PARK_OPS_METRICS_CONFIG_KEY,
    });
    const history = await dataSource.getRepository(RuntimeConfigRevision).find({
      where: { key: PARK_OPS_METRICS_CONFIG_KEY },
      order: { revision: 'ASC' },
    });
    expect(current.revision).toBe(2);
    expect(history.map((row) => [row.revision, row.actor, row.source])).toEqual([
      [1, 'admin-api', 'PUT /api/park-ops-metrics'],
      [2, 'admin-api', 'PUT /api/park-ops-metrics'],
    ]);
  });
});
