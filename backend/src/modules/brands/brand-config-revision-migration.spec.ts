import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { DataSource } from 'typeorm';
import { AddBrandConfigRevision1789710000000 } from '../../migrations/1789710000000-AddBrandConfigRevision';

describe('brand revision migration from the complete historical chain', () => {
  let db: DataSource;
  const migration = new AddBrandConfigRevision1789710000000();
  beforeEach(async () => {
    const directory = resolve(__dirname, '../../migrations');
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: false,
      migrations: readdirSync(directory)
        .filter((f) => f.endsWith('.ts') && f < '1789710000000')
        .map((f) => resolve(directory, f)),
    }).initialize();
    await db.runMigrations();
    await db.query(
      "UPDATE brands SET name=' Exact historical key ', displayName='Maintained', enabled=0, logoUrl='javascript:historical', salesContact='Kept' WHERE id=(SELECT MIN(id) FROM brands)",
    );
  });
  afterEach(async () => {
    await db.destroy();
  });
  it('adds one column only, preserving even historically invalid URLs and exact keys without silent cleanup', async () => {
    expect((await db.query('SELECT COUNT(*) AS n FROM migrations'))[0].n).toBe(42);
    const before = await db.query('SELECT * FROM brands ORDER BY id');
    const columns = await db.query('PRAGMA table_info(brands)');
    await migration.up(db.createQueryRunner());
    const after = await db.query('SELECT * FROM brands ORDER BY id');
    expect(
      after.map(({ config_revision: _revision, ...row }: Record<string, unknown>) => row),
    ).toEqual(before);
    expect(after.every((r: Record<string, unknown>) => r.config_revision === 1)).toBe(true);
    expect((await db.query('PRAGMA table_info(brands)')).slice(0, -1)).toEqual(columns);
    await db.query('UPDATE brands SET config_revision=7 WHERE id=?', [before[0].id]);
    await migration.up(db.createQueryRunner());
    expect(
      (await db.query('SELECT config_revision FROM brands WHERE id=?', [before[0].id]))[0]
        .config_revision,
    ).toBe(7);
    expect(await db.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([]);
  });
  it('rolls back interrupted additive DDL and then permits a clean retry', async () => {
    const before = await db.query('SELECT * FROM brands ORDER BY id');
    const runner = db.createQueryRunner();
    await runner.startTransaction();
    await migration.up(runner);
    await runner.rollbackTransaction();
    expect(await db.query('SELECT * FROM brands ORDER BY id')).toEqual(before);
    expect(
      (await db.query('PRAGMA table_info(brands)')).some(
        (c: { name: string }) => c.name === 'config_revision',
      ),
    ).toBe(false);
    await migration.up(runner);
    await runner.release();
  });
  it('fails closed on schema drift, invalid revisions, and unarchived downgrade', async () => {
    await db.query('ALTER TABLE brands ADD COLUMN config_revision REAL DEFAULT 1');
    await expect(migration.up(db.createQueryRunner())).rejects.toThrow(
      'BRAND_CONFIG_REVISION_SCHEMA_INVALID',
    );
    await expect(migration.down()).rejects.toThrow(
      'BRAND_CONFIG_REVISION_ROLLBACK_REQUIRES_ARCHIVE',
    );
  });
  it.each([0, 1.5, 9007199254740992])(
    'does not silently repair persisted revision %s',
    async (revision) => {
      await migration.up(db.createQueryRunner());
      await db.query('UPDATE brands SET config_revision=? WHERE id=(SELECT MIN(id) FROM brands)', [
        revision,
      ]);
      await expect(migration.up(db.createQueryRunner())).rejects.toThrow(
        'BRAND_CONFIG_REVISION_INVALID',
      );
    },
  );
  it('restores an independent matching backup without downgrading the upgraded database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'brand-revision-backup-'));
    let restored: DataSource | undefined;
    try {
      const before = await db.query('SELECT * FROM brands ORDER BY id');
      await db.query('VACUUM INTO ?', [join(directory, 'before.sqlite')]);
      await migration.up(db.createQueryRunner());
      await db.query('UPDATE brands SET config_revision=2 WHERE id=?', [before[0].id]);
      copyFileSync(join(directory, 'before.sqlite'), join(directory, 'restored.sqlite'));
      restored = await new DataSource({
        type: 'better-sqlite3',
        database: join(directory, 'restored.sqlite'),
        synchronize: false,
      }).initialize();
      expect(await restored.query('SELECT * FROM brands ORDER BY id')).toEqual(before);
      expect((await restored.query('SELECT COUNT(*) AS n FROM migrations'))[0].n).toBe(42);
      expect(await restored.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      expect(await restored.query('PRAGMA foreign_key_check')).toEqual([]);
      expect(
        (await db.query('SELECT config_revision FROM brands WHERE id=?', [before[0].id]))[0]
          .config_revision,
      ).toBe(2);
    } finally {
      if (restored?.isInitialized) await restored.destroy();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
