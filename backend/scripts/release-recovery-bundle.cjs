const fs = require('node:fs/promises');
const { constants, createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { verifiedSqliteBackup } = require('./verified-sqlite-backup.cjs');
const { verifiedMediaSnapshot, verifyMediaSnapshot } = require('./verified-media-snapshot.cjs');

async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function checkRevision(revision) {
  if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('An exact source revision is required');
}

async function checkDatabase(file, expected) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.sizeBytes || await checksum(file) !== expected.sha256) {
    throw new Error('Recovery database checksum mismatch');
  }
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma('integrity_check');
    if (result.length !== 1 || result[0].integrity_check !== 'ok') throw new Error('Recovery database integrity check failed');
    if (db.pragma('foreign_key_check').length) throw new Error('Recovery database foreign key check failed');
  } finally { db.close(); }
}

async function localPath(root, relative) {
  const full = path.join(root, relative);
  if (await fs.realpath(full) !== full) throw new Error('Recovery bundle paths must not contain links');
  return full;
}

async function verifyReleaseBundle(bundleDirectory) {
  const root = await fs.realpath(bundleDirectory);
  const manifest = JSON.parse(await fs.readFile(await localPath(root, 'release.json'), 'utf8'));
  checkRevision(manifest.sourceRevision);
  if (manifest.version !== 1 || manifest.kind !== 'release-recovery-bundle' ||
      !/^sqlite-[A-Za-z0-9_-]+\/database\.sqlite$/.test(manifest.database?.path || '') ||
      !/^media-[A-Za-z0-9_-]+$/.test(manifest.media?.path || '')) throw new Error('Invalid recovery bundle manifest');
  const database = await localPath(root, manifest.database.path);
  const media = await localPath(root, manifest.media.path);
  await checkDatabase(database, manifest.database);
  const mediaManifest = await localPath(media, 'manifest.json');
  if (await checksum(mediaManifest) !== manifest.media.manifestSha256) throw new Error('Recovery media manifest checksum mismatch');
  await verifyMediaSnapshot(media);
  return { manifest, database, media };
}

/** The caller owns a continuous writer fence (service/worker/ingress shutdown).
 * Checks alone cannot establish that fence. No production caller is wired yet.
 * No success manifest is written if the caller reports loss of the fence.
 */
async function createReleaseBundle({ databasePath, mediaRoot, destinationRoot, sourceRevision, assertWritersStopped }) {
  checkRevision(sourceRevision);
  if (typeof assertWritersStopped !== 'function') throw new Error('A writer-fence verifier is required');
  const checkFence = async () => {
    if (await assertWritersStopped() !== true) throw new Error('Writer fence is not verified');
  };
  await checkFence();
  const destination = await fs.realpath(destinationRoot);
  const sourceMedia = await fs.realpath(mediaRoot);
  for (const [parent, child] of [[sourceMedia, destination], [destination, sourceMedia]]) {
    const rel = path.relative(parent, child);
    if (!rel || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))) {
      throw new Error('Recovery destination and live media must not overlap');
    }
  }
  const directory = await fs.mkdtemp(path.join(destination, 'release-'));
  await fs.chmod(directory, 0o700);
  const database = await verifiedSqliteBackup(databasePath, directory);
  await checkFence();
  const media = await verifiedMediaSnapshot(mediaRoot, directory);
  await checkFence();
  const manifest = { version: 1, kind: 'release-recovery-bundle', createdAt: new Date().toISOString(), sourceRevision,
    fence: 'external-caller-responsibility',
    database: { path: path.relative(directory, database.snapshot).split(path.sep).join('/'), sizeBytes: database.sizeBytes, sha256: database.sha256 },
    media: { path: path.basename(media.directory), manifestSha256: await checksum(path.join(media.directory, 'manifest.json')) } };
  await checkDatabase(database.snapshot, manifest.database);
  await fs.writeFile(path.join(directory, 'release.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await verifyReleaseBundle(directory);
  return { directory, manifest };
}

/** Rehearse into a newly-created directory only. Never overwrite live data.
 * Selecting/starting matching code and switching production are separate gates.
 */
async function rehearseReleaseRestore(bundleDirectory, destinationRoot) {
  const bundle = await verifyReleaseBundle(bundleDirectory);
  const destination = await fs.realpath(destinationRoot);
  const bundleRoot = await fs.realpath(bundleDirectory);
  const relative = path.relative(bundleRoot, destination);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Restore destination must be outside the bundle');
  }
  const directory = await fs.mkdtemp(path.join(destination, 'restore-'));
  await fs.chmod(directory, 0o700);
  const database = path.join(directory, 'database.sqlite');
  await fs.copyFile(bundle.database, database, constants.COPYFILE_EXCL);
  await fs.chmod(database, 0o600);
  const media = path.join(directory, 'media-snapshot');
  await fs.cp(bundle.media, media, { recursive: true, errorOnExist: true, force: false });
  await checkDatabase(database, bundle.manifest.database);
  await verifyMediaSnapshot(media);
  if (await checksum(path.join(media, 'manifest.json')) !== bundle.manifest.media.manifestSha256) {
    throw new Error('Restored media manifest checksum mismatch');
  }
  const receipt = { version: 1, sourceRevision: bundle.manifest.sourceRevision, status: 'isolated-restore-verified',
    productionActivated: false, verifiedAt: new Date().toISOString() };
  await fs.writeFile(path.join(directory, 'restore.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { directory, database, mediaRoot: path.join(media, 'media'), receipt };
}

module.exports = { createReleaseBundle, verifyReleaseBundle, rehearseReleaseRestore };
