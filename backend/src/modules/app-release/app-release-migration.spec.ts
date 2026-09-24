import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AppRelease } from '../../entities/app-release.entity';
import { InitialBaseline1784561601801 } from '../../migrations/1784561601801-InitialBaseline';
import { EstablishAppReleaseCatalog1789640000000 } from '../../migrations/1789640000000-EstablishAppReleaseCatalog';

describe('EstablishAppReleaseCatalog migration', () => {
  let directory: string;
  let dataSource: DataSource;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'app-release-migration-'));
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: join(directory, 'migration.sqlite'),
      entities: [AppRelease],
      migrations: [InitialBaseline1784561601801],
      migrationsTableName: 'migrations',
      synchronize: false,
    });
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    rmSync(directory, { recursive: true, force: true });
  });

  async function migrateCatalog(): Promise<void> {
    const runner = dataSource.createQueryRunner();
    await new EstablishAppReleaseCatalog1789640000000().up(runner);
    await runner.release();
  }

  it('seeds the current Android release only when it is missing', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    await migrateCatalog();

    const rows = await dataSource.query(
      `SELECT platform, versionCode, versionName, download_url, release_source,
              artifact_commit, artifact_sha256, artifact_size, artifact_built_at
       FROM app_release_v1 ORDER BY platform`,
    );
    expect(rows).toEqual([
      {
        platform: 'android',
        versionCode: 22,
        versionName: '1.1.14',
        download_url: 'http://192.168.77.54:3200/api/app/android/download',
        release_source: 'bundled',
        artifact_commit: null,
        artifact_sha256: null,
        artifact_size: null,
        artifact_built_at: null,
      },
    ]);
  });

  it('preserves every maintained field and keeps a custom Android release manual', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query(
      `INSERT INTO app_release_v1
       (platform, versionCode, versionName, download_url, notes, force_update,
        min_supported_version_code, enabled, created_at, updated_at)
       VALUES ('android', 27, '2.0.0', 'https://现场.example/app.apk', '现场说明', 1, 9, 0,
               '2026-01-01 00:00:00', '2026-01-02 00:00:00')`,
    );
    const before = await dataSource.query('SELECT * FROM app_release_v1 WHERE platform = ?', [
      'android',
    ]);

    await migrateCatalog();

    const [after] = await dataSource.query(
      `SELECT id, platform, versionCode, versionName, download_url, notes, force_update,
              min_supported_version_code, enabled, created_at, updated_at, release_source
       FROM app_release_v1 WHERE platform = ?`,
      ['android'],
    );
    expect(after).toEqual({ ...before[0], release_source: 'manual' });
  });

  it('refuses an unarchived rollback while release data exists', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    await migrateCatalog();
    const runner = dataSource.createQueryRunner();
    await expect(new EstablishAppReleaseCatalog1789640000000().down(runner)).rejects.toThrow(
      'APP_RELEASE_CATALOG_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await runner.release();
  });
});
