const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { basename, join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { createReleaseBundle } = require('../scripts/release-recovery-bundle.cjs');

const script = resolve(__dirname, '../../scripts/offsite-release-backup.py');

async function fixture(work) {
  const root = await fs.mkdtemp(join(tmpdir(), 'sc-offsite-'));
  const databasePath = join(root, 'live.sqlite');
  const mediaRoot = join(root, 'media');
  const recoveryRoot = join(root, 'recovery');
  const offsiteRoot = join(root, 'offsite');
  await fs.mkdir(mediaRoot); await fs.mkdir(recoveryRoot); await fs.mkdir(offsiteRoot);
  const db = new Database(databasePath);
  try {
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO sample VALUES (1, ?)').run('authoritative-value');
    await fs.mkdir(join(mediaRoot, 'private'));
    await fs.writeFile(join(mediaRoot, 'private', 'asset.bin'), 'private-media-bytes');
    const bundle = await createReleaseBundle({
      databasePath,
      mediaRoot,
      destinationRoot: recoveryRoot,
      sourceRevision: 'a'.repeat(40),
      assertWritersStopped: async () => true,
    });
    await work({ root, bundle, offsiteRoot });
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

function run(source, destination) {
  return spawnSync('python3', [
    script,
    '--source-dir', source,
    '--bundle-name', basename(source),
    '--destination', destination,
  ], { encoding: 'utf8' });
}

test('copies and verifies a release bundle off host without replacing an existing copy', async () => {
  await fixture(async ({ bundle, offsiteRoot }) => {
    const first = run(bundle.directory, offsiteRoot);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /OFFSITE_BUNDLE_VERIFIED/);
    const copied = join(offsiteRoot, basename(bundle.directory));
    const receipt = JSON.parse(await fs.readFile(join(copied, 'offsite-receipt.json'), 'utf8'));
    assert.equal(receipt.kind, 'offsite-release-backup-receipt');
    assert.equal(receipt.sourceRevision, 'a'.repeat(40));
    assert.equal(receipt.mediaFileCount, 1);
    assert.equal(receipt.mediaBytes, Buffer.byteLength('private-media-bytes'));

    await fs.writeFile(join(bundle.directory, bundle.manifest.media.path, 'media/private/asset.bin'), 'damaged-source');
    const second = run(bundle.directory, offsiteRoot);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /OFFSITE_BUNDLE_CURRENT/);
    assert.equal(
      await fs.readFile(join(copied, bundle.manifest.media.path, 'media/private/asset.bin'), 'utf8'),
      'private-media-bytes',
    );
  });
});

test('rejects a damaged source and removes only its own incomplete staging directory', async () => {
  await fixture(async ({ bundle, offsiteRoot }) => {
    await fs.writeFile(join(bundle.directory, bundle.manifest.media.path, 'media/private/asset.bin'), 'damaged-source');
    const result = run(bundle.directory, offsiteRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /OFFSITE_BUNDLE_FAILED/);
    assert.deepEqual(await fs.readdir(offsiteRoot), []);
  });
});

test('rejects symbolic links instead of copying an incomplete recovery bundle', async () => {
  await fixture(async ({ root, bundle, offsiteRoot }) => {
    const mediaFile = join(bundle.directory, bundle.manifest.media.path, 'media/private/asset.bin');
    await fs.unlink(mediaFile);
    await fs.symlink(join(root, 'live.sqlite'), mediaFile);
    const result = run(bundle.directory, offsiteRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symbolic link|regular file/);
    assert.deepEqual(await fs.readdir(offsiteRoot), []);
  });
});
