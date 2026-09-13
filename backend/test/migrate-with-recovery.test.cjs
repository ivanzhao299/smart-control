require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { DataSource } = require('typeorm');
const Database = require('better-sqlite3');
const { migrateWithRecovery } = require('../scripts/migrate-with-recovery.cjs');
const { verifyReleaseBundle } = require('../scripts/release-recovery-bundle.cjs');

async function fixture(work) {
  const root = await fs.mkdtemp(join(tmpdir(), 'sc-migrate-recovery-'));
  const databasePath = join(root, 'live.sqlite'), mediaRoot = join(root, 'media'), destinationRoot = join(root, 'backups');
  await fs.mkdir(mediaRoot); await fs.mkdir(destinationRoot);
  await fs.writeFile(join(mediaRoot, 'private.bin'), 'private bytes');
  class OwnershipMigration1789000000000 {
    async up(q) { await q.query('UPDATE fixture SET owner = 2'); }
    async down(q) { await q.query('UPDATE fixture SET owner = 1'); }
  }
  const ds = await new DataSource({ type: 'better-sqlite3', database: databasePath, migrations: [OwnershipMigration1789000000000] }).initialize();
  try {
    await ds.query('CREATE TABLE fixture(owner INTEGER)'); await ds.query('INSERT INTO fixture VALUES (1)');
    await work({ dataSource: ds, databasePath, mediaRoot, destinationRoot, sourceRevision: 'a'.repeat(40), assertWritersStopped: async () => true });
  } finally { await ds.destroy(); await fs.rm(root, { recursive: true, force: true }); }
}

test('real migration runs only after paired backup and isolated restore, preserving the before image', async () => {
  await fixture(async options => {
    const result = await migrateWithRecovery(options);
    assert.equal(result.migrations.length, 1);
    assert.equal((await options.dataSource.query('SELECT owner FROM fixture'))[0].owner, 2);
    const bundle = await verifyReleaseBundle(result.bundleDirectory);
    const before = new Database(bundle.database, { readonly: true });
    try { assert.equal(before.prepare('SELECT owner FROM fixture').get().owner, 1); } finally { before.close(); }
    const receipt = JSON.parse(await fs.readFile(join(result.rehearsalDirectory, 'restore.json'), 'utf8'));
    assert.equal(receipt.status, 'isolated-restore-verified');
    assert.equal(receipt.productionActivated, false);
  });
});

test('missing writer fence never invokes migration or creates a backup', async () => {
  await fixture(async options => {
    await assert.rejects(migrateWithRecovery({ ...options, assertWritersStopped: undefined }), /continuous writer fence/);
    assert.deepEqual(await fs.readdir(options.destinationRoot), []);
    assert.equal((await options.dataSource.query('SELECT owner FROM fixture'))[0].owner, 1);
  });
});

test('rejects a backup path belonging to another database before creating recovery artifacts', async () => {
  await fixture(async options => {
    const other = join(options.destinationRoot, 'other.sqlite');
    const db = new Database(other); db.close();
    await assert.rejects(migrateWithRecovery({ ...options, databasePath: other }), /same initialized file/);
    assert.deepEqual(await fs.readdir(options.destinationRoot), ['other.sqlite']);
    assert.equal((await options.dataSource.query('SELECT owner FROM fixture'))[0].owner, 1);
  });
});

test('fence loss after rehearsal refuses migration', async () => {
  await fixture(async options => {
    let checks = 0;
    await assert.rejects(migrateWithRecovery({ ...options, assertWritersStopped: async () => ++checks < 5 }), /Writer fence lost/);
    assert.equal((await options.dataSource.query('SELECT owner FROM fixture'))[0].owner, 1);
  });
});

test('post-commit fence failure preserves recovery evidence and does not roll back code or data', async () => {
  await fixture(async options => {
    let checks = 0;
    await assert.rejects(migrateWithRecovery({ ...options, assertWritersStopped: async () => ++checks < 6 }), asyncError => {
      assert.match(asyncError.message, /keep services isolated/);
      assert.ok(asyncError.bundleDirectory); assert.ok(asyncError.rehearsalDirectory);
      return true;
    });
    assert.equal((await options.dataSource.query('SELECT owner FROM fixture'))[0].owner, 2);
    const entries = await fs.readdir(options.destinationRoot);
    await verifyReleaseBundle(join(options.destinationRoot, entries.find(name => name.startsWith('release-'))));
  });
});
