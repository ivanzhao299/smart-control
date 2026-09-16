import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { hostname, tmpdir } from 'os';
import { join } from 'path';
import { ActorAdminGuard } from '../../common/guards/actor-admin.guard';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

describe('system runtime identity and data summary', () => {
  const originalEnv = { ...process.env };
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'runtime-summary-'));
    process.env.DATA_DIR = directory;
    process.env.MEDIA_ROOT = join(directory, 'media');
    process.env.RELEASE_MANIFEST_PATH = join(directory, 'release.json');
    process.env.APP_COMMIT = 'a'.repeat(40);
    process.env.APP_REF = 'main';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(directory, { recursive: true, force: true });
  });

  function fixture(connectedPath = join(directory, 'smart-control.db')) {
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'database') return { path: join(directory, 'smart-control.db') };
        if (key === 'logger') return { dir: join(directory, 'logs') };
        throw new Error(`unexpected config: ${key}`);
      }),
    };
    const dataSource = {
      options: { database: connectedPath },
      query: jest.fn(async (sql: string) => {
        if (sql.startsWith('SELECT timestamp')) {
          return [
            { timestamp: 1789570000000, name: 'ImportParkOpsMetricsRuntimeConfig1789570000000' },
          ];
        }
        if (sql.startsWith('SELECT sqlite_version')) return [{ sqliteVersion: '3.46.0' }];
        if (sql.startsWith('SELECT COUNT')) return [{ count: 2 }];
        throw new Error(`unexpected query: ${sql}`);
      }),
      showMigrations: jest.fn(async () => false),
    };
    return { service: new SystemService(config as never, dataSource as never), dataSource };
  }

  it('reports the exact release, connected database and independent storage roots', async () => {
    writeFileSync(
      process.env.RELEASE_MANIFEST_PATH!,
      JSON.stringify({ commit: 'a'.repeat(40), ref: 'main', releasedAt: '2026-09-16T14:00:00Z' }),
    );
    const { service } = fixture();

    await expect(service.runtimeSummary()).resolves.toMatchObject({
      release: {
        commit: 'a'.repeat(40),
        ref: 'main',
        releasedAt: '2026-09-16T14:00:00Z',
        identitySource: 'environment',
      },
      database: {
        configuredPath: join(directory, 'smart-control.db'),
        connectedPath: join(directory, 'smart-control.db'),
        sqliteVersion: '3.46.0',
        migrationsApplied: 1,
        pendingMigrations: false,
        runtimeConfigDocuments: 2,
      },
      storage: {
        runtimeDataDir: directory,
        mediaRoot: join(directory, 'media'),
        releaseManifest: process.env.RELEASE_MANIFEST_PATH,
      },
    });
  });

  it('fails closed when configuration and the connected database diverge', async () => {
    const { service, dataSource } = fixture(join(directory, 'other.db'));

    await expect(service.runtimeSummary()).rejects.toThrow('RUNTIME_DATABASE_PATH_MISMATCH');
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('uses the real runtime platform and hostname instead of the production template', async () => {
    const { service } = fixture();

    await service.onModuleInit();

    expect(service.meta()).toMatchObject({ platform: process.platform, host: hostname() });
  });

  it('keeps public release info path-safe and restricts filesystem details to admins', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SystemController.prototype.info)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SystemController.prototype.runtimeSummary)).not.toBe(
      true,
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SystemController.prototype.runtimeSummary),
    ).toContain(ActorAdminGuard);
  });
});
