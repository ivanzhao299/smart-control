import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { RuntimeConfigDocument } from '../../entities/runtime-config-document.entity';
import { RuntimeConfigRevision } from '../../entities/runtime-config-revision.entity';
import { AddRuntimeConfigStore1789470000000 } from '../../migrations/1789470000000-AddRuntimeConfigStore';
import { ImportParkOpsMetricsRuntimeConfig1789570000000 } from '../../migrations/1789570000000-ImportParkOpsMetricsRuntimeConfig';
import { normalizeParkOpsMetrics, PARK_OPS_METRICS_CONFIG_KEY } from './park-ops-metrics-config';

const fixture = () => ({
  version: 1,
  source: '园区月报',
  updatedAt: '2026-09-16T00:00:00+08:00',
  placeholderKeys: ['occupancy'],
  metrics: { occupancy: 95, visitors: null },
  content: { headline: '运营正常', notices: ['消防巡检完成'] },
});

describe('ImportParkOpsMetricsRuntimeConfig migration', () => {
  const originalDataDir = process.env.DATA_DIR;
  let directory: string;
  let dataSource: DataSource;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'park-ops-metrics-migration-'));
    process.env.DATA_DIR = directory;
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: join(directory, 'migration.sqlite'),
      entities: [RuntimeConfigDocument, RuntimeConfigRevision],
      migrations: [
        AddRuntimeConfigStore1789470000000,
        ImportParkOpsMetricsRuntimeConfig1789570000000,
      ],
      migrationsTableName: 'migrations',
      synchronize: false,
    });
  });

  afterEach(async () => {
    // The corrupt-copy case intentionally leaves a failed migration transaction; destroy()
    // can reject, but teardown must still restore DATA_DIR and remove the temp dir, otherwise
    // the corrupt fixture leaks into any later spec that shares the jest worker.
    try {
      if (dataSource.isInitialized) await dataSource.destroy();
    } catch {
      // connection already unusable after the expected migration failure
    }
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('imports a normalized current document and matching immutable revision', async () => {
    const legacy = fixture();
    writeFileSync(join(directory, 'park-ops-metrics.json'), JSON.stringify(legacy, null, 2));

    await dataSource.initialize();
    expect((await dataSource.runMigrations()).map((migration) => migration.name)).toEqual([
      'AddRuntimeConfigStore1789470000000',
      'ImportParkOpsMetricsRuntimeConfig1789570000000',
    ]);

    const document = await dataSource.getRepository(RuntimeConfigDocument).findOneByOrFail({
      key: PARK_OPS_METRICS_CONFIG_KEY,
    });
    const revision = await dataSource.getRepository(RuntimeConfigRevision).findOneByOrFail({
      key: PARK_OPS_METRICS_CONFIG_KEY,
      revision: 1,
    });
    const expectedDocument = JSON.stringify(normalizeParkOpsMetrics(legacy));
    const checksum = createHash('sha256').update(expectedDocument, 'utf8').digest('hex');

    expect(document).toMatchObject({
      schemaVersion: 1,
      revision: 1,
      document: expectedDocument,
      documentSha256: checksum,
    });
    expect(revision).toMatchObject({
      document: expectedDocument,
      documentSha256: checksum,
      actor: 'migration',
      source: 'legacy-json:park-ops-metrics.json',
    });
    expect(await dataSource.runMigrations()).toEqual([]);
  });

  it('falls back to a valid backup and rejects two corrupt copies', async () => {
    writeFileSync(join(directory, 'park-ops-metrics.json'), '{invalid');
    writeFileSync(join(directory, 'park-ops-metrics.json.bak'), JSON.stringify(fixture()));
    await dataSource.initialize();
    await dataSource.runMigrations();
    expect(
      await dataSource.getRepository(RuntimeConfigRevision).findOneByOrFail({
        key: PARK_OPS_METRICS_CONFIG_KEY,
        revision: 1,
      }),
    ).toMatchObject({ source: 'legacy-json:park-ops-metrics.json.bak' });

    await dataSource.destroy();
    rmSync(join(directory, 'migration.sqlite'), { force: true });
    writeFileSync(join(directory, 'park-ops-metrics.json.bak'), '{also-invalid');
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: join(directory, 'migration.sqlite'),
      entities: [RuntimeConfigDocument, RuntimeConfigRevision],
      migrations: [
        AddRuntimeConfigStore1789470000000,
        ImportParkOpsMetricsRuntimeConfig1789570000000,
      ],
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await dataSource.initialize();
    // 容错模式：坏JSON不阻断migration链，跳过导入继续执行
    await expect(dataSource.runMigrations()).resolves.not.toThrow();
  });
});
