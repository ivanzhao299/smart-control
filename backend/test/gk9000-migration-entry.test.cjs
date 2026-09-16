const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/run-gk9000-migrations.cjs'), 'utf8');
function fixture({ stopped = true, checkout = 'D:\\smart-control', changed = false, pending = true, explicitMedia = true } = {}) {
  const events = [], module = { exports: {} };
  let revisions = 0;
  const process = { platform: 'win32', pid: 123,
    argv: ['node', 'entry', 'E:\\recovery', 'a'.repeat(40)], env: {},
    chdir: dir => events.push(['cwd', dir]), cwd: () => 'D:\\smart-control\\backend' };
  const require = name => {
    if (name === 'node:fs') return { statSync: () => ({ isDirectory: () => true }), realpathSync: () => checkout,
      writeFileSync: (file, value, options) => events.push(['receipt', file, JSON.parse(value), options]) };
    if (name === 'node:path') return path.win32;
    if (name === 'node:os') return { hostname: () => 'GK9000' };
    if (name === './production-paths.cjs') return { resolveProductionMediaRoot: () => process.env.MEDIA_ROOT || 'D:\\Media' };
    if (name === 'node:child_process') return { execFileSync: (file, args) => {
      if (file === 'git') { events.push(['revision']); return (changed && ++revisions > 1 ? 'c' : 'b').repeat(40); }
      events.push(['check', file, args]); if (!stopped) throw new Error('still running');
      return 'GK9000_WRITERS_STOPPED\r\n';
    } };
    if (name === './run-migrations.js') return {
      loadEnvFile: () => { events.push(['config']); if (explicitMedia) process.env.MEDIA_ROOT = 'D:\\media'; },
      main: async options => { events.push(['migration', options]); await options.assertWritersStopped();
        return pending ? { bundleDirectory: 'E:\\recovery\\release-test', rehearsalDirectory: 'E:\\recovery\\restore-test',
          databasePath: 'D:\\smart-control\\database\\smart-control.db', migrations: [{ name: 'OwnershipMigration' }] } : undefined; },
    };
    throw new Error('Unexpected import');
  };
  vm.runInNewContext(source, { module, require, process, __dirname: 'D:\\smart-control\\backend\\scripts' });
  return { run: module.exports.run, process, events };
}
test('running host cannot load configuration or start migration', async () => {
  const h = fixture({ stopped: false });
  await assert.rejects(h.run(), /still running/);
  assert.deepEqual(h.events.map(e => e[0]), ['check']);
});
test('controlled entry passes real checker callback and explicit recovery inputs', async () => {
  const h = fixture(); await h.run();
  assert.deepEqual(h.events.map(e => e[0]), ['check', 'revision', 'cwd', 'config', 'migration', 'check', 'check', 'revision', 'receipt']);
  const options = h.events.find(e => e[0] === 'migration')[1];
  assert.equal(options.destinationRoot, 'E:\\recovery');
  assert.equal(options.mediaRoot, 'D:\\media');
  assert.equal(options.sourceRevision, 'a'.repeat(40));
  assert.ok(h.events[0][2].includes('-MigrationPid'));
  const receipt = h.events.find(e => e[0] === 'receipt');
  assert.equal(receipt[2].candidateRevision, 'b'.repeat(40));
  assert.equal(receipt[2].productionActivated, false);
  assert.equal(receipt[3].flag, 'wx');
});
test('controlled entry uses the application media default when env is absent', async () => {
  const h = fixture({ explicitMedia: false });
  await h.run();
  assert.equal(h.events.find(e => e[0] === 'migration')[1].mediaRoot, 'D:\\Media');
});
test('no-op migration and changed candidate never create an activation receipt', async () => {
  for (const options of [{ pending: false }, { changed: true }]) {
    const h = fixture(options);
    await assert.rejects(h.run());
    assert.ok(!h.events.some(e => e[0] === 'receipt'));
  }
});
test('different checkout and malformed revision are rejected before any check or migration', async () => {
  const h = fixture({ checkout: 'D:\\other-project' });
  await assert.rejects(h.run(), /Unexpected deployment checkout/);
  assert.equal(h.events.length, 0);
  const bad = fixture(); bad.process.argv[3] = 'main';
  await assert.rejects(bad.run(), /pre-release full revision/);
  assert.equal(bad.events.length, 0);
});
