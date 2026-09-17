const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const current = '11111111-1111-4111-8111-111111111111';
const next = '22222222-2222-4222-8222-222222222222';
const later = '33333333-3333-4333-8333-333333333333';
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(hasSw = true) {
  const workerEvents = new Map(), pageEvents = new Map(), windowEvents = new Map();
  const timers = new Map(), storage = new Map();
  let nextId = 0, checks = 0, fetches = 0, reloads = 0, notices = 0;
  let version = next, fail = false;
  const installationEvents = new Map();
  const installing = { state: 'installing', addEventListener: (n,f) => installationEvents.set(n,f), removeEventListener: n => installationEvents.delete(n) };
  const registration = { installing, waiting: null, update: async () => { checks++; } };
  const workers = {
    getRegistration: async () => registration,
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
    exports, navigator: hasSw ? {serviceWorker: workers} : {}, document, AbortController,
    __FRONTEND_BUILD_ID__: current, __FRONTEND_VERSION_URL__: '/control/deployment-version.json',
    fetch: async (url, opts) => {
      fetches++; assert.equal(url, '/control/deployment-version.json'); assert.equal(opts.cache, 'no-store');
      if (fail) throw new Error('offline');
      return { ok: true, json: async () => ({frontendBuildId: version}) };
    },
    sessionStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) },
    window: {
      setTimeout: (fn, ms) => { timers.set(++nextId, {fn,ms}); return nextId; },
      clearTimeout: id => timers.delete(id),
      setInterval: () => { throw new Error('No periodic update polling permitted'); },
      addEventListener: (name, fn) => windowEvents.set(name, fn),
      removeEventListener: name => windowEvents.delete(name),
      location: {reload: () => reloads++},
    },
  });
  const stop = exports.startPwaUpdateMonitor(() => notices++);
  return {
    registration, installing, installationEvents, workers, document, timers, storage, stop, workerEvents, pageEvents, windowEvents,
    notify: exports.notifyFrontendBuild,
    setVersion: v => version = v, setFail: v => fail = v,
    get checks() { return checks; }, get fetches() {return fetches;},
    get reloads() {return reloads;}, get notices() {return notices;},
    activate: () => { registration.installing = null; workerEvents.get('controllerchange')?.(); },
    runTimeout: ms => { for (const [id,t] of [...timers]) if(t.ms===ms) {timers.delete(id);t.fn();} },
  };
}

test('idle, same build, invalid hello and unannounced SW changes do no update work', async () => {
  const s = setup(); await flush();
  s.notify(current); s.notify(undefined); s.notify('bad');
  s.activate(); s.runTimeout(300); await flush();
  assert.equal(s.fetches, 0); assert.equal(s.checks, 0); assert.equal(s.reloads, 0);
  assert.equal(s.timers.size, 0); s.stop();
});
test('release push/reconnect hello coalesce, wait for SW activation and reload only once', async () => {
  const s = setup(); s.notify(next); s.notify(next); await flush();
  assert.equal(s.fetches, 1); assert.equal(s.checks, 1); assert.equal(s.reloads, 0);
  s.activate(); s.activate(); s.notify(next); s.runTimeout(300);
  assert.equal(s.notices, 1); assert.equal(s.reloads, 1); s.stop();
});
test('HTTP LAN clients without SW and already activated SW both apply releases', async () => {
  for (const hasSw of [false, true]) {
    const s = setup(hasSw); s.registration.installing = null;
    s.notify(next); await flush(); s.runTimeout(300);
    assert.equal(s.reloads, 1); s.stop();
  }
});
test('partial publication/offline retries are bounded, reconnect resumes pending update', async () => {
  const s = setup(); s.setVersion(current); s.notify(next); await flush();
  for (const ms of [1000,5000,15000]) {s.runTimeout(ms); await flush();}
  assert.equal(s.fetches, 4); assert.equal(s.checks, 0); assert.equal(s.timers.size, 0);
  s.setVersion(next); s.notify(next); await flush(); s.activate(); s.runTimeout(300);
  assert.equal(s.reloads, 1); s.stop();
});
test('offline failure never reloads; online event retries only a pending release', async () => {
  const s = setup(); s.windowEvents.get('online')(); await flush(); assert.equal(s.fetches, 0);
  s.setFail(true); s.notify(next); await flush(); s.activate(); s.runTimeout(300); assert.equal(s.reloads, 0);
  s.setFail(false); s.windowEvents.get('online')(); await flush(); s.runTimeout(300);
  assert.equal(s.reloads, 1); s.stop();
});
test('per-build reload guard prevents loops but allows a subsequent distinct release', async () => {
  const s = setup(false); s.storage.set('sc.pwa.reloadBuild', next);
  s.notify(next); await flush(); s.runTimeout(300); assert.equal(s.reloads, 0);
  s.setVersion(later); s.notify(later); await flush(); s.runTimeout(300); assert.equal(s.reloads, 1); s.stop();
});
test('an asynchronous SW installation failure triggers bounded retry without a reload', async () => {
  const s = setup(); s.notify(next); await flush();
  s.installing.state = 'redundant'; s.installationEvents.get('statechange')();
  s.runTimeout(300); assert.equal(s.reloads, 0);
  s.registration.installing = null; s.runTimeout(1000); await flush(); s.runTimeout(300);
  assert.equal(s.reloads, 1); s.stop(); assert.equal(s.installationEvents.size, 0);
});
test('rollback to loaded build cancels pending update and disposal removes listeners/timers', async () => {
  const s = setup(); s.notify(next); await flush(); s.notify(current); s.activate(); s.runTimeout(300);
  assert.equal(s.reloads, 0); s.stop(); await flush();
  assert.equal(s.timers.size+s.workerEvents.size+s.pageEvents.size+s.windowEvents.size, 0);
});
