import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { DataSource } from 'typeorm';
import { AddPowerConfigRevision1789700000000 } from '../../migrations/1789700000000-AddPowerConfigRevision';

describe('Power config revision upgrade from the previous full migration chain', () => {
  let db: DataSource;
  const migration = new AddPowerConfigRevision1789700000000();
  beforeEach(async () => {
    const directory = resolve(__dirname, '../../migrations');
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: false,
      migrations: readdirSync(directory)
        .filter((name) => name.endsWith('.ts') && !name.startsWith('1789700000000'))
        .map((name) => resolve(directory, name)),
    }).initialize();
    await db.runMigrations();
  });
  afterEach(async () => {
    await db.destroy();
  });
  it('adds exactly one column, preserves all historical fields and is repeatable without resetting revisions', async () => {
    expect((await db.query('SELECT COUNT(*) AS n FROM migrations'))[0].n).toBe(41);
    await db.query(
      "UPDATE power_circuit SET name='Synthetic legacy custom', relay_channel=NULL, enabled=0 WHERE id=(SELECT MIN(id) FROM power_circuit)",
    );
    const before = await db.query('SELECT * FROM power_circuit ORDER BY id');
    const columnsBefore = await db.query('PRAGMA table_info(power_circuit)');
    await migration.up(db.createQueryRunner());
    const rows = await db.query('SELECT * FROM power_circuit ORDER BY id');
    expect(
      rows.map(({ config_revision: _revision, ...rest }: Record<string, unknown>) => rest),
    ).toEqual(before);
    expect(rows.every((row: Record<string, unknown>) => row.config_revision === 1)).toBe(true);
    const columnsAfter = await db.query('PRAGMA table_info(power_circuit)');
    expect(columnsAfter.slice(0, -1)).toEqual(columnsBefore);
    await db.query('UPDATE power_circuit SET config_revision=7 WHERE id=?', [before[0].id]);
    await migration.up(db.createQueryRunner());
    expect(
      (await db.query('SELECT config_revision FROM power_circuit WHERE id=?', [before[0].id]))[0]
        .config_revision,
    ).toBe(7);
    expect(await db.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([]);
  });
  it('rolls back the additive DDL on interrupted transaction and can retry cleanly', async () => {
    const before = await db.query('SELECT * FROM power_circuit');
    const runner = db.createQueryRunner();
    await runner.startTransaction();
    try {
      await migration.up(runner);
      throw new Error('synthetic interruption');
    } catch {
      await runner.rollbackTransaction();
    }
    expect(
      (await db.query('PRAGMA table_info(power_circuit)')).some(
        (c: { name: string }) => c.name === 'config_revision',
      ),
    ).toBe(false);
    expect(await db.query('SELECT * FROM power_circuit')).toEqual(before);
    await migration.up(runner);
    await runner.release();
    expect(
      (await db.query('PRAGMA table_info(power_circuit)')).some(
        (c: { name: string }) => c.name === 'config_revision',
      ),
    ).toBe(true);
  });
  it('fails closed for schema drift and rejects unarchived downgrade', async () => {
    await db.query('ALTER TABLE power_circuit ADD COLUMN config_revision REAL DEFAULT 1');
    await expect(migration.up(db.createQueryRunner())).rejects.toThrow(
      'POWER_CONFIG_REVISION_SCHEMA_INVALID',
    );
    await expect(migration.down()).rejects.toThrow(
      'POWER_CONFIG_REVISION_ROLLBACK_REQUIRES_ARCHIVE',
    );
  });
  it('does not silently repair an invalid persisted revision', async () => {
    await migration.up(db.createQueryRunner());
    await db.query(
      'UPDATE power_circuit SET config_revision=0 WHERE id=(SELECT MIN(id) FROM power_circuit)',
    );
    await expect(migration.up(db.createQueryRunner())).rejects.toThrow(
      'POWER_CONFIG_REVISION_INVALID',
    );
  });

  it('restores a separate matching pre-upgrade SQLite backup without downgrading the new database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'power-config-backup-'));
    let restored: DataSource | undefined;
    try {
      const before = await db.query('SELECT * FROM power_circuit ORDER BY id');
      const backup = join(directory, 'before.sqlite'),
        target = join(directory, 'restored.sqlite');
      await db.query('VACUUM INTO ?', [backup]);
      await migration.up(db.createQueryRunner());
      await db.query(
        "UPDATE power_circuit SET name='Post-upgrade synthetic edit', config_revision=2 WHERE id=?",
        [before[0].id],
      );
      copyFileSync(backup, target);
      restored = await new DataSource({
        type: 'better-sqlite3',
        database: target,
        synchronize: false,
      }).initialize();
      expect(await restored.query('SELECT * FROM power_circuit ORDER BY id')).toEqual(before);
      expect((await restored.query('SELECT COUNT(*) AS n FROM migrations'))[0].n).toBe(41);
      expect(await restored.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      expect(await restored.query('PRAGMA foreign_key_check')).toEqual([]);
      expect(
        (await db.query('SELECT config_revision FROM power_circuit WHERE id=?', [before[0].id]))[0]
          .config_revision,
      ).toBe(2);
    } finally {
      if (restored?.isInitialized) await restored.destroy();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
