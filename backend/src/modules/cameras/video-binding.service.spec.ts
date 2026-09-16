import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import { RuntimeConfigDocument } from '../../entities/runtime-config-document.entity';
import { RuntimeConfigRevision } from '../../entities/runtime-config-revision.entity';
import {
  normalizeVideoBindingConfig,
  VIDEO_BINDING_CONFIG_KEY,
  VideoBindingConfig,
} from './video-binding-config';
import { VideoBindingService } from './video-binding.service';

const fixture = (): VideoBindingConfig => ({
  nvrs: [
    {
      id: 'nvr',
      name: 'Recorder',
      ip: '192.168.1.10',
      port: 80,
      rtspPort: 554,
      username: 'admin',
      password: 'existing-secret',
      brand: 'hikvision',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  channels: [
    {
      id: 'gate',
      nvrId: 'nvr',
      hikChannel: '101',
      name: 'Gate',
      alias: 'Gate',
      enabled: true,
      sortOrder: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      aiEnabled: true,
      countLine: [
        { x: 0.2, y: 0.3 },
        { x: 0.8, y: 0.7 },
      ],
      roiPolygon: [],
    },
  ],
  displayLayout: { columns: 1, channelIds: ['gate'] },
  aiBoxEnabled: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('VideoBindingService database persistence', () => {
  let directory: string;
  let dataSource: DataSource;
  let store: RuntimeConfigStore;
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'video-binding-'));
    process.env.DATA_DIR = directory;
    dataSource = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [RuntimeConfigDocument, RuntimeConfigRevision],
      synchronize: true,
    }).initialize();
    store = new RuntimeConfigStore(dataSource);
  });

  afterEach(async () => {
    await dataSource.destroy();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(directory, { recursive: true, force: true });
  });

  async function startService(): Promise<VideoBindingService> {
    const service = new VideoBindingService(store);
    await service.onModuleInit();
    return service;
  }

  it('imports legacy JSON once and records the authoritative first revision', async () => {
    const path = join(directory, 'video-binding.json');
    const original = JSON.stringify(fixture(), null, 2);
    writeFileSync(path, original);

    const service = await startService();
    const snapshot = await store.read(VIDEO_BINDING_CONFIG_KEY, normalizeVideoBindingConfig);
    const history = await dataSource.getRepository(RuntimeConfigRevision).find();

    expect(service.getConfig().channels[0].countLine?.[0]).toEqual({ x: 0.2, y: 0.3 });
    expect(snapshot).toMatchObject({ revision: 1, value: fixture() });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      actor: 'migration',
      source: 'legacy-json:video-binding.json',
    });
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  it('keeps legacy JSON read-only and persists edits as immutable database revisions', async () => {
    const path = join(directory, 'video-binding.json');
    const original = JSON.stringify(fixture());
    writeFileSync(path, original);
    const service = await startService();

    await service.updateChannelAi('gate', {
      roiPolygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    });

    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(
      (await store.read(VIDEO_BINDING_CONFIG_KEY, normalizeVideoBindingConfig))?.value.channels[0]
        .roiPolygon,
    ).toHaveLength(3);
    expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(2);
  });

  it('uses the database after restart and never reimports changed or corrupt legacy JSON', async () => {
    const path = join(directory, 'video-binding.json');
    writeFileSync(path, JSON.stringify(fixture()));
    const first = await startService();
    await first.updateChannelAi('gate', {
      roiPolygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    });
    writeFileSync(path, '{invalid');

    const restarted = await startService();

    expect(restarted.getConfig().channels[0].roiPolygon).toHaveLength(3);
    expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(2);
  });

  it('imports a valid backup when the primary is corrupt without rewriting either file', async () => {
    const path = join(directory, 'video-binding.json');
    const backup = JSON.stringify(fixture());
    writeFileSync(path, '{invalid');
    writeFileSync(`${path}.bak`, backup);

    const service = await startService();
    const history = await dataSource
      .getRepository(RuntimeConfigRevision)
      .findOneByOrFail({ revision: 1 });

    expect(service.getConfig().channels[0].id).toBe('gate');
    expect(history.source).toBe('legacy-json:video-binding.json.bak');
    expect(readFileSync(path, 'utf8')).toBe('{invalid');
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe(backup);
  });

  it('fails closed when all discovered legacy documents are corrupt', async () => {
    const path = join(directory, 'video-binding.json');
    writeFileSync(path, '{invalid');
    writeFileSync(`${path}.bak`, '{also-invalid');

    await expect(startService()).rejects.toThrow('VIDEO_BINDING_IMPORT_FAILED');
    expect(await dataSource.getRepository(RuntimeConfigDocument).count()).toBe(0);
    expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(0);
  });

  it('never exposes passwords and preserves a stored password on a blank edit', async () => {
    writeFileSync(join(directory, 'video-binding.json'), JSON.stringify(fixture()));
    const service = await startService();

    const view = service.getConfigView();
    const updated = await service.updateNvr('nvr', { name: 'Renamed Recorder', password: '' });
    const stored = await store.read(VIDEO_BINDING_CONFIG_KEY, normalizeVideoBindingConfig);

    expect(view.nvrs[0]).toMatchObject({ id: 'nvr', hasPassword: true });
    expect(view.nvrs[0]).not.toHaveProperty('password');
    expect(JSON.stringify(view)).not.toContain('existing-secret');
    expect(updated).toMatchObject({ name: 'Renamed Recorder', hasPassword: true });
    expect(stored?.value.nvrs[0].password).toBe('existing-secret');
  });

  it('resolves stream aliases from the same authoritative binding document', async () => {
    writeFileSync(join(directory, 'video-binding.json'), JSON.stringify(fixture()));
    const service = await startService();

    const binding = service.resolveStreamBinding('gate');

    expect(binding).toMatchObject({
      id: 'gate',
      hikChannel: '101',
      nvr: { id: 'nvr', ip: '192.168.1.10', username: 'admin', password: 'existing-secret' },
    });
    expect(service.resolveStreamBinding('missing')).toBeNull();
    expect(service.getStreamChannelViews()).toEqual([
      { channel: 'gate', name: 'Gate', nvr: 'Recorder', hikChannel: '101' },
    ]);
  });

  it('does not let a cached base editor overwrite AI fields or immutable fields', async () => {
    writeFileSync(join(directory, 'video-binding.json'), JSON.stringify(fixture()));
    const service = await startService();

    const updated = await service.updateChannel('gate', {
      id: 'stale-id',
      createdAt: 'stale-date',
      name: 'Renamed Gate',
      aiEnabled: false,
      roiPolygon: [{ x: 0.1, y: 0.1 }],
    });

    expect(updated).toMatchObject({
      id: 'gate',
      createdAt: '2026-01-01T00:00:00.000Z',
      name: 'Renamed Gate',
      aiEnabled: true,
      roiPolygon: [],
    });
  });

  it('serializes simultaneous edits so both survive with consecutive revisions', async () => {
    writeFileSync(join(directory, 'video-binding.json'), JSON.stringify(fixture()));
    const service = await startService();

    await Promise.all([
      service.updateChannelAi('gate', {
        roiPolygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
      service.updateChannel('gate', { name: 'Concurrent Gate' }),
    ]);

    const snapshot = await store.read(VIDEO_BINDING_CONFIG_KEY, normalizeVideoBindingConfig);
    expect(snapshot).toMatchObject({ revision: 3 });
    expect(snapshot?.value.channels[0]).toMatchObject({ name: 'Concurrent Gate' });
    expect(snapshot?.value.channels[0].roiPolygon).toHaveLength(3);
    expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(3);
  });
});
