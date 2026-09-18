import { readdirSync } from 'fs';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { AddHvacConfigRevisions1789740000000 } from '../../migrations/1789740000000-AddHvacConfigRevisions';

describe('HVAC configuration revision migration', () => {
  let db: DataSource;

  beforeEach(async () => {
    const directory = resolve(__dirname, '../../migrations');
    db = await new DataSource({
      type: 'better-sqlite3', database: ':memory:', synchronize: false,
      migrations: readdirSync(directory).filter((name) => name.endsWith('.ts') && name < '1789740000000')
        .map((name) => resolve(directory, name)),
    }).initialize();
    await db.runMigrations();
  });

  afterEach(async () => { await db.destroy(); });

  it('adds both revision columns without rewriting the directory and is repeatable', async () => {
    const migration = new AddHvacConfigRevisions1789740000000();
    const before = await db.query('SELECT code, name, floor FROM hvac_zone ORDER BY id');
    await migration.up(db.createQueryRunner());
    for (const table of ['hvac_zone', 'hvac_indoor']) {
      const rows = await db.query(`SELECT config_revision FROM "${table}"`);
      expect(rows.every((row: { config_revision: number }) => row.config_revision === 1)).toBe(true);
    }
    expect(await db.query('SELECT code, name, floor FROM hvac_zone ORDER BY id')).toEqual(before);
    await db.query('UPDATE hvac_indoor SET config_revision=4 WHERE id=(SELECT MIN(id) FROM hvac_indoor)');
    await migration.up(db.createQueryRunner());
    expect((await db.query('SELECT config_revision FROM hvac_indoor WHERE id=(SELECT MIN(id) FROM hvac_indoor)'))[0].config_revision).toBe(4);
    expect(await db.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });

  it('fails closed for invalid persisted revisions and rollback', async () => {
    const migration = new AddHvacConfigRevisions1789740000000();
    await migration.up(db.createQueryRunner());
    await db.query('UPDATE hvac_zone SET config_revision=0 WHERE id=(SELECT MIN(id) FROM hvac_zone)');
    await expect(migration.up(db.createQueryRunner())).rejects.toThrow('HVAC_CONFIG_REVISION_INVALID:hvac_zone');
    await expect(migration.down()).rejects.toThrow('HVAC_CONFIG_REVISION_ROLLBACK_REQUIRES_ARCHIVE');
  });
});
