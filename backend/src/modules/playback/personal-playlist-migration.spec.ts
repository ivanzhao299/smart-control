import 'reflect-metadata';
import { DataSource, Table, TableUnique } from 'typeorm';
import { AddPersonalPlaylists1788618001000 } from '../../migrations/1788618001000-AddPersonalPlaylists';

describe('personal playlist migration', () => {
  let db: DataSource;
  const migration = new AddPersonalPlaylists1788618001000();
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:' }).initialize();
    const q = db.createQueryRunner();
    await q.createTable(new Table({ name: 'users', columns: [{ name: 'id', type: 'integer', isPrimary: true }] }));
    await q.createTable(new Table({ name: 'playlist_item', columns: [
      { name: 'id', type: 'integer', isPrimary: true }, { name: 'slot', type: 'integer' },
      { name: 'media_id', type: 'integer' }, { name: 'title', type: 'varchar' },
      { name: 'sort_order', type: 'integer' },
    ], uniques: [new TableUnique({ name: 'uq_playlist_slot_media', columnNames: ['slot', 'media_id'] })] }));
    await q.query("INSERT INTO playlist_item VALUES (1,1,77,'Existing title',20)");
    await q.query('INSERT INTO users VALUES (1),(2)');
  });
  afterEach(async () => { await db.destroy(); });
  it('preserves public entries and supports a lossless untouched down migration', async () => {
    const q = db.createQueryRunner();
    await migration.up(q);
    expect(await q.query('SELECT * FROM playlist_item')).toEqual([{ id: 1, slot: 1, media_id: 77, title: 'Existing title', sort_order: 20, owner_user_id: null }]);
    await migration.down(q);
    expect((await q.getTable('playlist_item'))!.findColumnByName('owner_user_id')).toBeUndefined();
    expect((await q.query('SELECT title FROM playlist_item'))[0].title).toBe('Existing title');
  });
  it('enforces per-owner uniqueness, owner references, and refuses destructive rollback', async () => {
    const q = db.createQueryRunner();
    await migration.up(q);
    await q.query("INSERT INTO playlist_item VALUES (2,1,77,'Alice',10,1),(3,1,77,'Bob',10,2)");
    await expect(q.query("INSERT INTO playlist_item VALUES (4,1,77,'Duplicate',10,1)")).rejects.toThrow();
    await expect(q.query("INSERT INTO playlist_item VALUES (4,1,77,'Duplicate public',10,NULL)")).rejects.toThrow();
    await expect(q.query('DELETE FROM users WHERE id=1')).rejects.toThrow();
    await expect(migration.down(q)).rejects.toThrow('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE');
    expect(await q.query('SELECT id FROM playlist_item')).toHaveLength(3);
  });
});
