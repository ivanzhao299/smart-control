// Disposable crash-test process. No production config or project .env is loaded.
require('reflect-metadata');
const { DataSource } = require('typeorm');
const fs = require('node:fs/promises');
const { resolve, join } = require('node:path');
const { User } = require('../../dist/entities/user.entity');
const { MediaQuotaService } = require('../../dist/modules/media/media-quota.service');
const { MediaService } = require('../../dist/modules/media/media.service');
const { MediaAsset } = require('../../dist/entities/media-asset.entity');
const { ConfigService } = require('@nestjs/config');

async function main() {
  const [root, stage] = process.argv.slice(2);
  if (!root || !['bound', 'partial', 'finalized', 'system-partial', 'system-finalized'].includes(stage) || !process.send) throw new Error('Crash-test IPC and explicit fixture root required');
  const db = await new DataSource({ type: 'better-sqlite3', database: join(root, 'live.sqlite'), synchronize: false,
    entities: [resolve(__dirname, '../../dist/entities/*.entity.js')], migrations: [resolve(__dirname, '../../dist/migrations/*.js')] }).initialize();
  await db.query('PRAGMA journal_mode = WAL');
  await db.query('PRAGMA wal_autocheckpoint = 0');
  await db.runMigrations();
  const user = await db.getRepository(User).save({ username: 'crash-fixture', password: 'not-a-login-hash', role: 'operator', storageQuotaBytes: 100 });
  const actor = stage.startsWith('system-') ? { kind: 'admin', userId: null, username: 'admin', role: 'admin' }
    : { kind: 'user', userId: user.id, username: user.username, role: user.role };
  const quota = new MediaQuotaService(db);
  const id = await quota.reserve(actor, 100, join(root, 'media'));
  const name = id + '.upload';
  await quota.bindTemporary(actor, id, name);
  if (stage.endsWith('partial')) await fs.writeFile(join(root, 'media', '_tmp', name), 'interrupted-private-bytes', { flag: 'wx' });
  let asset;
  if (stage.endsWith('finalized')) {
    process.env.MEDIA_ROOT = join(root, 'media');
    const media = new MediaService(db.getRepository(MediaAsset), new ConfigService(), {});
    const file = join(root, 'media', '_tmp', name);
    await fs.writeFile(file, Buffer.alloc(100, 65), { flag: 'wx' });
    asset = await media.ingest({ originalname: 'complete.mp3', mimetype: 'audio/mpeg', path: file, size: 100 }, user.username, undefined, actor, id);
  }
  process.send({ stage, id, name, userId: user.id, mediaId: asset?.id });
  // Deliberately keep DB/WAL open. The parent kills this process without cleanup.
  setInterval(() => {}, 1000);
}
main().catch(() => { process.stderr.write('Disposable upload worker failed\n'); process.exitCode = 1; process.disconnect?.(); });
