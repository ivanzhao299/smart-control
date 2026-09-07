const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/run-gk9000-migrations.cjs'), 'utf8');
function fixture({ stopped = true, checkout = 'D:\\smart-control' } = {}) {
  const events = [], module = { exports: {} };
  const process = { platform: 'win32', pid: 123,
    argv: ['node', 'entry', 'E:\\recovery', 'a'.repeat(40)], env: {},
    chdir: dir => events.push(['cwd', dir]), cwd: () => 'D:\\smart-control\\backend' };
  const require = name => {
    if (name === 'node:fs') return { statSync: () => ({ isDirectory: () => true }), realpathSync: () => checkout };
    if (name === 'node:path') return path.win32;
    if (name === 'node:os') return { hostname: () => 'GK9000' };
    if (name === 'node:child_process') return { execFileSync: (file, args) => {
      events.push(['check', file, args]); if (!stopped) throw new Error('still running');
      return 'GK9000_WRITERS_STOPPED\r\n';
    } };
    if (name === './run-migrations.js') return {
      loadEnvFile: () => { events.push(['config']); process.env.MEDIA_ROOT = 'D:\\media'; },
      main: async options => { events.push(['migration', options]); await options.assertWritersStopped(); },
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
  assert.deepEqual(h.events.map(e => e[0]), ['check', 'cwd', 'config', 'migration', 'check']);
  const options = h.events.find(e => e[0] === 'migration')[1];
  assert.equal(options.destinationRoot, 'E:\\recovery');
  assert.equal(options.mediaRoot, 'D:\\media');
  assert.equal(options.sourceRevision, 'a'.repeat(40));
  assert.ok(h.events[0][2].includes('-MigrationPid'));
});
test('different checkout and malformed revision are rejected before any check or migration', async () => {
  const h = fixture({ checkout: 'D:\\other-project' });
  await assert.rejects(h.run(), /Unexpected deployment checkout/);
  assert.equal(h.events.length, 0);
  const bad = fixture(); bad.process.argv[3] = 'main';
  await assert.rejects(bad.run(), /pre-release full revision/);
  assert.equal(bad.events.length, 0);
});
