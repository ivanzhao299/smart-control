const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');

/** SQLite online backup includes committed WAL pages; never copy a live .db file. */
async function verifiedSqliteBackup(databasePath, destinationRoot) {
  const source = await fs.realpath(databasePath);
  if (!(await fs.stat(source)).isFile()) throw new Error('Backup source must be an existing database file');
  const prefix = destinationRoot
    ? path.join(await fs.realpath(destinationRoot), 'sqlite-') : source + '.pre-migrate-';
  const directory = await fs.mkdtemp(prefix);
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

if (require.main === module) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination || process.argv.length !== 4) {
    process.stderr.write('Usage: node verified-sqlite-backup.cjs DATABASE EXISTING_DESTINATION\n');
    process.exitCode = 1;
  } else {
    verifiedSqliteBackup(source, destination)
      .then(manifest => process.stdout.write(JSON.stringify(manifest) + '\n'))
      .catch(() => {
        process.stderr.write('Verified SQLite backup failed; deployment must not proceed.\n');
        process.exitCode = 1;
      });
  }
}
