const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { File } = require('node:buffer');

function compile(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, require: name => { assert.ok(name in imports, name); return imports[name]; },
    DOMException, AbortController, setTimeout, clearTimeout, console: { error() {} }, ...globals,
  });
  return exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const file = () => new File(['synthetic photo'], 'test.jpg', { type: 'image/jpeg' });

function fixture() {
  const hooks = {}, messages = [], calls = [], timers = new Map();
  const identity = compile('services/identity-boundary.ts');
  const publisher = compile('services/welcome-photo-publisher.ts');
  const service = {
    fetchSystemBranding: async () => ({ welcomePhotoMediaId: 41, configRevision: 7 }),
    saveWelcomeConfigVersioned: async (patch, revision) => {
      calls.push(['bind', patch.welcomePhotoMediaId, revision]);
      return { welcomePhotoMediaId: patch.welcomePhotoMediaId, configRevision: revision + 1 };
    },
  };
  const cache = {
    welcomeOriginalScope: async () => 'scope-a',
    readWelcomeOriginal: async () => ({ scope: 'scope-a', mediaId: 41, file: file() }),
    writeWelcomeOriginal: async value => calls.push(['cache-write', value.mediaId]),
    removeWelcomeOriginal: async (scope, id) => calls.push(['cache-remove', scope, id]),
  };
  const network = { fetch: async (url, options) => {
    calls.push(['upload', options]); return { ok: true, json: async () => ({ data: { id: 42 } }) };
  } };
  const api = compile('composables/useWelcomePhoto.ts', {
    vue: { ref: value => ({ value }), onScopeDispose: fn => hooks.dispose = fn, onDeactivated: fn => hooks.deactivate = fn, onActivated: fn => hooks.activate = fn },
    '@/services/media.service': { mediaService: { remove: async id => calls.push(['remove', id]) } },
    '@/services/http': { getApiBaseURL: () => 'https://synthetic.invalid/api', getAdminToken: () => 'fixture-admin', getClientToken: () => null },
    '@/services/system-branding.service': service,
    '@/services/identity-boundary': identity,
    '@/stores/toast': { useToastStore: () => Object.fromEntries(['success', 'info', 'error'].map(level => [level, text => messages.push([level, text])])) },
    '@/services/park-ops-control.service': { parkOpsControlService: { goto: async () => calls.push(['show']) } },
    '@/services/welcome-photo-publisher': publisher,
    '@/services/welcome-photo-original': cache,
  }, {
    File, FormData, fetch: (...args) => network.fetch(...args),
    navigator: { canShare: () => true, share: async () => calls.push(['share']) },
    setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return { state: api.useWelcomePhoto(), hooks, service, cache, network, calls, messages, timers, switchIdentity: identity.invalidateIdentity };
}

test('failed/latest reads cannot restore an old original or enable writes', async () => {
  const f = fixture(), first = deferred();
  f.service.fetchSystemBranding = () => first.promise;
  const old = f.state.loadCurrent();
  f.service.fetchSystemBranding = async () => { throw Error('offline'); };
  await f.state.loadCurrent(); first.resolve({ welcomePhotoMediaId: 41, configRevision: 7 }); await old;
  assert.equal(f.state.needsReload.value, true);
  assert.equal(f.state.pendingOriginal.value, null);
  assert.equal(f.state.beginCapture(), false);
  await f.state.takeDown(); assert.equal(f.calls.length, 0);
});

test('identity switch and scope disposal clear originals and invalidate late cache reads', async () => {
  for (const stop of [f => f.switchIdentity(), f => f.hooks.dispose()]) {
    const f = fixture(); await f.state.loadCurrent(); assert.ok(f.state.pendingOriginal.value);
    const wait = deferred(), started = deferred();
    f.cache.readWelcomeOriginal = () => { started.resolve(); return wait.promise; };
    const loading = f.state.loadCurrent(); await started.promise; stop(f);
    wait.resolve({ mediaId: 41, file: file() }); await loading;
    assert.equal(f.state.pendingOriginal.value, null); assert.equal(f.state.hasPhoto.value, false);
    await f.state.saveOriginal(); assert.equal(f.calls.some(c => c[0] === 'share'), false);
  }
});

test('capture belongs to the identity at camera/album opening, not the late callback', async () => {
  const f = fixture(); await f.state.loadCurrent(); assert.equal(f.state.beginCapture(), true);
  f.switchIdentity(); await f.state.loadCurrent(); await f.state.onCaptured(file(), file());
  assert.equal(f.calls.length, 0);
});

test('upload aborts on identity change and cannot bind or refill the new session', async () => {
  const f = fixture(); await f.state.loadCurrent(); f.state.beginCapture();
  const wait = deferred(), started = deferred(); let signal;
  f.network.fetch = async (url, options) => { signal = options.signal; assert.equal(options.redirect, 'error'); started.resolve(); return wait.promise; };
  const publishing = f.state.onCaptured(file(), file()); await started.promise; f.switchIdentity();
  assert.equal(signal.aborted, true);
  wait.resolve({ ok: true, json: async () => ({ data: { id: 42 } }) }); await publishing;
  assert.equal(f.calls.length, 0); assert.equal(f.state.pendingOriginal.value, null); assert.equal(f.timers.size, 0);
});

test('an uncertain upload has one attempt and locks further uploads until explicit refresh', async () => {
  const f = fixture(); await f.state.loadCurrent(); f.state.beginCapture(); let attempts = 0;
  f.network.fetch = async () => { attempts += 1; throw Error('network'); };
  await f.state.onCaptured(file(), file());
  assert.equal(attempts, 1); assert.equal(f.state.needsReload.value, true);
  assert.equal(f.state.beginCapture(), false); assert.equal(f.timers.size, 0);
  await f.state.loadCurrent(); assert.equal(f.state.beginCapture(), true);
});

test('keep-alive deactivation and reactivation cannot revive the old capture', async () => {
  const f = fixture(); await f.state.loadCurrent(); f.state.beginCapture();
  const wait = deferred(), started = deferred();
  f.network.fetch = () => { started.resolve(); return wait.promise; };
  const publishing = f.state.onCaptured(file(), file()); await started.promise;
  f.hooks.deactivate(); f.hooks.activate(); await f.state.loadCurrent();
  wait.resolve({ ok: true, json: async () => ({ data: { id: 42 } }) }); await publishing;
  assert.equal(f.calls.some(c => c[0] === 'bind'), false);
  assert.equal(f.messages.some(c => c[0] === 'success'), false);
});

test('withdrawal carries the displayed baseline, blocks double clicks, and clears only its original', async () => {
  const f = fixture(); await f.state.loadCurrent(); const wait = deferred(), started = deferred();
  f.service.saveWelcomeConfigVersioned = (patch, revision) => { f.calls.push(['bind', patch.welcomePhotoMediaId, revision]); started.resolve(); return wait.promise; };
  const pending = f.state.takeDown(); await started.promise; await f.state.takeDown();
  assert.deepEqual(f.calls, [['bind', null, 7]]);
  wait.resolve({ welcomePhotoMediaId: null, configRevision: 8 }); await pending;
  assert.deepEqual(f.calls, [['bind', null, 7], ['remove', 41], ['cache-remove', 'scope-a', 41]]);
  assert.equal(f.state.hasPhoto.value, false); assert.equal(f.state.pendingOriginal.value, null);
});

test('withdrawal conflict preserves originals, never retries against another photo, and requires reload', async () => {
  const f = fixture(); await f.state.loadCurrent(); let writes = 0;
  f.service.saveWelcomeConfigVersioned = async () => { writes += 1; throw { status: 409 }; };
  f.service.fetchSystemBranding = async () => ({ welcomePhotoMediaId: 99, configRevision: 8 });
  await f.state.takeDown(); await f.state.takeDown();
  assert.equal(writes, 1); assert.equal(f.state.needsReload.value, true); assert.ok(f.state.pendingOriginal.value);
  assert.equal(f.calls.length, 0);
});

test('lost withdrawal receipt is read-verified before file and original cleanup', async () => {
  const f = fixture(); await f.state.loadCurrent();
  f.service.saveWelcomeConfigVersioned = async () => { throw Error('lost'); };
  f.service.fetchSystemBranding = async () => ({ welcomePhotoMediaId: null, configRevision: 8 });
  await f.state.takeDown();
  assert.deepEqual(f.calls, [['remove', 41], ['cache-remove', 'scope-a', 41]]);
  assert.equal(f.state.hasPhoto.value, false);
});

test('successful capture uploads only the LED copy and persists the original locally without automatic share', async () => {
  const f = fixture(); await f.state.loadCurrent(); f.state.beginCapture();
  const led = new File(['led-only'], 'led.jpg'), original = new File(['private-original'], 'original.jpg');
  let cached;
  f.network.fetch = async (url, options) => {
    assert.equal(await options.body.get('file').text(), 'led-only');
    assert.equal(options.body.get('remark'), 'welcome-photo');
    return { ok: true, json: async () => ({ data: { id: 42 } }) };
  };
  f.cache.writeWelcomeOriginal = async value => cached = value;
  await f.state.onCaptured(led, original);
  assert.equal(cached.file, original); assert.equal(cached.scope, 'scope-a'); assert.equal(cached.mediaId, 42);
  assert.equal(f.state.pendingOriginal.value, original); assert.equal(f.state.needsReload.value, false);
  assert.equal(f.calls.some(c => c[0] === 'share'), false);
  assert.equal(f.timers.size, 0);
  await f.state.takeDown(); assert.deepEqual(f.calls.find(c => c[0] === 'bind' && c[1] === null), ['bind', null, 8]);
});

test('upload timeout aborts once and unlocks busy without enabling an unverified retry', async () => {
  const f = fixture(); await f.state.loadCurrent(); f.state.beginCapture(); const started = deferred();
  f.network.fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true }); started.resolve();
  });
  const publishing = f.state.onCaptured(file(), file()); await started.promise;
  for (const callback of f.timers.values()) callback();
  await publishing;
  assert.equal(f.state.busy.value, false); assert.equal(f.state.needsReload.value, true);
  assert.equal(f.timers.size, 0); assert.equal(f.calls.length, 0);
});

test('old-operation completion cannot clear the new identity upload busy state', async () => {
  const f = fixture(); await f.state.loadCurrent(); f.state.beginCapture();
  const a = deferred(), b = deferred(), aStarted = deferred(), bStarted = deferred(); let uploads = 0;
  f.network.fetch = () => { if (++uploads === 1) { aStarted.resolve(); return a.promise; } bStarted.resolve(); return b.promise; };
  const first = f.state.onCaptured(file(), file()); await aStarted.promise;
  f.switchIdentity(); await f.state.loadCurrent(); f.state.beginCapture();
  const second = f.state.onCaptured(file(), file()); await bStarted.promise;
  a.resolve({ ok: true, json: async () => ({ data: { id: 40 } }) }); await first;
  assert.equal(f.state.busy.value, true);
  b.resolve({ ok: true, json: async () => ({ data: { id: 42 } }) }); await second;
  assert.equal(f.state.busy.value, false);
  assert.equal(f.calls.filter(c => c[0] === 'bind').length, 1);
});
