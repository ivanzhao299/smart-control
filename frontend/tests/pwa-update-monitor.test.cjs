const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup(initialController = {}) {
  const workerEvents = new Map();
  const pageEvents = new Map();
  const timers = new Map();
  const intervals = new Map();
  const storage = new Map();
  let nextId = 0, checks = 0, reloads = 0, notices = 0;
  let update = async () => {};
  const workers = {
    controller: initialController,
    ready: Promise.resolve({ update() { checks++; return update(); } }),
    addEventListener: (name, fn) => workerEvents.set(name, fn),
    removeEventListener: name => workerEvents.delete(name),
  };
  const document = {
    visibilityState: 'visible',
    addEventListener: (name, fn) => pageEvents.set(name, fn),
    removeEventListener: name => pageEvents.delete(name),
  };
  const exports = {};
  const source = fs.readFileSync(path.resolve(__dirname, '../src/services/pwa-update-monitor.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    exports, navigator: { serviceWorker: workers }, document,
    sessionStorage: {
      getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    window: {
      setTimeout: (fn, ms) => { timers.set(++nextId, {fn, ms}); return nextId; },
      clearTimeout: id => timers.delete(id),
      setInterval: (fn, ms) => { intervals.set(++nextId, {fn, ms}); return nextId; },
      clearInterval: id => intervals.delete(id),
      location: { reload: () => reloads++ },
    },
  });
  const stop = exports.startPwaUpdateMonitor(() => notices++);
  return {
    workers, document, workerEvents, pageEvents, timers, intervals, storage, stop,
    setUpdate: fn => { update = fn; },
    get checks() { return checks; }, get reloads() { return reloads; }, get notices() { return notices; },
    tick: () => { for (const {fn} of intervals.values()) fn(); },
    change: controller => { workers.controller = controller; workerEvents.get('controllerchange')?.(); },
    runTimeout: ms => { for (const [id, timer] of timers) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('always-visible kiosk checks later releases without a visibility transition', async () => {
  const s = setup(); await flush();
  assert.equal(s.checks, 1);
  assert.equal([...s.intervals.values()][0].ms, 60000);
  s.tick(); await flush();
  assert.equal(s.checks, 2);
  s.change({}); s.runTimeout(300);
  assert.equal(s.reloads, 1);
});

test('first service worker claim does not reload, but the next release does', async () => {
  const s = setup(null); await flush();
  const first = {};
  s.change(first); s.runTimeout(300);
  assert.equal(s.reloads, 0);
  s.change(first);
  assert.equal(s.notices, 0);
  s.change({}); s.change({}); s.runTimeout(300);
  assert.equal(s.notices, 1);
  assert.equal(s.reloads, 1);
});

test('offline updates retry and concurrent checks are coalesced', async () => {
  const s = setup(); await flush();
  s.setUpdate(() => Promise.reject(new Error('offline')));
  s.tick(); await flush();
  assert.equal(s.reloads, 0);
  let finish;
  s.setUpdate(() => new Promise(resolve => { finish = resolve; }));
  s.tick(); await flush(); s.tick(); await flush();
  assert.equal(s.checks, 3);
  finish(); await flush(); s.tick(); await flush();
  assert.equal(s.checks, 4);
  s.stop(); finish(); await flush();
});

test('a release during the reload cooldown is applied after the cooldown', async () => {
  const s = setup(); await flush();
  s.storage.set('sc.pwa.updatedReload', '1');
  s.change({}); s.runTimeout(300);
  assert.equal(s.reloads, 0);
  s.runTimeout(5000); s.runTimeout(300);
  assert.equal(s.reloads, 1);
});

test('background pages pause checks and cleanup removes timers and listeners', async () => {
  const s = setup(); await flush();
  s.document.visibilityState = 'hidden'; s.tick(); await flush();
  assert.equal(s.checks, 1);
  s.document.visibilityState = 'visible'; s.pageEvents.get('visibilitychange')(); await flush();
  assert.equal(s.checks, 2);
  s.change({}); s.stop(); s.runTimeout(300);
  assert.equal(s.reloads, 0);
  assert.equal(s.timers.size + s.intervals.size + s.workerEvents.size + s.pageEvents.size, 0);
});
