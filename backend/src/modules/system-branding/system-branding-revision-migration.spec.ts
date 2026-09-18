import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { DataSource } from 'typeorm';
import { AddSystemBrandingRevision1789720000000 } from '../../migrations/1789720000000-AddSystemBrandingRevision';

describe('system branding revision migration from complete historical chain', () => {
  let db: DataSource;
  const migration = new AddSystemBrandingRevision1789720000000();
  beforeEach(async () => {
    const directory = resolve(__dirname, '../../migrations');
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: false,
      migrations: readdirSync(directory)
        .filter((f) => f.endsWith('.ts') && f < '1789720000000')
        .map((f) => resolve(directory, f)),
    }).initialize();
    await db.runMigrations();
    await db.query(
      "UPDATE system_branding_v2 SET systemName=' Preserved name ', logoUrl='javascript:historical', welcomeGuest=' Preserved guest ', welcomePhotoMediaId=987654, parkOpsConfigJson='legacy snapshot' WHERE id=1",
    );
  });
  afterEach(async () => {
    await db.destroy();
  });
  it('adds only the revision column, preserving all history and remaining idempotent', async () => {
    expect((await db.query('SELECT COUNT(*) AS n FROM migrations'))[0].n).toBe(43);
    const before = await db.query('SELECT * FROM system_branding_v2');
    expect(before).toHaveLength(1);
    await migration.up(db.createQueryRunner());
    const after = await db.query('SELECT * FROM system_branding_v2');
    expect(after.map(({ config_revision: _, ...row }: Record<string, unknown>) => row)).toEqual(
      before,
    );
    expect(after[0].config_revision).toBe(1);
    await db.query('UPDATE system_branding_v2 SET config_revision=8 WHERE id=1');
    await migration.up(db.createQueryRunner());
    expect(
      (await db.query('SELECT config_revision FROM system_branding_v2'))[0].config_revision,
    ).toBe(8);
    expect(await db.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([]);
  });
  it('rolls back interrupted DDL, permits retry and does not recreate a missing singleton', async () => {
    const runner = db.createQueryRunner();
    const before = await db.query('SELECT * FROM system_branding_v2');
    await runner.startTransaction();
    await migration.up(runner);
    await runner.rollbackTransaction();
    expect(await db.query('SELECT * FROM system_branding_v2')).toEqual(before);
    await db.query('DELETE FROM system_branding_v2');
    await migration.up(runner);
    expect(await db.query('SELECT * FROM system_branding_v2')).toEqual([]);
    await runner.release();
  });
  it('rejects schema drift and unarchived downgrade', async () => {
    await db.query('ALTER TABLE system_branding_v2 ADD COLUMN config_revision REAL DEFAULT 1');
    await expect(migration.up(db.createQueryRunner())).rejects.toThrow(
      'SYSTEM_BRANDING_REVISION_SCHEMA_INVALID',
    );
    await expect(migration.down()).rejects.toThrow(
      'SYSTEM_BRANDING_REVISION_ROLLBACK_REQUIRES_ARCHIVE',
    );
  });
  it.each([0, 1.5, 9007199254740992])(
    'fails closed on invalid persisted revision %s',
    async (revision) => {
      await migration.up(db.createQueryRunner());
      await db.query('UPDATE system_branding_v2 SET config_revision=? WHERE id=1', [revision]);
      await expect(migration.up(db.createQueryRunner())).rejects.toThrow(
        'SYSTEM_BRANDING_REVISION_INVALID',
      );
    },
  );
  it('restores a matching independent backup, without attempting destructive downgrade', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'system-branding-backup-'));
    let restored: DataSource | undefined;
    try {
      const before = await db.query('SELECT * FROM system_branding_v2');
      await db.query('VACUUM INTO ?', [join(directory, 'before.sqlite')]);
      await migration.up(db.createQueryRunner());
      await db.query('UPDATE system_branding_v2 SET config_revision=2 WHERE id=1');
      copyFileSync(join(directory, 'before.sqlite'), join(directory, 'restored.sqlite'));
      restored = await new DataSource({
        type: 'better-sqlite3',
        database: join(directory, 'restored.sqlite'),
        synchronize: false,
      }).initialize();
      expect(await restored.query('SELECT * FROM system_branding_v2')).toEqual(before);
      expect((await restored.query('SELECT COUNT(*) AS n FROM migrations'))[0].n).toBe(43);
      expect(await restored.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      expect(
        (await db.query('SELECT config_revision FROM system_branding_v2'))[0].config_revision,
      ).toBe(2);
    } finally {
      if (restored?.isInitialized) await restored.destroy();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
