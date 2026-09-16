const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../scripts/run-migrations.js'), 'utf8');

function fixture(pending) {
  const events = [];
  const dataSource = {
    initialize: async () => events.push('initialize'),
    showMigrations: async () => pending,
    destroy: async () => events.push('destroy'),
  };
  const module = { exports: {} };
  const process = { cwd: () => '/fixture/backend', env: {}, argv: ['node', 'entry'] };
  const require = name => {
    if (name === 'fs') return { existsSync: () => true, readFileSync: () => Buffer.from('') };
    if (name === 'path') return path.posix;
    if (name === './migrate-with-recovery.cjs') return { migrateWithRecovery: async () => {
      events.push('migrate');
      throw new Error('preflight must not migrate');
    } };
    if (name === './production-paths.cjs') return { resolveProductionDatabasePath: () => '/fixture/database.db' };
    if (name === '/fixture/backend/dist/data-source.js') return { default: dataSource };
    throw new Error(`Unexpected import: ${name}`);
  };
  vm.runInNewContext(source, { module, require, process, console: { log: () => {}, error: () => {} } });
  return { main: module.exports.main, events };
}

for (const pending of [false, true]) {
  test(`migration preflight reports ${pending ? 'pending' : 'current'} without changing schema`, async () => {
    const h = fixture(pending);
    const result = await h.main({ checkOnly: true });
    assert.equal(result.pending, pending);
    assert.deepEqual(h.events, ['initialize', 'destroy']);
  });
}
