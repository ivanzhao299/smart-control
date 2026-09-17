import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { DataSource } from 'typeorm';
import { AddAudioConfigRevisions1789690000000 } from '../../migrations/1789690000000-AddAudioConfigRevisions';

const tables = ['audio_output_zone', 'audio_input_source', 'audio_scene'];
describe('audio config additive migration and matched backup recovery', () => {
  let directory: string, db: DataSource;
  const migrationDirectory = resolve(__dirname, '../../migrations');
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(migrationDirectory, name));
  const open = async (filename: string, includeRevision = true) =>
    new DataSource({
      type: 'better-sqlite3',
      database: filename,
      synchronize: false,
      migrations: includeRevision
        ? migrations
        : migrations.filter((name) => !name.endsWith('1789690000000-AddAudioConfigRevisions.ts')),
    }).initialize();
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'audio-revision-rehearsal-'));
    db = await open(join(directory, 'current.sqlite'), false);
    await db.runMigrations();
    await db.query(
      "UPDATE audio_input_source SET name = 'custom input', desired_gain_db = 2.4, desired_muted = 1, enabled = 0 WHERE channel = 0",
    );
    await db.query(
      "UPDATE audio_output_zone SET name = 'custom output', floor = 'custom floor', enabled = 0 WHERE channel = 0",
    );
    await db.query(
      'UPDATE audio_scene SET content = \'{"outputs":[{"ch":6,"inputs":[3],"volume":37}]}\', hint = \'preserve custom route\' WHERE preset_num = 1',
    );
  });
  afterEach(async () => {
    if (db?.isInitialized) await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  });
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => [table, await db.query(`SELECT * FROM ${table} ORDER BY id`)]),
      ),
    );

  it('upgrades the historical chain once, preserves every original field, and restores the matched backup', async () => {
    const before = await snapshot();
    const filename = join(directory, 'current.sqlite'),
      backup = join(directory, 'before.sqlite');
    await db.destroy();
    copyFileSync(filename, backup);
    db = await open(filename);
    const applied = await db.runMigrations();
    expect(applied.map((item) => item.name)).toEqual(['AddAudioConfigRevisions1789690000000']);
    for (const table of tables) {
      const rows = await db.query(`SELECT * FROM ${table} ORDER BY id`);
      expect(rows.every((row: { config_revision: number }) => row.config_revision === 1)).toBe(
        true,
      );
      expect(
        rows.map(({ config_revision: _revision, ...row }: Record<string, unknown>) => row),
      ).toEqual(before[table]);
    }
    expect(await db.runMigrations()).toEqual([]);
    await new AddAudioConfigRevisions1789690000000().up(db.createQueryRunner());
    expect(await db.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([]);
    await db.destroy();
    const restored = join(directory, 'restored.sqlite');
    copyFileSync(backup, restored);
    db = await open(restored, false);
    expect(await snapshot()).toEqual(before);
    for (const table of tables)
      expect(
        (await db.query(`PRAGMA table_info(${table})`)).some(
          (column: { name: string }) => column.name === 'config_revision',
        ),
      ).toBe(false);
  });

  it('an interruption after two ALTERs rolls back all metadata without touching catalog data', async () => {
    const before = await snapshot(),
      runner = db.createQueryRunner();
    const query = runner.query.bind(runner);
    jest.spyOn(runner, 'query').mockImplementation((sql: string, args?: unknown[]) => {
      if (sql.startsWith('ALTER TABLE "audio_scene"'))
        return Promise.reject(new Error('synthetic migration interruption'));
      return query(sql, args);
    });
    await runner.startTransaction();
    await expect(new AddAudioConfigRevisions1789690000000().up(runner)).rejects.toThrow(
      'synthetic migration interruption',
    );
    await runner.rollbackTransaction();
    jest.restoreAllMocks();
    expect(await snapshot()).toEqual(before);
    for (const table of tables)
      expect(
        (await db.query(`PRAGMA table_info(${table})`)).some(
          (column: { name: string }) => column.name === 'config_revision',
        ),
      ).toBe(false);
    await new AddAudioConfigRevisions1789690000000().up(runner);
    expect(await db.query('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    await runner.release();
  });

  it('fails closed for malformed revision metadata and unarchived downgrades', async () => {
    const runner = db.createQueryRunner();
    await db.query('ALTER TABLE audio_output_zone ADD COLUMN config_revision TEXT');
    await expect(new AddAudioConfigRevisions1789690000000().up(runner)).rejects.toThrow(
      'AUDIO_CONFIG_REVISION_SCHEMA_INVALID',
    );
    await expect(new AddAudioConfigRevisions1789690000000().down()).rejects.toThrow(
      'AUDIO_CONFIG_REVISION_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await runner.release();
  });
});
