const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { verifiedMediaSnapshot, verifyMediaSnapshot } = require('../scripts/verified-media-snapshot.cjs');

async function fixture(work) {
  const root = await fs.mkdtemp(join(tmpdir(), 'sc-media-backup-'));
  try {
    const source = join(root, 'source'), destination = join(root, 'backups');
    await fs.mkdir(source); await fs.mkdir(destination);
    await work(source, destination);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('copies all media including private originals, derived files and pending uploads without hardlinking', async () => {
  await fixture(async (source, destination) => {
    await fs.mkdir(join(source, '17')); await fs.mkdir(join(source, '_tmp')); await fs.mkdir(join(source, 'empty'));
    await fs.writeFile(join(source, '17', 'original.docx'), 'synthetic-private-original');
    await fs.writeFile(join(source, '17', 'preview.pdf'), '%PDF-synthetic');
    await fs.writeFile(join(source, '_tmp', '.pending.upload'), 'partial-upload');
    const first = await verifiedMediaSnapshot(source, destination);
    assert.equal(first.manifest.entries.filter(e => e.type === 'file').length, 3);
    await verifyMediaSnapshot(first.directory);
    await fs.writeFile(join(source, '17', 'original.docx'), 'later-upload');
    assert.equal(await fs.readFile(join(first.directory, 'media/17/original.docx'), 'utf8'), 'synthetic-private-original');
    const second = await verifiedMediaSnapshot(source, destination);
    assert.notEqual(first.directory, second.directory);
    await verifyMediaSnapshot(first.directory); await verifyMediaSnapshot(second.directory);
  });
});

test('verification rejects altered bytes, missing files and unexpected extra files', async () => {
  await fixture(async (source, destination) => {
    await fs.writeFile(join(source, 'private.bin'), 'synthetic-content');
    const { directory } = await verifiedMediaSnapshot(source, destination);
    const file = join(directory, 'media/private.bin');
    await fs.writeFile(file, 'tampered-content');
    await assert.rejects(verifyMediaSnapshot(directory), /mismatch/);
    await fs.unlink(file);
    await assert.rejects(verifyMediaSnapshot(directory), /mismatch/);
    await fs.writeFile(file, 'synthetic-content');
    await fs.writeFile(join(directory, 'media/extra'), 'unexpected');
    await assert.rejects(verifyMediaSnapshot(directory), /mismatch/);
  });
});

test('rejects overlapping destinations and symlinked media instead of omitting data', async () => {
  await fixture(async (source, destination) => {
    await assert.rejects(verifiedMediaSnapshot(source, source), /overlap/);
    await fs.mkdir(join(source, 'nested'));
    await assert.rejects(verifiedMediaSnapshot(source, join(source, 'nested')), /overlap/);
    await fs.symlink(destination, join(source, 'alias'), 'dir');
    await assert.rejects(verifiedMediaSnapshot(source, destination), /symbolic/);
    assert.deepEqual(await fs.readdir(destination), []);
  });
});
