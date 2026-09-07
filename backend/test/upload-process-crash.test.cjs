const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const Database = require('better-sqlite3');
const { recoverInterruptedUploads } = require('../scripts/recover-interrupted-uploads.cjs');
const { verifyReleaseBundle } = require('../scripts/release-recovery-bundle.cjs');

for (const stage of ['bound', 'partial']) {
  test(`recovers actual quota-service state after SIGKILL at ${stage} stage`, { timeout: 20000 }, async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'sc-upload-process-crash-'));
    let child, exited, exitPromise;
    try {
      const mediaRoot = join(root, 'media'), destinationRoot = join(root, 'backups');
      await fs.mkdir(mediaRoot); await fs.mkdir(join(mediaRoot, '_tmp')); await fs.mkdir(destinationRoot);
      child = fork(join(__dirname, 'fixtures/interrupted-upload-worker.cjs'), [root, stage], {
        cwd: root, execArgv: [], env: { PATH: process.env.PATH }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      exitPromise = once(child, 'exit').then(result => { exited = true; return result; });
      const ready = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Crash fixture readiness timed out')), 10000);
        child.once('message', message => { clearTimeout(timeout); resolve(message); });
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', () => { clearTimeout(timeout); reject(new Error('Crash fixture exited before readiness')); });
      });
      assert.equal(ready.stage, stage);
      assert.ok((await fs.stat(join(root, 'live.sqlite-wal'))).size > 0);
      assert.equal(child.kill('SIGKILL'), true);
      assert.deepEqual(await exitPromise, [null, 'SIGKILL']);
      const dbPath = join(root, 'live.sqlite');
      const before = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        const row = before.prepare('SELECT * FROM upload_reservations WHERE id = ?').get(ready.id);
        assert.equal(row.bytes, 100);
        assert.equal(row.temp_name, ready.name);
        assert.ok(row.instance_id);
        assert.equal(row.target_media_id, null);
      } finally { before.close(); }
      const result = await recoverInterruptedUploads({ databasePath: dbPath, mediaRoot, destinationRoot,
        sourceRevision: 'c'.repeat(40), assertWritersStopped: async () => exited === true && child.signalCode === 'SIGKILL' });
      assert.deepEqual(result.releasedIds, [ready.id]);
      const after = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        assert.equal(after.prepare('SELECT COUNT(*) n FROM upload_reservations').get().n, 0);
        assert.ok(after.prepare('SELECT id FROM users WHERE id = ?').get(ready.userId));
        assert.deepEqual(after.pragma('foreign_key_check'), []);
      } finally { after.close(); }
      const backup = await verifyReleaseBundle(result.backupDirectory);
      if (stage === 'partial') {
        assert.equal(await fs.readFile(join(backup.media, 'media/_tmp', ready.name), 'utf8'), 'interrupted-private-bytes');
      }
      assert.deepEqual(await fs.readdir(join(mediaRoot, '_tmp')), []);
    } finally {
      if (child && !exited) { child.kill('SIGKILL'); await exitPromise; }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}
