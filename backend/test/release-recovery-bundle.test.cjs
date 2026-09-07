const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const Database = require('better-sqlite3');
const { createReleaseBundle, verifyReleaseBundle, rehearseReleaseRestore } = require('../scripts/release-recovery-bundle.cjs');

async function fixture(work) {
  const root = await fs.mkdtemp(join(tmpdir(), 'sc-recovery-'));
  const databasePath = join(root, 'live.sqlite');
  const db = new Database(databasePath);
  try {
    const mediaRoot = join(root, 'media'), destinationRoot = join(root, 'backups'), restores = join(root, 'restores');
    await fs.mkdir(mediaRoot); await fs.mkdir(destinationRoot); await fs.mkdir(restores);
    db.exec('CREATE TABLE media (id INTEGER PRIMARY KEY, owner INTEGER, path TEXT)');
    db.prepare('INSERT INTO media VALUES (1, 17, ?)').run('private.bin');
    await fs.writeFile(join(mediaRoot, 'private.bin'), 'private-original');
    await work({ databasePath, mediaRoot, destinationRoot, sourceRevision: 'a'.repeat(40), assertWritersStopped: async () => true }, db, restores);
  } finally { db.close(); await fs.rm(root, { recursive: true, force: true }); }
}

test('restores a matched private database and media snapshot without replacing newer live data', async () => {
  await fixture(async (options, db, restores) => {
    const bundle = await createReleaseBundle(options);
    db.exec('UPDATE media SET owner = 23');
    await fs.writeFile(join(options.mediaRoot, 'private.bin'), 'newer-private-data');
    const restored = await rehearseReleaseRestore(bundle.directory, restores);
    const copy = new Database(restored.database, { readonly: true, fileMustExist: true });
    try {
      const record = copy.prepare('SELECT * FROM media').get();
      assert.equal(record.owner, 17);
      assert.equal(await fs.readFile(join(restored.mediaRoot, record.path), 'utf8'), 'private-original');
    } finally { copy.close(); }
    assert.equal(db.prepare('SELECT owner FROM media').get().owner, 23);
    assert.equal(await fs.readFile(join(options.mediaRoot, 'private.bin'), 'utf8'), 'newer-private-data');
    assert.equal(restored.receipt.sourceRevision, options.sourceRevision);
    assert.equal(restored.receipt.productionActivated, false);
    await verifyReleaseBundle(bundle.directory);
  });
});

test('requires a writer fence and does not certify a bundle if it is lost midway', async () => {
  await fixture(async options => {
    await assert.rejects(createReleaseBundle({ ...options, assertWritersStopped: undefined }), /verifier/);
    await assert.rejects(createReleaseBundle({ ...options, assertWritersStopped: async () => false }), /fence/);
    assert.deepEqual(await fs.readdir(options.destinationRoot), []);
    let checks = 0;
    await assert.rejects(createReleaseBundle({ ...options, assertWritersStopped: async () => ++checks < 3 }), /fence/);
    const [incomplete] = await fs.readdir(options.destinationRoot);
    await assert.rejects(fs.access(join(options.destinationRoot, incomplete, 'release.json')));
  });
});

test('rejects damaged paired media before creating a restore directory', async () => {
  await fixture(async (options, db, restores) => {
    const bundle = await createReleaseBundle(options);
    await fs.writeFile(join(bundle.directory, bundle.manifest.media.path, 'media/private.bin'), 'corrupted');
    await assert.rejects(rehearseReleaseRestore(bundle.directory, restores), /mismatch/);
    assert.deepEqual(await fs.readdir(restores), []);
    assert.equal(db.prepare('SELECT owner FROM media').get().owner, 17);
  });
});

test('rejects a backup destination inside live media before creating any snapshot', async () => {
  await fixture(async options => {
    const nested = join(options.mediaRoot, 'backups');
    await fs.mkdir(nested);
    await assert.rejects(createReleaseBundle({ ...options, destinationRoot: nested }), /overlap/);
    assert.deepEqual(await fs.readdir(nested), []);
  });
});

test('refuses to certify restored application paths outside the original media root', async () => {
  await fixture(async (options, db, restores) => {
    db.exec('CREATE TABLE media_assets (id INTEGER PRIMARY KEY, path TEXT)');
    db.prepare('INSERT INTO media_assets VALUES (1, ?)').run(join(options.mediaRoot, '..', 'outside-private.bin'));
    const bundle = await createReleaseBundle(options);
    await assert.rejects(rehearseReleaseRestore(bundle.directory, restores), /escapes/);
    const [partial] = await fs.readdir(restores);
    await assert.rejects(fs.access(join(restores, partial, 'restore.json')));
    await verifyReleaseBundle(bundle.directory);
  });
});
