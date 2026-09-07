import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { resolve } from 'path';

describe('complete migration chain on an isolated database', () => {
  let db: DataSource;
  afterEach(async () => { if (db?.isInitialized) await db.destroy(); });
  it('creates the multiuser tables through real migrations without synchronize', async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', synchronize: false,
      migrations: [resolve(__dirname, '../../migrations/*.ts')],
      entities: [resolve(__dirname, '../../entities/*.entity.ts')],
    }).initialize();
    const applied = await db.runMigrations();
    expect(applied.length).toBeGreaterThan(4);
    expect(await db.showMigrations()).toBe(false);
    const runner = db.createQueryRunner();
    expect((await runner.getTable('media_assets'))?.findColumnByName('owner_user_id')).toBeDefined();
    expect((await runner.getTable('playlist_item'))?.indices.map(i => i.name)).toContain('uq_playlist_user_slot_media');
    expect((await runner.getTable('playback_channels'))?.findColumnByName('playback_session')).toBeDefined();
    expect(await runner.hasTable('upload_reservations')).toBe(true);
    for (const entity of db.entityMetadatas) {
      const table = await runner.getTable(entity.tableName);
      expect(table).toBeDefined();
      for (const column of entity.columns) expect(table?.findColumnByName(column.databaseName)).toBeDefined();
    }
    expect(await db.runMigrations()).toEqual([]);
    // Empty new-feature state can return to the pre-multiuser schema without data loss.
    expect((await runner.getTable('upload_reservations'))?.findColumnByName('temp_name')).toBeDefined();
    expect((await runner.getTable('upload_reservations'))?.findColumnByName('instance_id')).toBeDefined();
    expect(await runner.hasTable('upload_instances')).toBe(true);
    expect((await runner.getTable('upload_reservations'))?.findColumnByName('target_media_id')).toBeDefined();
    expect(await db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'protect_last_administrator_%'")).toHaveLength(2);
    for (let i = 0; i < 9; i++) await db.undoLastMigration();
    expect(await db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'protect_last_administrator_%'")).toHaveLength(0);
    expect(await runner.hasTable('upload_reservations')).toBe(false);
    expect((await runner.getTable('media_assets'))?.findColumnByName('owner_user_id')).toBeUndefined();
  });
});
