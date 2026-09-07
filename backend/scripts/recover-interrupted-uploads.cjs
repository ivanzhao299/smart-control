const fs = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { createReleaseBundle } = require('./release-recovery-bundle.cjs');

async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

/** Offline maintenance ONLY. Caller must continuously fence all application and
 * worker writers. No PID/hostname/age heuristic authorizes cleanup. A complete
 * verified DB/media bundle is retained before touching even one reservation.
 * Linked assets are held unless their finalized files and accounted size match.
 */
async function recoverInterruptedUploads(options) {
  const bundle = await createReleaseBundle(options);
  const mediaRoot = await fs.realpath(options.mediaRoot);
  const snapshotRoot = path.join(bundle.directory, bundle.manifest.media.path);
  const snapshot = JSON.parse(await fs.readFile(path.join(snapshotRoot, 'manifest.json'), 'utf8'));
  const entries = new Map(snapshot.entries.map(entry => [entry.path, entry]));
  const db = new Database(options.databasePath, { fileMustExist: true });
  const result = { version: 1, backupDirectory: bundle.directory, releasedIds: [], heldIds: [] };
  let transaction = false;
  try {
    if (await options.assertWritersStopped() !== true) throw new Error('Writer fence is not verified');
    db.exec('BEGIN IMMEDIATE'); transaction = true;
    const hasMedia = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_assets'").get();
    const rows = db.prepare('SELECT * FROM upload_reservations ORDER BY id').all();
    for (const row of rows) {
      if (row.target_media_id !== null) {
        const asset = hasMedia ? db.prepare('SELECT * FROM media_assets WHERE id = ?').get(row.target_media_id) : null;
        if (!await finalizedAssetMatches(asset, row.owner_user_id, mediaRoot, entries)) {
          result.heldIds.push(row.id); continue;
        }
      }
      if (row.temp_name !== null) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.upload$/.test(row.temp_name)) {
          throw new Error('Invalid bound upload name; recovery stopped');
        }
        const relative = '_tmp/' + row.temp_name;
        const expected = entries.get(relative);
        const file = path.join(mediaRoot, '_tmp', row.temp_name);
        let stat;
        try { stat = await fs.lstat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (stat) {
          if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(file) !== file ||
              expected?.type !== 'file' || stat.size !== expected.sizeBytes || await hash(file) !== expected.sha256) {
            throw new Error('Upload no longer matches its preserved snapshot');
          }
          if (await options.assertWritersStopped() !== true) throw new Error('Writer fence is not verified');
          await fs.unlink(file);
        } else if (expected) throw new Error('Upload changed after backup; recovery stopped');
      }
      if (await options.assertWritersStopped() !== true) throw new Error('Writer fence is not verified');
      db.prepare('DELETE FROM upload_reservations WHERE id = ? AND target_media_id IS ?').run(row.id, row.target_media_id);
      result.releasedIds.push(row.id);
    }
    db.exec('COMMIT'); transaction = false;
    await fs.writeFile(path.join(bundle.directory, 'upload-recovery.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return result;
  } catch (error) {
    if (transaction) db.exec('ROLLBACK');
    // Already unlinked bytes remain in the verified bundle, even if DB rollback
    // leaves a reservation referring to an absent temp file. Never remove backup.
    throw error;
  } finally { db.close(); }
}

async function finalizedAssetMatches(asset, owner, mediaRoot, entries) {
  if (!asset || asset.owner_user_id !== owner || asset.processingStatus !== 'ready' || !asset.path) return false;
  const known = new Set();
  let size = 0;
  for (const value of [asset.path, asset.sourcePath, asset.thumbPath, asset.docPdfPath]) {
    if (!value) continue;
    const file = path.isAbsolute(value) ? value : path.join(mediaRoot, value);
    let real, stat;
    try { real = await fs.realpath(file); stat = await fs.lstat(file); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    const rel = path.relative(mediaRoot, real);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || !stat.isFile() || stat.isSymbolicLink()) return false;
    if (known.has(real)) continue;
    known.add(real);
    const expected = entries.get(rel.split(path.sep).join('/'));
    if (expected?.type !== 'file' || stat.size !== expected.sizeBytes || await hash(real) !== expected.sha256) return false;
    size += stat.size;
    if (!Number.isSafeInteger(size)) return false;
  }
  // Do not release a reservation masking unaccounted original/derived bytes.
  return Number(asset.sizeBytes) === size;
}

module.exports = { recoverInterruptedUploads };
