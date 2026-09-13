import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ShareBuiltinParkDashboard1788790001000 } from '../../migrations/1788790001000-ShareBuiltinParkDashboard';

describe('built-in dashboard ownership compatibility', () => {
  it('shares only the ownerless built-in record, preserving user copies and unrelated content', async () => {
    const db = await new DataSource({ type: 'better-sqlite3', database: ':memory:' }).initialize();
    try {
      await db.query(`CREATE TABLE media_assets (id INTEGER PRIMARY KEY, owner_user_id INTEGER,
        kind TEXT, uploader TEXT, originalName TEXT, sourceUrl TEXT, visibility TEXT, source TEXT)`);
      const title = '金湖科创产业园·智慧运营总览(DEMO)';
      const url = 'http://localhost:5173/control/park-ops/index.html';
      for (const row of [
        [1, null, 'system', title, url],
        [2, 42, 'system', title, url],
        [3, null, 'system', 'another presentation', url],
        [4, null, 'user', title, url],
      ]) {
        await db.query(`INSERT INTO media_assets (id, owner_user_id, uploader, originalName, sourceUrl,
          kind, visibility, source) VALUES (?, ?, ?, ?, ?, 'webpage', 'private', 'upload')`, row);
      }
      const migration = new ShareBuiltinParkDashboard1788790001000();
      await migration.up(db.createQueryRunner());
      await migration.up(db.createQueryRunner());
      expect(await db.query('SELECT id, visibility, source FROM media_assets ORDER BY id')).toEqual([
        { id: 1, visibility: 'shared', source: 'system' },
        ...[2, 3, 4].map(id => ({ id, visibility: 'private', source: 'upload' })),
      ]);
      await migration.down();
      expect(await db.query('SELECT COUNT(*) AS count FROM media_assets')).toEqual([{ count: 4 }]);
    } finally { await db.destroy(); }
  });
});
