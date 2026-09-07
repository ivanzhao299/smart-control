const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');

/** SQLite online backup includes committed WAL pages; never copy a live .db file. */
async function verifiedSqliteBackup(databasePath) {
  const source = await fs.realpath(databasePath);
  if (!(await fs.stat(source)).isFile()) throw new Error('Backup source must be an existing database file');
  const directory = await fs.mkdtemp(source + '.pre-migrate-');
  await fs.chmod(directory, 0o700);
  const snapshot = path.join(directory, 'database.sqlite');
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try { await db.backup(snapshot); }
  finally { db.close(); }
  await fs.chmod(snapshot, 0o600);
  const copy = new Database(snapshot, { readonly: true, fileMustExist: true });
  try {
    const check = copy.pragma('integrity_check');
    if (check.length !== 1 || check[0].integrity_check !== 'ok') throw new Error('Backup integrity check failed; migration must not proceed');
  } finally { copy.close(); }
  const bytes = await fs.readFile(snapshot);
  const manifest = { version: 1, createdAt: new Date().toISOString(), source, snapshot,
    sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'ok' };
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  // No automatic pruning: release/rollback evidence requires explicit retention.
  return manifest;
}
module.exports = { verifiedSqliteBackup };
