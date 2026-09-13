const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join, dirname } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { spawnSync } = require('node:child_process');
const { verifiedSqliteBackup } = require('../scripts/verified-sqlite-backup.cjs');

test('CLI writes verified WAL snapshots only inside the selected destination and fails closed', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sc-backup-cli-'));
  const source = join(root, 'live.sqlite');
  const destination = join(root, 'snapshots');
  const db = new Database(source);
  const cli = join(__dirname, '../scripts/verified-sqlite-backup.cjs');
  try {
    await fs.mkdir(destination);
    db.pragma('journal_mode = WAL'); db.pragma('wal_autocheckpoint = 0');
    db.exec('CREATE TABLE assets (owner INTEGER); INSERT INTO assets VALUES (17)');
    const result = spawnSync(process.execPath, [cli, source, destination], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(result.stdout);
    assert.equal(manifest.integrity, 'ok');
    assert.equal(dirname(dirname(manifest.snapshot)), await fs.realpath(destination));
    const copy = new Database(manifest.snapshot, { readonly: true, fileMustExist: true });
    try { assert.deepEqual(copy.prepare('SELECT owner FROM assets').all(), [{ owner: 17 }]); }
    finally { copy.close(); }
    const before = await fs.readdir(destination);
    const missing = spawnSync(process.execPath, [cli, join(root, 'missing.sqlite'), destination], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, '');
    assert.deepEqual(await fs.readdir(destination), before);
    assert.equal(spawnSync(process.execPath, [cli], { encoding: 'utf8' }).status, 1);
  } finally { db.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('restores committed WAL content, verifies checksum, and retains independent snapshots', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sc-backup-test-'));
  const source = join(root, 'source.sqlite');
  const db = new Database(source);
  try {
    db.pragma('journal_mode = WAL'); db.pragma('wal_autocheckpoint = 0');
    db.exec('CREATE TABLE private_assets (id INTEGER PRIMARY KEY, owner INTEGER, name TEXT)');
    db.prepare('INSERT INTO private_assets VALUES (?, ?, ?)').run(1, 5, 'synthetic-private');
    assert.ok((await fs.stat(source + '-wal')).size > 0);
    const first = await verifiedSqliteBackup(source);
    const restored = new Database(first.snapshot, { readonly: true, fileMustExist: true });
    try { assert.deepEqual(restored.prepare('SELECT * FROM private_assets').all(), [{ id: 1, owner: 5, name: 'synthetic-private' }]); }
    finally { restored.close(); }
    const bytes = await fs.readFile(first.snapshot);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), first.sha256);
    assert.equal(first.sizeBytes, bytes.length);
    db.prepare('INSERT INTO private_assets VALUES (?, ?, ?)').run(2, 6, 'later-private');
    const second = await verifiedSqliteBackup(source);
    assert.notEqual(first.snapshot, second.snapshot);
    assert.notEqual(first.sha256, second.sha256);
    assert.deepEqual(await fs.readFile(first.snapshot), bytes);
  } finally { db.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('missing or invalid database fails closed instead of inventing an empty backup', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sc-backup-test-'));
  try {
    await assert.rejects(verifiedSqliteBackup(join(root, 'absent.sqlite')));
    assert.deepEqual(await fs.readdir(root), []);
    const invalid = join(root, 'invalid.sqlite');
    await fs.writeFile(invalid, 'not-a-database');
    await assert.rejects(verifiedSqliteBackup(invalid));
    assert.equal(await fs.readFile(invalid, 'utf8'), 'not-a-database');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
