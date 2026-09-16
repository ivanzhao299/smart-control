import { createHash } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { InitialBaseline1784561601801 } from '../../migrations/1784561601801-InitialBaseline';
import { EstablishHvacPlaybackCatalog1789670000000 } from '../../migrations/1789670000000-EstablishHvacPlaybackCatalog';
import catalog from '../../migrations/catalogs/hvac-playback-catalog-v1.json';

const CATALOG_SHA256 = '4570d47eaab532ab2f928e52e682ddd2f7fd5557662a94478daaa67de8e1d276';

describe('EstablishHvacPlaybackCatalog migration', () => {
  let db: DataSource;
  let runner: QueryRunner;

  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: false,
      migrations: [InitialBaseline1784561601801],
    }).initialize();
    await db.runMigrations();
    // Columns introduced between the baseline and this catalog migration.
    await db.query(
      "ALTER TABLE playback_channels ADD COLUMN displayFit varchar(16) NOT NULL DEFAULT 'fill'",
    );
    await db.query('ALTER TABLE playback_channels ADD COLUMN docPage integer NOT NULL DEFAULT 1');
    await db.query('ALTER TABLE playback_channels ADD COLUMN docZoom integer NOT NULL DEFAULT 100');
    await db.query('ALTER TABLE playback_channels ADD COLUMN initiator_user_id integer');
    await db.query('ALTER TABLE playback_channels ADD COLUMN playback_session varchar(64)');
    runner = db.createQueryRunner();
  });

  afterEach(async () => {
    if (runner && !runner.isReleased) await runner.release();
    if (db?.isInitialized) await db.destroy();
  });

  it('establishes the immutable fresh-install catalog exactly once', async () => {
    expect(createHash('sha256').update(JSON.stringify(catalog)).digest('hex')).toBe(CATALOG_SHA256);
    const migration = new EstablishHvacPlaybackCatalog1789670000000();
    await migration.up(runner);

    expect(await db.query('SELECT COUNT(*) AS count FROM hvac_zone')).toEqual([{ count: 14 }]);
    expect(await db.query('SELECT COUNT(*) AS count FROM hvac_indoor')).toEqual([{ count: 22 }]);
    expect(await db.query('SELECT COUNT(*) AS count FROM playback_channels')).toEqual([
      { count: 3 },
    ]);
    expect(await db.query("SELECT COUNT(*) AS count FROM hvac_zone WHERE indoors <> '[]'")).toEqual([
      { count: 0 },
    ]);
    expect(
      await db.query('SELECT idx, zone_code FROM hvac_indoor WHERE idx IN (1, 22) ORDER BY idx'),
    ).toEqual([
      { idx: 1, zone_code: 'enterprise_booth' },
      { idx: 22, zone_code: 'research_center' },
    ]);
    expect(
      await db.query(
        `SELECT slot, name, outputKind, playlistIndex, loopMode, playMode, displayFit,
                docPage, docZoom, paused
         FROM playback_channels ORDER BY slot`,
      ),
    ).toEqual([
      {
        slot: 1,
        name: 'LED 大屏 (HDMI1)',
        outputKind: 'led',
        playlistIndex: 0,
        loopMode: 'once',
        playMode: 'loopAll',
        displayFit: 'fill',
        docPage: 1,
        docZoom: 100,
        paused: 0,
      },
      {
        slot: 2,
        name: '投影仪 (HDMI2)',
        outputKind: 'projector',
        playlistIndex: 0,
        loopMode: 'once',
        playMode: 'loopAll',
        displayFit: 'fill',
        docPage: 1,
        docZoom: 100,
        paused: 0,
      },
      {
        slot: 3,
        name: '背景音乐 (声卡→音响)',
        outputKind: 'audio',
        playlistIndex: 0,
        loopMode: 'once',
        playMode: 'loopAll',
        displayFit: 'fill',
        docPage: 1,
        docZoom: 100,
        paused: 0,
      },
    ]);

    const afterFirst = await Promise.all(
      ['hvac_zone', 'hvac_indoor', 'playback_channels'].map((table) =>
        db.query(`SELECT * FROM "${table}" ORDER BY id`),
      ),
    );
    await migration.up(runner);
    const afterSecond = await Promise.all(
      ['hvac_zone', 'hvac_indoor', 'playback_channels'].map((table) =>
        db.query(`SELECT * FROM "${table}" ORDER BY id`),
      ),
    );
    expect(afterSecond).toEqual(afterFirst);
    await expect(migration.down()).rejects.toThrow(
      'HVAC_PLAYBACK_CATALOG_ROLLBACK_REQUIRES_ARCHIVE',
    );
  });

  it('preserves non-empty customized and intentionally partial catalogs byte-for-byte', async () => {
    await db.query(
      `INSERT INTO hvac_zone
       (code, name, floor, indoors, sort_order, description, enabled, created_at, updated_at)
       VALUES ('site-zone', '现场分区', 'SITE', '[99]', 777, 'keep', 0, '2026-01-01', '2026-01-02')`,
    );
    await db.query(
      `INSERT INTO hvac_indoor
       (idx, name, floor, zone_code, model, sort_order, enabled, created_at, updated_at)
       VALUES (99, '现场内机', 'SITE', 'site-zone', 'SITE-MODEL', 888, 0, '2026-01-03', '2026-01-04')`,
    );
    await db.query(
      `INSERT INTO playback_channels
       (playback_session, initiator_user_id, slot, name, outputKind, currentMediaId,
        currentPlaylistId, playlistIndex, startedAt, loopMode, playMode, displayFit,
        docPage, docZoom, paused, lastHeartbeatAt, updatedAt)
       VALUES ('site-session', NULL, 9, '现场通道', 'monitor', NULL, NULL, 5,
               '2026-01-05', 'loop', 'shuffle', 'cover', 7, 130, 1,
               '2026-01-06', '2026-01-07')`,
    );
    const before = await Promise.all(
      ['hvac_zone', 'hvac_indoor', 'playback_channels'].map((table) =>
        db.query(`SELECT * FROM "${table}" ORDER BY id`),
      ),
    );

    await new EstablishHvacPlaybackCatalog1789670000000().up(runner);

    const after = await Promise.all(
      ['hvac_zone', 'hvac_indoor', 'playback_channels'].map((table) =>
        db.query(`SELECT * FROM "${table}" ORDER BY id`),
      ),
    );
    expect(after).toEqual(before);
  });
});
