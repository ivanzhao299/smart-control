const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/verify-gk9000-migration-receipt.cjs'), 'utf8');
function fixture({ changedPath = false, wrongRevision = false, damaged = false } = {}) {
  const events = [], module = { exports: {} }, process = { platform: 'linux', env: {} };
  const receipt = { version: 1, kind: 'gk9000-migration-complete', candidateRevision: (wrongRevision ? 'c' : 'b').repeat(40),
    sourceRevision: 'a'.repeat(40), productionActivated: false, databasePath: '/fixture/database/smart-control.db', mediaRoot: '/fixture/media' };
  const require = name => {
    if (name === 'node:fs/promises') return { readFile: async () => JSON.stringify(receipt) };
    if (name === 'node:path') return path.posix;
    if (name === './release-recovery-bundle.cjs') return { verifyReleaseBundle: async () => {
      events.push('bundle'); if (damaged) throw new Error('damaged'); return { manifest: { sourceRevision: 'a'.repeat(40) } };
    } };
    if (name === './run-migrations.js') return { loadEnvFile: () => {
      events.push('config'); process.env.MEDIA_ROOT = changedPath ? '/different/media' : '/fixture/media';
    } };
    if (name === './production-paths.cjs') return {
      resolveProductionDatabasePath: () => '/fixture/database/smart-control.db',
      resolveProductionMediaRoot: () => changedPath ? '/different/media' : '/fixture/media',
    };
    throw new Error('Unexpected dependency');
  };
  vm.runInNewContext(source, { module, require, process });
  return { run: () => module.exports.verify('/backup/migration-complete.json', 'b'.repeat(40), '/fixture'), events };
}
test('activation receipt checks bundle and current production paths', async () => {
  const h = fixture(); assert.equal(await h.run(), true); assert.deepEqual(h.events, ['bundle', 'config']);
});
test('different candidate is rejected before bundle/config reads', async () => {
  const h = fixture({ wrongRevision: true }); await assert.rejects(h.run(), /Invalid migration/); assert.deepEqual(h.events, []);
});
test('damaged recovery bundle cannot proceed to configuration validation', async () => {
  const h = fixture({ damaged: true }); await assert.rejects(h.run(), /damaged/); assert.deepEqual(h.events, ['bundle']);
});
test('changed media configuration prevents activation', async () => {
  await assert.rejects(fixture({ changedPath: true }).run(), /paths changed/);
});
