import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VideoBindingConfig, VideoBindingService } from './video-binding.service';

const fixture = (): VideoBindingConfig => ({
  nvrs: [{
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
  }],
  channels: [{
    id: 'gate',
    nvrId: 'nvr',
    hikChannel: '101',
    name: 'Gate',
    alias: 'Gate',
    enabled: true,
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    aiEnabled: true,
    countLine: [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 }],
    roiPolygon: [],
  }],
  displayLayout: { columns: 1, channelIds: ['gate'] },
  aiBoxEnabled: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('VideoBindingService runtime persistence', () => {
  let directory: string;
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'video-binding-'));
    process.env.DATA_DIR = directory;
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(directory, { recursive: true, force: true });
  });

  it('writes atomically and retains the previous valid document', () => {
    const path = join(directory, 'video-binding.json');
    writeFileSync(path, JSON.stringify(fixture()));
    const service = new VideoBindingService();
    service.onModuleInit();

    service.updateChannelAi('gate', { roiPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] });

    const current = JSON.parse(readFileSync(path, 'utf8')) as VideoBindingConfig;
    const previous = JSON.parse(readFileSync(`${path}.bak`, 'utf8')) as VideoBindingConfig;
    expect(current.channels[0].roiPolygon).toHaveLength(3);
    expect(previous.channels[0].roiPolygon).toEqual([]);
    expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(false);
  });

  it('recovers a corrupt primary from the valid backup', () => {
    const path = join(directory, 'video-binding.json');
    writeFileSync(path, '{invalid');
    writeFileSync(`${path}.bak`, JSON.stringify(fixture()));
    const service = new VideoBindingService();

    service.onModuleInit();

    expect(service.getConfig().channels[0].countLine?.[0]).toEqual({ x: 0.2, y: 0.3 });
    expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow();
  });

  it('never exposes an NVR password in management views', () => {
    const path = join(directory, 'video-binding.json');
    writeFileSync(path, JSON.stringify(fixture()));
    const service = new VideoBindingService();
    service.onModuleInit();

    const view = service.getConfigView();

    expect(view.nvrs[0]).toMatchObject({ id: 'nvr', hasPassword: true });
    expect(view.nvrs[0]).not.toHaveProperty('password');
    expect(JSON.stringify(view)).not.toContain('existing-secret');
  });

  it('preserves the stored password when an edit submits a blank password', () => {
    const path = join(directory, 'video-binding.json');
    writeFileSync(path, JSON.stringify(fixture()));
    const service = new VideoBindingService();
    service.onModuleInit();

    const view = service.updateNvr('nvr', { name: 'Renamed Recorder', password: '' });

    expect(view).toMatchObject({ name: 'Renamed Recorder', hasPassword: true });
    expect(view).not.toHaveProperty('password');
    const stored = JSON.parse(readFileSync(path, 'utf8')) as VideoBindingConfig;
    expect(stored.nvrs[0].password).toBe('existing-secret');
  });

  it('ignores immutable and AI fields echoed by a cached legacy channel editor', () => {
    const path = join(directory, 'video-binding.json');
    writeFileSync(path, JSON.stringify(fixture()));
    const service = new VideoBindingService();
    service.onModuleInit();

    const updated = service.updateChannel('gate', {
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
});
