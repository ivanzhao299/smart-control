require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const { DataSource } = require('typeorm');
const { ConfigService } = require('@nestjs/config');
const { User } = require('../dist/entities/user.entity');
const { MediaAsset } = require('../dist/entities/media-asset.entity');
const { MediaService } = require('../dist/modules/media/media.service');

test('actual FFmpeg conversion preserves an original named playback.mp4 and accounts both files', { skip: process.env.SC_FFMPEG_ACCEPTANCE !== '1', timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sc-real-transcode-'));
  let db;
  const oldRoot = process.env.MEDIA_ROOT;
  const oldLimit = process.env.MEDIA_TRANSCODE_MAX_BYTES;
  try {
    db = await new DataSource({ type: 'better-sqlite3', database: join(root, 'test.sqlite'), synchronize: false,
      entities: [resolve(__dirname, '../dist/entities/*.entity.js')], migrations: [resolve(__dirname, '../dist/migrations/*.js')] }).initialize();
    await db.runMigrations();
    const user = await db.getRepository(User).save({ username: 'video-fixture', password: 'not-a-login-hash', role: 'operator' });
    const mediaRoot = join(root, 'media');
    await fs.mkdir(mediaRoot);
    const repo = db.getRepository(MediaAsset);
    const asset = await repo.save({ ownerUserId: user.id, originalName: 'playback.mp4', safeName: 'playback.mp4', path: '', kind: 'video', mimeType: 'video/mp4', sizeBytes: 0, visibility: 'private' });
    const directory = join(mediaRoot, String(asset.id));
    await fs.mkdir(directory);
    const source = join(directory, 'playback.mp4');
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10', '-t', '0.3', '-c:v', 'mpeg4', '-an', source], { timeout: 10000 });
    const originalBytes = await fs.readFile(source);
    await repo.update(asset.id, { path: source, sizeBytes: originalBytes.length });
    process.env.MEDIA_ROOT = mediaRoot;
    const errors = [];
    const media = new MediaService(repo, new ConfigService(), { info() {}, error(message) { errors.push(message); } });
    await media.prepareVideo(asset.id);
    const converted = await repo.findOneByOrFail({ id: asset.id });
    assert.equal(converted.processingStatus, 'ready', errors.join('\n'));
    assert.equal(converted.sourcePath, source);
    assert.notEqual(converted.path, source);
    assert.deepEqual(await fs.readFile(source), originalBytes);
    const outputSize = (await fs.stat(converted.path)).size;
    assert.equal(converted.sizeBytes, originalBytes.length + outputSize);
    const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'json', converted.path], { encoding: 'utf8', timeout: 10000 }));
    assert.equal(probe.streams[0].codec_name, 'h264');
    assert.equal((await fs.readdir(directory)).filter(name => name.startsWith('playback-converting-')).length, 0);
    assert.deepEqual(await db.query('SELECT * FROM upload_reservations'), []);
    const priorOutput = await fs.readFile(converted.path);
    process.env.MEDIA_TRANSCODE_MAX_BYTES = '1';
    await media.prepareVideo(asset.id);
    const rejected = await repo.findOneByOrFail({ id: asset.id });
    assert.equal(rejected.processingStatus, 'failed');
    assert.equal(rejected.sizeBytes, converted.sizeBytes);
    assert.deepEqual(await fs.readFile(source), originalBytes);
    assert.deepEqual(await fs.readFile(converted.path), priorOutput);
    assert.deepEqual(await db.query('SELECT * FROM upload_reservations'), []);
    assert.equal((await fs.readdir(directory)).filter(name => name.startsWith('playback-converting-')).length, 0);
  } finally {
    if (oldRoot === undefined) delete process.env.MEDIA_ROOT; else process.env.MEDIA_ROOT = oldRoot;
    if (oldLimit === undefined) delete process.env.MEDIA_TRANSCODE_MAX_BYTES; else process.env.MEDIA_TRANSCODE_MAX_BYTES = oldLimit;
    if (db?.isInitialized) await db.destroy();
    await fs.rm(root, { recursive: true, force: true });
  }
});
