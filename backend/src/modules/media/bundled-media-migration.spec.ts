import { DataSource, QueryRunner } from 'typeorm';
import { EstablishBundledMediaAuthority1789680000000 } from '../../migrations/1789680000000-EstablishBundledMediaAuthority';

describe('EstablishBundledMediaAuthority migration', () => {
  let db: DataSource;
  let runner: QueryRunner;

  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:' }).initialize();
    await db.query(`CREATE TABLE media_assets (
      id integer PRIMARY KEY AUTOINCREMENT, owner_user_id integer, visibility varchar NOT NULL DEFAULT 'private',
      source varchar NOT NULL DEFAULT 'upload', originalName varchar NOT NULL, safeName varchar NOT NULL,
      path varchar NOT NULL, sourcePath varchar, processingStatus varchar NOT NULL DEFAULT 'ready',
      processingError varchar, thumbPath varchar, kind varchar NOT NULL, sourceUrl varchar,
      mimeType varchar NOT NULL, sizeBytes bigint NOT NULL, durationSec integer, resolution varchar,
      remark varchar, uploader varchar NOT NULL DEFAULT 'system', pageCount integer, docPdfPath varchar,
      last_played_at datetime, created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    runner = db.createQueryRunner();
  });

  afterEach(async () => {
    if (!runner.isReleased) await runner.release();
    await db.destroy();
  });

  it('establishes stable webpage identities and moves m4v repair into the ledger', async () => {
    await db.query(`INSERT INTO media_assets
      (originalName,safeName,path,kind,mimeType,sizeBytes,uploader)
      VALUES ('clip.m4v','clip.m4v','/media/clip.m4v','video','video/x-m4v',1,'alice')`);

    const migration = new EstablishBundledMediaAuthority1789680000000();
    await migration.up(runner);

    expect(
      await db.query(`SELECT originalName,system_key,sourceUrl FROM media_assets
      WHERE source='system' ORDER BY system_key`),
    ).toEqual([
      {
        originalName: '金湖科创产业园·智慧运营总览(DEMO)',
        system_key: 'web.park-operations-dashboard',
        sourceUrl: 'http://localhost:5173/control/park-ops/index.html',
      },
      {
        originalName: '金湖欢迎页·动态(称谓可编辑)',
        system_key: 'web.welcome-dynamic',
        sourceUrl: 'http://localhost:5173/control/welcome/index.html',
      },
    ]);
    expect(
      await db.query(`SELECT mimeType FROM media_assets WHERE originalName='clip.m4v'`),
    ).toEqual([{ mimeType: 'video/mp4' }]);
    await expect(migration.down()).rejects.toThrow(
      'BUNDLED_MEDIA_AUTHORITY_ROLLBACK_REQUIRES_ARCHIVE',
    );
  });

  it('rejects conflicting existing system webpages instead of overwriting them', async () => {
    await db.query(`INSERT INTO media_assets
      (owner_user_id,visibility,source,originalName,safeName,path,kind,sourceUrl,mimeType,sizeBytes,uploader)
      VALUES (NULL,'shared','system','金湖欢迎页·动态(称谓可编辑)','webpage','','webpage',
      'https://unexpected.example','text/html',0,'system')`);
    await expect(new EstablishBundledMediaAuthority1789680000000().up(runner)).rejects.toThrow(
      'BUNDLED_MEDIA_CONFLICT',
    );
  });
});
