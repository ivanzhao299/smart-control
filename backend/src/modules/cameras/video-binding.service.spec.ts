import { mkdtempSync, rmSync, writeFileSync } from 'fs';
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

  async function initializeFixture(): Promise<void> {
    await store.initialize({
      key: VIDEO_BINDING_CONFIG_KEY,
      schemaVersion: 1,
      value: fixture(),
      normalize: normalizeVideoBindingConfig,
      actor: 'migration',
      source: 'test-fixture',
    });
  }

  it('loads the authoritative database revision and persists edits as immutable revisions', async () => {
    await initializeFixture();
    const service = await startService();

    await service.updateChannelAi('gate', {
      roiPolygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    });

    expect(
      (await store.read(VIDEO_BINDING_CONFIG_KEY, normalizeVideoBindingConfig))?.value.channels[0]
        .roiPolygon,
    ).toHaveLength(3);
    expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(2);
  });

  it('uses the database after restart and ignores changed or corrupt legacy JSON', async () => {
    const path = join(directory, 'video-binding.json');
    await initializeFixture();
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

  it('fails closed when migrations did not establish the authoritative document', async () => {
    await expect(startService()).rejects.toThrow('VIDEO_BINDING_CONFIG_MISSING');
    expect(await dataSource.getRepository(RuntimeConfigDocument).count()).toBe(0);
    expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(0);
  });

  it('never exposes passwords and preserves a stored password on a blank edit', async () => {
    await initializeFixture();
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
    await initializeFixture();
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
    await initializeFixture();
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
    await initializeFixture();
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

  it('rejects a stale detection-range editor revision without changing stored geometry', async () => {
    await initializeFixture();
    const service = await startService();
    const openedRevision = service.getConfigView().revision;

    await service.updateChannel('gate', { name: 'Newer Gate Name' });

    await expect(
      service.updateChannelAi(
        'gate',
        {
          countLine: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          roiPolygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
        },
        { expectedRevision: openedRevision },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VIDEO_BINDING_REVISION_CONFLICT' }),
    });

    const snapshot = await store.read(VIDEO_BINDING_CONFIG_KEY, normalizeVideoBindingConfig);
    expect(snapshot).toMatchObject({ revision: openedRevision + 1 });
    expect(snapshot?.value.channels[0]).toMatchObject({
      name: 'Newer Gate Name',
      countLine: [
        { x: 0.2, y: 0.3 },
        { x: 0.8, y: 0.7 },
      ],
      roiPolygon: [],
    });
    expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(2);
  });

  it('applies revision conflicts to every write path and preserves the newer document', async () => {
    await initializeFixture();
    const service = await startService();
    const openedRevision = service.getConfigView().revision;

    await service.updateDisplayLayout(
      { columns: 2 },
      { expectedRevision: openedRevision, actor: 'user:1:owner' },
    );

    await expect(
      service.updateNvr(
        'nvr',
        { name: 'Stale Recorder Name' },
        { expectedRevision: openedRevision, actor: 'user:2:stale-admin' },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'VIDEO_BINDING_REVISION_CONFLICT',
        expectedRevision: openedRevision,
        currentRevision: openedRevision + 1,
      }),
    });

    const snapshot = await store.read(VIDEO_BINDING_CONFIG_KEY, normalizeVideoBindingConfig);
    expect(snapshot).toMatchObject({ revision: openedRevision + 1 });
    expect(snapshot?.value.displayLayout.columns).toBe(2);
    expect(snapshot?.value.nvrs[0].name).toBe('Recorder');
  });

  it('records the named administrator and does not create revisions for identical writes', async () => {
    await initializeFixture();
    const service = await startService();

    await service.updateDisplayLayout(
      { columns: 2 },
      { expectedRevision: 1, actor: 'user:1:owner' },
    );
    await service.updateDisplayLayout(
      { columns: 2 },
      { expectedRevision: 2, actor: 'user:1:owner' },
    );

    const history = await dataSource.getRepository(RuntimeConfigRevision).find({
      order: { revision: 'ASC' },
    });
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      revision: 2,
      actor: 'user:1:owner',
      source: 'PUT /api/video-binding/layout',
    });
    expect(service.getConfigView().revision).toBe(2);
  });

  it('returns stable API error codes for missing resources and invalid references', async () => {
    await initializeFixture();
    const service = await startService();

    await expect(service.updateChannel('missing', { name: 'Nope' })).rejects.toMatchObject({
      status: 404,
      response: expect.objectContaining({ code: 'VIDEO_BINDING_CHANNEL_NOT_FOUND' }),
    });
    await expect(
      service.createChannel({
        nvrId: 'missing',
        hikChannel: '101',
        name: 'Unknown recorder',
        alias: 'unknown-recorder',
        enabled: true,
        sortOrder: 2,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'VIDEO_BINDING_NVR_NOT_FOUND' }),
    });
  });
});
