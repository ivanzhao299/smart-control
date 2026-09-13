require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { DataSource } = require('typeorm');
const { ConfigService } = require('@nestjs/config');
const { User } = require('../dist/entities/user.entity');
const { MediaAsset } = require('../dist/entities/media-asset.entity');
const { PlaylistItem } = require('../dist/entities/playlist-item.entity');
const { PlaybackHistory } = require('../dist/entities/playback-history.entity');
const { MediaService } = require('../dist/modules/media/media.service');
const { PersonalPlaylistService } = require('../dist/modules/playback/personal-playlist.service');
const { createReleaseBundle, rehearseReleaseRestore } = require('../scripts/release-recovery-bundle.cjs');

const connect = database => new DataSource({ type: 'better-sqlite3', database, synchronize: false,
  entities: [resolve(__dirname, '../dist/entities/*.entity.js')], migrations: [resolve(__dirname, '../dist/migrations/*.js')] }).initialize();

test('real migrated application restores private files, account scopes, playlists and history into an isolated root', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sc-app-recovery-'));
  let db, restoredDb;
  try {
    const databasePath = join(root, 'live.sqlite'), mediaRoot = join(root, 'media'), destinationRoot = join(root, 'backups'), restoreRoot = join(root, 'restores');
    for (const directory of [mediaRoot, destinationRoot, restoreRoot]) await fs.mkdir(directory);
    db = await connect(databasePath);
    await db.runMigrations();
    const users = [];
    for (const username of ['alice-recovery', 'bob-recovery']) {
      users.push(await db.getRepository(User).save({ username, password: 'synthetic-not-a-login-hash', role: 'operator', enabled: true }));
    }
    const assets = [];
    for (const user of users) {
      const file = join(mediaRoot, user.username + '.bin');
      await fs.writeFile(file, 'private-' + user.id);
      const asset = await db.getRepository(MediaAsset).save({ ownerUserId: user.id, originalName: user.username, safeName: user.username + '.bin',
        path: file, kind: 'audio', mimeType: 'audio/mpeg', sizeBytes: (await fs.stat(file)).size, visibility: 'private', source: 'upload' });
      assets.push(asset);
      for (const slot of [1, 2, 3]) {
        await db.getRepository(PlaylistItem).save({ ownerUserId: user.id, mediaId: asset.id, slot, title: user.username, sortOrder: 10 });
        await db.getRepository(PlaybackHistory).save({ ownerUserId: user.id, mediaId: asset.id, slot, mediaName: user.username });
      }
    }
    const migrationCount = (await db.query('SELECT * FROM migrations')).length;
    await db.destroy();
    const bundle = await createReleaseBundle({ databasePath, mediaRoot, destinationRoot, sourceRevision: 'b'.repeat(40), assertWritersStopped: async () => !db.isInitialized });
    await fs.writeFile(assets[0].path, 'newer-live-bytes');
    const restored = await rehearseReleaseRestore(bundle.directory, restoreRoot);
    assert.equal(restored.receipt.rebasedMediaRows, 2);
    restoredDb = await connect(restored.database);
    assert.equal(await restoredDb.showMigrations(), false);
    assert.equal((await restoredDb.query('SELECT * FROM migrations')).length, migrationCount);
    const previousRoot = process.env.MEDIA_ROOT;
    let media;
    try {
      process.env.MEDIA_ROOT = restored.mediaRoot;
      media = new MediaService(restoredDb.getRepository(MediaAsset), new ConfigService(), {});
    } finally {
      if (previousRoot === undefined) delete process.env.MEDIA_ROOT; else process.env.MEDIA_ROOT = previousRoot;
    }
    const playlists = new PersonalPlaylistService(restoredDb.getRepository(PlaylistItem), media);
    const admin = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    for (const [index, user] of users.entries()) {
      const actor = { kind: 'user', userId: user.id, username: user.username, role: user.role };
      await media.authorized(assets[index].id, actor);
      await assert.rejects(media.authorized(assets[1 - index].id, actor));
      const file = await media.openStream(assets[index].id, false);
      const chunks = [];
      for await (const chunk of file.stream) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString(), 'private-' + user.id);
      for (const slot of [1, 2, 3]) {
        const list = await playlists.list(actor, slot);
        assert.deepEqual(list.map(item => item.mediaId), [assets[index].id]);
        assert.equal((await playlists.list(admin, slot, 'all')).length, 2);
      }
      assert.equal(await restoredDb.getRepository(PlaybackHistory).countBy({ ownerUserId: user.id }), 3);
    }
    assert.equal(await fs.readFile(assets[0].path, 'utf8'), 'newer-live-bytes');
  } finally {
    if (db?.isInitialized) await db.destroy();
    if (restoredDb?.isInitialized) await restoredDb.destroy();
    await fs.rm(root, { recursive: true, force: true });
  }
});
