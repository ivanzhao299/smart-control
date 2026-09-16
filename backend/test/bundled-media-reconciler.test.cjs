const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { reconcile } = require('../scripts/reconcile-bundled-media.cjs');

const manifestPath = path.resolve(__dirname, '../../deploy/assets/bundled-media-manifest.json');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-media-'));
  const mediaRoot = path.join(directory, 'media');
  const databasePath = path.join(directory, 'catalog.sqlite');
  const db = new Database(databasePath);
  db.exec(`CREATE TABLE media_assets (
    id integer PRIMARY KEY AUTOINCREMENT, owner_user_id integer, visibility varchar NOT NULL,
    source varchar NOT NULL, system_key varchar, artifact_sha256 varchar,
    originalName varchar NOT NULL, safeName varchar NOT NULL, path varchar NOT NULL,
    sourcePath varchar, processingStatus varchar NOT NULL, processingError varchar,
    thumbPath varchar, kind varchar NOT NULL, sourceUrl varchar, mimeType varchar NOT NULL,
    sizeBytes bigint NOT NULL, durationSec integer, resolution varchar, remark varchar,
    uploader varchar NOT NULL, pageCount integer, docPdfPath varchar, last_played_at datetime,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); CREATE UNIQUE INDEX ux_media_assets_system_key ON media_assets(system_key) WHERE system_key IS NOT NULL;`);
  const insert = db.prepare(`INSERT INTO media_assets
    (owner_user_id,visibility,source,system_key,artifact_sha256,originalName,safeName,path,
     processingStatus,kind,sourceUrl,mimeType,sizeBytes,resolution,remark,uploader)
    VALUES (NULL,'shared','system',?,NULL,?,'webpage','','ready','webpage',?,'text/html',0,?,?,'system')`);
  insert.run('web.park-operations-dashboard', '金湖科创产业园·智慧运营总览(DEMO)',
    'http://localhost:5173/control/park-ops/index.html', '3612x1462',
    '园区综合态势/企业经营/安全消防/人车管理/视频监控五页演示大屏；当前为模拟数据，摄像头接口预留');
  insert.run('web.welcome-dynamic', '金湖欢迎页·动态(称谓可编辑)',
    'http://localhost:5173/control/welcome/index.html', null,
    '推到大屏/投影即显示; 嘉宾称谓在 后台→系统品牌→欢迎页嘉宾称谓 编辑, 约 20s 自动生效');
  db.close();
  return { directory, mediaRoot, databasePath };
}

test('reconciler provisions fresh file assets once and check-only remains read-only', () => {
  const f = fixture();
  try {
    assert.deepEqual(reconcile({ ...f, manifestPath, checkOnly: false }), { state: 'updated', count: 15 });
    const db = new Database(f.databasePath, { readonly: true });
    const first = db.prepare(`SELECT id,system_key,path,artifact_sha256 FROM media_assets ORDER BY id`).all();
    db.close();
    assert.equal(first.length, 15);
    assert.equal(first.filter(row => row.path).length, 13);
    assert.deepEqual(reconcile({ ...f, manifestPath, checkOnly: true }), { state: 'current', count: 15 });
    const again = new Database(f.databasePath, { readonly: true });
    assert.deepEqual(again.prepare(`SELECT id,system_key,path,artifact_sha256 FROM media_assets ORDER BY id`).all(), first);
    again.close();
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('check-only rejects missing bytes without repairing or changing the row', () => {
  const f = fixture();
  try {
    reconcile({ ...f, manifestPath, checkOnly: false });
    const db = new Database(f.databasePath);
    const row = db.prepare(`SELECT id,path FROM media_assets WHERE system_key='audio.stereo-lr-test'`).get();
    fs.unlinkSync(row.path);
    const before = db.prepare(`SELECT * FROM media_assets WHERE id=?`).get(row.id);
    db.close();
    assert.throws(() => reconcile({ ...f, manifestPath, checkOnly: true }), /reconciliation is pending/);
    const afterDb = new Database(f.databasePath, { readonly: true });
    assert.deepEqual(afterDb.prepare(`SELECT * FROM media_assets WHERE id=?`).get(row.id), before);
    afterDb.close();
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test('reconciler rejects a symlinked system directory before writing outside MEDIA_ROOT', () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.mediaRoot);
    const escape = path.join(f.directory, 'escape');
    fs.mkdirSync(escape);
    fs.symlinkSync(escape, path.join(f.mediaRoot, '_system'), 'dir');
    assert.throws(() => reconcile({ ...f, manifestPath, checkOnly: false }), /parent directory is unsafe/);
    assert.deepEqual(fs.readdirSync(escape), []);
    const db = new Database(f.databasePath, { readonly: true });
    assert.equal(db.prepare(`SELECT count(*) count FROM media_assets`).get().count, 2);
    db.close();
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});
