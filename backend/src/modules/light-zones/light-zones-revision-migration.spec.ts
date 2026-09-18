import { readdirSync } from 'fs';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { AddLightingConfigRevisions1789730000000 } from '../../migrations/1789730000000-AddLightingConfigRevisions';

describe('lighting configuration revision migration', () => {
  let db: DataSource;

  beforeEach(async () => {
    const directory = resolve(__dirname, '../../migrations');
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: false,
      migrations: readdirSync(directory)
        .filter((name) => name.endsWith('.ts') && name < '1789730000000')
        .map((name) => resolve(directory, name)),
    }).initialize();
    await db.runMigrations();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('adds revision columns without changing existing rows and is repeatable', async () => {
    const migration = new AddLightingConfigRevisions1789730000000();
    const before = await db.query('SELECT code, name, enabled FROM light_zone ORDER BY id');
    await migration.up(db.createQueryRunner());
    for (const table of ['light_zone', 'light_group', 'dali_light', 'light_scene']) {
      const rows = await db.query(`SELECT config_revision FROM "${table}"`);
      expect(rows.every((row: { config_revision: number }) => row.config_revision === 1)).toBe(true);
    }
    expect(await db.query('SELECT code, name, enabled FROM light_zone ORDER BY id')).toEqual(before);
    await db.query("UPDATE light_zone SET config_revision=4 WHERE id=(SELECT MIN(id) FROM light_zone)");
    await migration.up(db.createQueryRunner());
    expect((await db.query('SELECT config_revision FROM light_zone WHERE id=(SELECT MIN(id) FROM light_zone)'))[0].config_revision).toBe(4);
    expect(await db.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });

  it('fails closed for invalid schema and persisted revisions', async () => {
    const migration = new AddLightingConfigRevisions1789730000000();
    await migration.up(db.createQueryRunner());
    await db.query('UPDATE light_zone SET config_revision=0 WHERE id=(SELECT MIN(id) FROM light_zone)');
    await expect(migration.up(db.createQueryRunner())).rejects.toThrow('LIGHTING_CONFIG_REVISION_INVALID:light_zone');
    await expect(migration.down()).rejects.toThrow('LIGHTING_CONFIG_REVISION_ROLLBACK_REQUIRES_ARCHIVE');
  });
});
