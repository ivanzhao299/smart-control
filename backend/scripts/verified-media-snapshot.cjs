const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Include hidden files, temporary uploads and derived files, not just DB paths.
// Refuse links and special files rather than silently omitting possible user data.
async function inventory(root) {
  const entries = [];
  async function walk(relative) {
    const absolute = path.join(root, relative);
    const before = await fs.lstat(absolute, { bigint: true });
    if (before.isSymbolicLink()) throw new Error('Media snapshot refuses symbolic links');
    if (before.isDirectory()) {
      entries.push({ path: relative, type: 'directory' });
      for (const name of (await fs.readdir(absolute)).sort()) {
        await walk(relative ? relative + '/' + name : name);
      }
    } else if (before.isFile()) {
      const sha256 = await digest(absolute);
      const after = await fs.lstat(absolute, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
        throw new Error('Media changed while being inspected; snapshot rejected');
      }
      if (after.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Media size exceeds safe integer range');
      entries.push({ path: relative, type: 'file', sizeBytes: Number(after.size), sha256 });
    } else throw new Error('Media snapshot refuses special files');
  }
  await walk('');
  return entries;
}

function overlaps(a, b) {
  const rel = path.relative(a, b);
  return !rel || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

async function verifyMediaSnapshot(directory) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.kind !== 'media-snapshot' || !Array.isArray(manifest.entries)) {
    throw new Error('Unsupported media snapshot manifest');
  }
  const actual = await inventory(path.join(directory, 'media'));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.entries)) throw new Error('Media snapshot checksum or inventory mismatch');
  return manifest;
}

/** Caller must stop/fence all media writers for a DB-consistent release bundle.
 * Double inventory detects changes but is NOT an atomic filesystem snapshot.
 * Never modifies the source or prunes incomplete/evidence snapshots.
 */
async function verifiedMediaSnapshot(mediaRoot, destinationRoot) {
  const source = await fs.realpath(mediaRoot);
  const destination = await fs.realpath(destinationRoot);
  if (!(await fs.stat(source)).isDirectory() || !(await fs.stat(destination)).isDirectory()) {
    throw new Error('Media source and destination must be existing directories');
  }
  if (overlaps(source, destination) || overlaps(destination, source)) throw new Error('Media source and destination must not overlap');
  const entries = await inventory(source);
  const directory = await fs.mkdtemp(path.join(destination, 'media-'));
  await fs.chmod(directory, 0o700);
  const copyRoot = path.join(directory, 'media');
  for (const entry of entries) {
    const target = path.join(copyRoot, entry.path);
    if (entry.type === 'directory') await fs.mkdir(target, { mode: 0o700 });
    else {
      await fs.copyFile(path.join(source, entry.path), target, require('node:fs').constants.COPYFILE_EXCL);
      await fs.chmod(target, 0o600);
    }
  }
  if (JSON.stringify(await inventory(copyRoot)) !== JSON.stringify(entries) ||
      JSON.stringify(await inventory(source)) !== JSON.stringify(entries)) {
    throw new Error('Media changed or copied bytes differ; snapshot rejected');
  }
  const manifest = { version: 1, kind: 'media-snapshot', createdAt: new Date().toISOString(),
    consistency: 'requires-external-writer-fence', entries };
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await verifyMediaSnapshot(directory);
  return { directory, manifest };
}

module.exports = { verifiedMediaSnapshot, verifyMediaSnapshot };
