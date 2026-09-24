import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { RuntimeConfigDocument } from '../../entities/runtime-config-document.entity';
import { RuntimeConfigRevision } from '../../entities/runtime-config-revision.entity';
import { AddRuntimeConfigStore1789470000000 } from '../../migrations/1789470000000-AddRuntimeConfigStore';
import { ImportVideoBindingRuntimeConfig1789560000000 } from '../../migrations/1789560000000-ImportVideoBindingRuntimeConfig';
import { EnsureVideoBindingRuntimeConfig1789590000000 } from '../../migrations/1789590000000-EnsureVideoBindingRuntimeConfig';
import { defaultVideoBindingConfig, normalizeVideoBindingConfig } from './video-binding-config';

describe('ImportVideoBindingRuntimeConfig migration', () => {
  const originalDataDir = process.env.DATA_DIR;
  let directory: string;
  let dataSource: DataSource;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'video-binding-migration-'));
    process.env.DATA_DIR = directory;
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: join(directory, 'migration.sqlite'),
      entities: [RuntimeConfigDocument, RuntimeConfigRevision],
      migrations: [
        AddRuntimeConfigStore1789470000000,
        ImportVideoBindingRuntimeConfig1789560000000,
        EnsureVideoBindingRuntimeConfig1789590000000,
      ],
      migrationsTableName: 'migrations',
      synchronize: false,
    });
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(directory, { recursive: true, force: true });
  });

  it('imports normalized detection geometry and writes a matching revision atomically', async () => {
    const legacy = {
      nvrs: [
        {
          id: 'nvr',
          name: 'Recorder',
          ip: '10.0.0.1',
          port: 80,
          rtspPort: 554,
          username: 'admin',
          password: 'secret',
          brand: 'hikvision',
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      channels: [
        {
          id: 'd37',
          nvrId: 'nvr',
          hikChannel: '101',
          name: 'Gate',
          alias: 'Gate',
          enabled: true,
          sortOrder: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          aiEnabled: true,
          countLine: [
            { x: -1, y: 0.25 },
            { x: 2, y: 0.75 },
          ],
          roiPolygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 1 },
          ],
        },
      ],
      displayLayout: { columns: 1, channelIds: ['d37'] },
      aiBoxEnabled: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    writeFileSync(join(directory, 'video-binding.json'), JSON.stringify(legacy));

    await dataSource.initialize();
    expect((await dataSource.runMigrations()).map((migration) => migration.name)).toEqual([
      'AddRuntimeConfigStore1789470000000',
      'ImportVideoBindingRuntimeConfig1789560000000',
      'EnsureVideoBindingRuntimeConfig1789590000000',
    ]);

    const document = await dataSource.getRepository(RuntimeConfigDocument).findOneByOrFail({
      key: 'video.binding',
    });
    const revision = await dataSource.getRepository(RuntimeConfigRevision).findOneByOrFail({
      key: 'video.binding',
      revision: 1,
    });
    const normalized = normalizeVideoBindingConfig(legacy);
    const expectedDocument = JSON.stringify(normalized);

    expect(document).toMatchObject({ schemaVersion: 1, revision: 1, document: expectedDocument });
    expect(document.documentSha256).toBe(
      createHash('sha256').update(expectedDocument, 'utf8').digest('hex'),
    );
    expect(revision).toMatchObject({
      document: document.document,
      documentSha256: document.documentSha256,
      actor: 'migration',
      source: 'legacy-json:video-binding.json',
    });
    expect(normalized.channels[0].countLine).toEqual([
      { x: 0, y: 0.25 },
      { x: 1, y: 0.75 },
    ]);
    expect(normalized.channels[0].roiPolygon?.[2]).toEqual({ x: 1, y: 1 });
    expect(await dataSource.showMigrations()).toBe(false);
    expect(await dataSource.runMigrations()).toEqual([]);
  });

  it('creates one deterministic default revision when no legacy file exists', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();

    const document = await dataSource.getRepository(RuntimeConfigDocument).findOneByOrFail({
      key: 'video.binding',
    });
    const revision = await dataSource.getRepository(RuntimeConfigRevision).findOneByOrFail({
      key: 'video.binding',
      revision: 1,
    });
    const expected = JSON.stringify(defaultVideoBindingConfig('1970-01-01T00:00:00.000Z'));

    expect(document).toMatchObject({ revision: 1, document: expected });
    expect(revision).toMatchObject({ actor: 'migration', source: 'built-in-default' });
    expect(await dataSource.runMigrations()).toEqual([]);
  });
});
