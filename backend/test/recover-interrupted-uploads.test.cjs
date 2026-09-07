const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const Database = require('better-sqlite3');
const { recoverInterruptedUploads } = require('../scripts/recover-interrupted-uploads.cjs');
const { verifyReleaseBundle } = require('../scripts/release-recovery-bundle.cjs');

async function fixture(work) {
  const root = await fs.mkdtemp(join(tmpdir(), 'sc-upload-recovery-'));
  const databasePath = join(root, 'live.sqlite');
  const db = new Database(databasePath);
  try {
    const mediaRoot = join(root, 'media'), destinationRoot = join(root, 'backups');
    await fs.mkdir(mediaRoot); await fs.mkdir(join(mediaRoot, '_tmp')); await fs.mkdir(destinationRoot);
    db.exec('CREATE TABLE upload_reservations (id TEXT PRIMARY KEY, owner_user_id INTEGER, bytes INTEGER, temp_name TEXT, target_media_id INTEGER)');
    const name = '01234567-1234-1234-1234-012345678901.upload';
    db.prepare('INSERT INTO upload_reservations VALUES (?, 17, 100, ?, NULL)').run('interrupted', name);
    db.prepare('INSERT INTO upload_reservations VALUES (?, 17, 100, NULL, NULL)').run('not-bound');
    db.prepare('INSERT INTO upload_reservations VALUES (?, 23, 100, NULL, 42)').run('linked');
    await fs.writeFile(join(mediaRoot, '_tmp', name), 'partial-private-bytes');
    await work({ databasePath, mediaRoot, destinationRoot, sourceRevision: 'a'.repeat(40), assertWritersStopped: async () => true }, db, name);
  } finally { db.close(); await fs.rm(root, { recursive: true, force: true }); }
}

test('offline recovery preserves interrupted bytes, releases only unlinked reservations and can be retried', async () => {
  await fixture(async (options, db, name) => {
    const result = await recoverInterruptedUploads(options);
    assert.deepEqual(result.releasedIds, ['interrupted', 'not-bound']);
    assert.deepEqual(result.heldIds, ['linked']);
    assert.deepEqual(db.prepare('SELECT id FROM upload_reservations').all(), [{ id: 'linked' }]);
    await assert.rejects(fs.access(join(options.mediaRoot, '_tmp', name)));
    const backup = await verifyReleaseBundle(result.backupDirectory);
    assert.equal(await fs.readFile(join(backup.media, 'media/_tmp', name), 'utf8'), 'partial-private-bytes');
    const second = await recoverInterruptedUploads(options);
    assert.deepEqual(second.releasedIds, []);
    await verifyReleaseBundle(result.backupDirectory);
  });
});

test('refuses recovery without a verified stopped-writer fence and leaves all data intact', async () => {
  await fixture(async (options, db, name) => {
    await assert.rejects(recoverInterruptedUploads({ ...options, assertWritersStopped: async () => false }), /fence/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM upload_reservations').get().n, 3);
    assert.equal(await fs.readFile(join(options.mediaRoot, '_tmp', name), 'utf8'), 'partial-private-bytes');
    assert.deepEqual(await fs.readdir(options.destinationRoot), []);
  });
});

test('retains preserved bytes and rolls back reservations if the fence fails after unlink', async () => {
  await fixture(async (options, db, name) => {
    let checks = 0;
    await assert.rejects(recoverInterruptedUploads({ ...options, assertWritersStopped: async () => ++checks < 6 }), /fence/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM upload_reservations').get().n, 3);
    await assert.rejects(fs.access(join(options.mediaRoot, '_tmp', name)));
    const [directory] = await fs.readdir(options.destinationRoot);
    const backup = await verifyReleaseBundle(join(options.destinationRoot, directory));
    assert.equal(await fs.readFile(join(backup.media, 'media/_tmp', name), 'utf8'), 'partial-private-bytes');
    await assert.rejects(fs.access(join(options.destinationRoot, directory, 'upload-recovery.json')));
    const retry = await recoverInterruptedUploads(options);
    assert.deepEqual(retry.releasedIds, ['interrupted', 'not-bound']);
    await verifyReleaseBundle(join(options.destinationRoot, directory));
  });
});
