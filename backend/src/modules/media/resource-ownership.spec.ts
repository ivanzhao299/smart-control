import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AddResourceOwnership1788618000000 } from '../../migrations/1788618000000-AddResourceOwnership';

describe('resource ownership migration on real SQLite', () => {
  let db: DataSource;
  const migration = new AddResourceOwnership1788618000000();
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [], synchronize: false }).initialize();
    await db.query('CREATE TABLE users (id integer PRIMARY KEY, username varchar NOT NULL)');
    await db.query('CREATE TABLE media_assets (id integer PRIMARY KEY, path varchar NOT NULL, originalName varchar NOT NULL)');
    await db.query('CREATE TABLE playback_history (id integer PRIMARY KEY, media_id integer NOT NULL)');
    await db.query('CREATE TABLE playback_channels (id integer PRIMARY KEY, slot integer NOT NULL)');
    await db.query("INSERT INTO users VALUES (7, 'alice')");
    await db.query("INSERT INTO media_assets VALUES (42, 'D:\\Media\\42\\demo.mp4', 'demo.mp4')");
    await db.query('INSERT INTO playback_history VALUES (1, 42)');
    await db.query('INSERT INTO playback_channels VALUES (1, 1)');
  });
  afterEach(async () => { if (db?.isInitialized) await db.destroy(); });

  it('preserves historical rows and exact paths across up/down', async () => {
    const before = await db.query('SELECT * FROM media_assets');
    const q = db.createQueryRunner();
    await migration.up(q);
    expect(await db.query('SELECT id,path,originalName FROM media_assets')).toEqual(before);
    expect((await db.query('SELECT owner_user_id,visibility,source FROM media_assets'))[0])
      .toEqual({ owner_user_id: null, visibility: 'shared', source: 'legacy' });
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([]);
    await migration.down(q);
    expect(await db.query('SELECT * FROM media_assets')).toEqual(before);
    expect(await db.query('SELECT * FROM playback_history')).toEqual([{ id: 1, media_id: 42 }]);
    await q.release();
  });

  it('defaults new resources to private and prevents removing their owner', async () => {
    const q = db.createQueryRunner();
    await migration.up(q);
    await db.query("INSERT INTO media_assets (id,path,originalName,owner_user_id) VALUES (43,'new.mp4','private.mp4',7)");
    expect((await db.query('SELECT visibility FROM media_assets WHERE id=43'))[0].visibility).toBe('private');
    await expect(db.query('DELETE FROM users WHERE id=7')).rejects.toThrow();
    await expect(migration.down(q)).rejects.toThrow('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE');
    expect((await db.query('SELECT owner_user_id FROM media_assets WHERE id=43'))[0].owner_user_id).toBe(7);
    await q.release();
  });

  it('blocks rollback for new shared content as well as private content', async () => {
    const q = db.createQueryRunner();
    await migration.up(q);
    await db.query("INSERT INTO media_assets (id,path,originalName,visibility) VALUES (43,'new.mp4','new.mp4','shared')");
    await expect(migration.down(q)).rejects.toThrow('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE');
    await q.release();
  });
});
