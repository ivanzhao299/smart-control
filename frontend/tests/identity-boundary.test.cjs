const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(fetch, axiosRequest = async () => ({ data: { data: {} } })) {
  const modules = {};
  const mounted = [], disposed = [];
  function compile(name) {
    if (modules[name]) return modules[name];
    if (name === './rum.service') return { trackApiCall() {} };
    if (name === 'axios') return { __esModule: true, default: { request: axiosRequest } };
    if (name === 'vue') return {
      ref: value => ({ value }), computed: get => ({ get value() { return get(); } }),
      onMounted: fn => mounted.push(fn), onScopeDispose: fn => disposed.push(fn),
    };
    const source = fs.readFileSync(path.join(__dirname, '../src/services', name + '.ts'), 'utf8').replaceAll('import.meta.env', '({})');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    vm.runInNewContext(output, {
      exports, require: compile, fetch, DOMException, AbortController, URLSearchParams, FormData,
      setTimeout, clearTimeout, performance, setInterval: () => 1, clearInterval: () => {},
      window: { localStorage: { getItem: () => null, setItem() {} }, location: { hostname: 'localhost', port: '5173', protocol: 'http:' } },
    });
    return modules[name] = exports;
  }
  return { http: compile('./http'), boundary: compile('./identity-boundary'), media: compile('./media.service').mediaService,
    useActor: compile('./current-actor').useCurrentActor, installCrossTab: compile('./cross-tab-identity').installCrossTabIdentitySync,
    mount: () => mounted.forEach(fn => fn()), dispose: () => disposed.forEach(fn => fn()) };
}
const response = (status = 200, data = { privateName: 'alice' }) => ({ status, ok: status === 200, headers: { get: () => 'application/json' }, json: async () => ({ success: true, data }) });

test('rejects an old response after A -> B -> A, without expiring the new session', async () => {
  let finish;
  const { http } = load(() => new Promise(resolve => { finish = resolve; }));
  let expired = false;
  http.setUnauthorizedHandler(() => { expired = true; });
  http.setClientToken('alice');
  const request = http.api.get('/media');
  http.setClientToken('bob'); http.setClientToken('alice');
  finish(response(401));
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(expired, false);
});

test('rejects a response when identity changes during JSON parsing', async () => {
  let finishBody;
  const { http } = load(async () => ({ ...response(), json: () => new Promise(resolve => { finishBody = resolve; }) }));
  http.setClientToken('alice');
  const request = http.api.get('/media');
  await new Promise(resolve => setImmediate(resolve));
  http.setAdminToken('admin');
  finishBody({ success: true, data: { privateName: 'alice' } });
  await assert.rejects(request, { name: 'AbortError' });
});

test('same identity remains usable, requests bypass browser cache, server changes notify cleanup', async () => {
  let cache;
  const { http, boundary } = load(async (_url, init) => { cache = init.cache; return response(); });
  http.setClientToken('alice');
  let changes = 0;
  const stop = boundary.onIdentityChange(() => { changes++; });
  http.setClientToken('alice');
  assert.equal((await http.api.get('/media')).privateName, 'alice');
  assert.equal(cache, 'no-store');
  assert.equal(changes, 0);
  http.setApiBaseURL('http://different.test:3200');
  assert.equal(changes, 1);
  stop(); http.setClientToken(null);
  assert.equal(changes, 1);
});

test('server change clears both tokens before subscribers and prevents credential redirects', async () => {
  let sent;
  const { http, boundary } = load(async (_url, init) => { sent = init; return response(); });
  http.setClientToken('old-user'); http.setAdminToken('old-admin');
  let notified = false;
  boundary.onServerChange(() => {
    assert.equal(http.getClientToken(), null);
    assert.equal(http.getAdminToken(), null);
    notified = true;
  });
  http.setApiBaseURL('http://new-server.test:3200');
  await http.api.get('/client-auth/ping');
  assert.equal(notified, true);
  assert.equal(sent.headers.Authorization, undefined);
  assert.equal(sent.headers['X-Client-Token'], undefined);
  assert.equal(sent.redirect, 'error');
});

test('media upload captures credentials, aborts on switch and suppresses stale progress/result', async () => {
  let captured, finish;
  const { http, media } = load(async () => response(), config => {
    captured = config;
    return new Promise(resolve => { finish = resolve; });
  });
  http.setClientToken('alice');
  const progress = [];
  const request = media.upload(new Blob(['test']), { onProgress: n => progress.push(n) });
  assert.equal(captured.headers['X-Client-Token'], 'alice');
  assert.equal(captured.headers['X-Upload-Size'], '4');
  assert.equal(captured.adapter, 'fetch');
  assert.equal(captured.fetchOptions.redirect, 'error');
  captured.onUploadProgress({ loaded: 2, total: 4 });
  http.setClientToken('bob');
  assert.equal(captured.signal.aborted, true);
  captured.onUploadProgress({ loaded: 4, total: 4 });
  finish({ data: { data: { id: 1, originalName: 'alice-private' } } });
  await assert.rejects(request, { name: 'AbortError' });
  assert.deepEqual(progress, [50]);
});

test('media requests release identity listeners after successful completion', async () => {
  let captured;
  const { http, media } = load(async () => response(), async config => {
    captured = config; return { data: { data: { items: [], total: 0 } } };
  });
  http.setClientToken('alice');
  assert.equal((await media.list()).total, 0);
  http.setClientToken('bob');
  assert.equal(captured.signal.aborted, false);
});

test('role downgrade invalidates rendered data and stops permitting admin actions', async () => {
  let role = 'admin';
  const env = load(async () => response(200, { kind: 'user', userId: 1, username: 'alice', role }));
  env.http.setClientToken('valid');
  const state = env.useActor();
  await state.refreshActor();
  assert.equal(state.isAdmin.value, true);
  const generation = env.boundary.identityGeneration();
  role = 'viewer'; await state.refreshActor();
  assert.equal(state.isAdmin.value, false);
  assert.equal(state.canOperate.value, false);
  assert.ok(env.boundary.identityGeneration() > generation);
  env.dispose();
});

test('failed role refresh evicts prior identity but initial failure does not loop remounts', async () => {
  let fail = false;
  const env = load(async () => { if (fail) throw Error('offline'); return response(200, { kind: 'user', userId: 1, username: 'alice', role: 'operator' }); });
  env.http.setClientToken('valid'); const state = env.useActor();
  await state.refreshActor(); assert.equal(state.canOperate.value, true);
  fail = true; await state.refreshActor();
  assert.equal(state.actor.value, null);
  const generation = env.boundary.identityGeneration();
  await state.refreshActor(); assert.equal(env.boundary.identityGeneration(), generation);
  env.dispose();
});

test('late actor response after scope disposal cannot restore privileges', async () => {
  let finish;
  const env = load(() => new Promise(resolve => { finish = resolve; }));
  env.http.setClientToken('valid'); const state = env.useActor();
  const pending = state.refreshActor(); env.dispose();
  finish(response(200, { role: 'admin' })); await pending;
  assert.equal(state.actor.value, null); assert.equal(state.isAdmin.value, false);
});

test('operator can edit only own private media; viewer cannot edit', async () => {
  let role = 'operator';
  const env = load(async () => response(200, { kind: 'user', userId: 1, username: 'alice', role }));
  env.http.setClientToken('valid'); const state = env.useActor(); await state.refreshActor();
  assert.equal(state.canEditMedia({ ownerUserId: 1, visibility: 'private' }), true);
  assert.equal(state.canEditMedia({ ownerUserId: 2, visibility: 'private' }), false);
  assert.equal(state.canEditMedia({ ownerUserId: 1, visibility: 'shared' }), false);
  role = 'viewer'; await state.refreshActor(); await state.refreshActor();
  assert.equal(state.canEditMedia({ ownerUserId: 1, visibility: 'private' }), false);
  env.dispose();
});

test('cross-tab login batch invalidates immediately and reloads once without writing shared storage', async () => {
  const env = load(async () => response());
  let listener, invalidations = 0, reloads = 0;
  const local = { setItem() { throw Error('must not write'); }, removeItem() { throw Error('must not erase other login'); } };
  const target = { addEventListener: (_name, fn) => { listener = fn; }, removeEventListener() {} };
  const stop = env.installCrossTab(target, local, () => invalidations++, () => reloads++);
  listener({ storageArea: local, key: 'sc.client.token', oldValue: 'A', newValue: 'B' });
  listener({ storageArea: local, key: 'sc.client.authServer', oldValue: 'old', newValue: 'new' });
  assert.equal(invalidations, 1); assert.equal(reloads, 0);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(reloads, 1); stop();
});

test('cross-tab ignores unrelated/session-storage events and cancels reload after disposal', async () => {
  const env = load(async () => response()); let listener, invalidations = 0, reloads = 0;
  const local = {};
  const target = { addEventListener: (_name, fn) => { listener = fn; }, removeEventListener: (_name, fn) => { assert.equal(fn, listener); } };
  const stop = env.installCrossTab(target, local, () => invalidations++, () => reloads++);
  listener({ storageArea: {}, key: 'sc.client.token', oldValue: 'a', newValue: 'b' });
  listener({ storageArea: local, key: 'theme', oldValue: 'a', newValue: 'b' });
  listener({ storageArea: local, key: 'sc.client.token', oldValue: 'a', newValue: 'a' });
  assert.equal(invalidations, 0);
  listener({ storageArea: local, key: null });
  assert.equal(invalidations, 1); stop();
  await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(reloads, 0);
});

test('restricted storage getter cannot crash cross-tab initialization or invent a login', () => {
  const env = load(async () => response());
  const unexpected = () => { throw Error('must not subscribe, invalidate, or reload'); };
  const stop = env.installCrossTab(
    { addEventListener: unexpected, removeEventListener: unexpected },
    () => { throw new DOMException('Storage access denied', 'SecurityError'); },
    unexpected, unexpected,
  );
  assert.equal(typeof stop, 'function');
  stop(); stop();
});

test('lazy storage lookup still installs the real cross-tab identity boundary', () => {
  const env = load(async () => response());
  let listener, reads = 0, invalidations = 0;
  const local = {};
  const stop = env.installCrossTab(
    { addEventListener: (_name, fn) => { listener = fn; }, removeEventListener() {} },
    () => { reads++; return local; }, () => invalidations++, () => {},
  );
  assert.equal(reads, 1);
  listener({ storageArea: local, key: 'sc.client.token', oldValue: 'a', newValue: 'b' });
  assert.equal(invalidations, 1);
  stop();
});
