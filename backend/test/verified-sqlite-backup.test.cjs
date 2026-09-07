const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { verifiedSqliteBackup } = require('../scripts/verified-sqlite-backup.cjs');

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
