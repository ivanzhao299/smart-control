const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 最小 XMLHttpRequest mock：大文件上传走原生 XHR(见 media.service.xhrUpload)。
// 每个实例暴露 __progress / __respond / __error 供测试驱动, 不自动完成。
function makeXhrMock() {
  const instances = [];
  class FakeXHR {
    constructor() {
      this.method = null; this.url = null;
      this.headers = {};
      this.upload = {};
      this.withCredentials = undefined; this.timeout = undefined;
      this.sentBody = null; this.aborted = false;
      this.status = 0; this.responseText = '';
      this.onload = null; this.onabort = null; this.onerror = null; this.ontimeout = null;
      instances.push(this);
    }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.sentBody = body; }
    abort() {
      this.aborted = true;
      // 浏览器在 send 之后 abort 会异步派发 onabort 事件。
      setTimeout(() => { if (this.onabort) this.onabort({ type: 'abort' }); }, 0);
    }
    __progress({ loaded, total }) {
      if (this.upload.onprogress) this.upload.onprogress({ lengthComputable: true, loaded, total });
    }
    __respond(status, body) {
      this.status = status;
      this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
      if (this.onload) this.onload({ type: 'load' });
    }
    __error() { if (this.onerror) this.onerror({ type: 'error' }); }
  }
  return { ctor: FakeXHR, instances };
}

function load(fetch, axiosRequest = async () => ({ data: { data: {} } }), xhr = makeXhrMock()) {
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
      XMLHttpRequest: xhr.ctor,
      setTimeout, clearTimeout, performance, setInterval: () => 1, clearInterval: () => {},
      window: { localStorage: { getItem: () => null, setItem() {} }, location: { hostname: 'localhost', port: '5173', protocol: 'http:' } },
    });
    return modules[name] = exports;
  }
  return { http: compile('./http'), boundary: compile('./identity-boundary'), media: compile('./media.service').mediaService,
    useActor: compile('./current-actor').useCurrentActor, installCrossTab: compile('./cross-tab-identity').installCrossTabIdentitySync,
    xhr,
    mount: () => mounted.forEach(fn => fn()), dispose: () => disposed.forEach(fn => fn()) };
}
const response = (status = 200, data = { privateName: 'alice' }) => ({ status, ok: status === 200, headers: { get: () => 'application/json' }, json: async () => ({ success: true, data }) });

test('mounted controls refresh immediately after administrator unlock', async () => {
  const env = load(async (_url, init) => response(200, {
    kind: 'user', userId: 1, username: 'test', role: init.headers.Authorization ? 'admin' : 'viewer',
  }));
  env.http.setClientToken('viewer-token');
  const state = env.useActor();
  await state.refreshActor();
  assert.equal(state.canOperate.value, false);
  env.http.setAdminToken('verified-admin');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(state.isAdmin.value, true);
  assert.equal(state.canOperate.value, true);
  env.dispose();
});

test('closing and reopening a read scope cannot revive its previous deferred response', async () => {
  const env = load(async () => response());
  let open = true, finishOld, finishNew;
  const begin = env.boundary.createLatestIdentityRead(() => open);
  const committed = [];
  const oldGuard = begin();
  const oldRead = new Promise(resolve => { finishOld = resolve; }).then(value => { if (oldGuard()) committed.push(value); });
  open = false; begin();
  open = true;
  const newGuard = begin();
  const newRead = new Promise(resolve => { finishNew = resolve; }).then(value => { if (newGuard()) committed.push(value); });
  finishNew('new-picker'); await newRead;
  finishOld('old-picker'); await oldRead;
  assert.deepEqual(committed, ['new-picker']);
});

test('only latest read may commit success or failure; identity and disposal revoke it', () => {
  const env = load(async () => response());
  let active = true;
  const begin = env.boundary.createLatestIdentityRead(() => active);
  const first = begin(), second = begin();
  assert.equal(first(), false);
  assert.equal(second(), true);
  env.boundary.invalidateIdentity();
  assert.equal(second(), false);
  const third = begin();
  assert.equal(third(), true);
  active = false;
  assert.equal(third(), false);
});

test('deferred action guard rejects switched identity and disposed scope before the next request', () => {
  const env = load(async () => response());
  let active = true;
  const isCurrent = env.boundary.captureIdentityGuard(() => active);
  assert.equal(isCurrent(), true);
  active = false; assert.equal(isCurrent(), false);
  active = true;
  env.boundary.invalidateIdentity();
  env.boundary.invalidateIdentity();
  assert.equal(isCurrent(), false);
  assert.equal(env.boundary.captureIdentityGuard(() => active)(), true);
});

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
  const { http, media, xhr } = load(async () => response());
  http.setClientToken('alice');
  const progress = [];
  const request = media.upload(new Blob(['test']), { onProgress: n => progress.push(n) });
  await new Promise(resolve => setTimeout(resolve, 0));
  const x = xhr.instances[0];
  assert.equal(x.method, 'POST');
  assert.ok(x.url.endsWith('/media/upload'));
  assert.equal(x.headers['X-Client-Token'], 'alice');
  assert.equal(x.headers['X-Upload-Size'], '4');
  assert.ok(!('Content-Type' in x.headers), 'multipart boundary must be set by the browser, not code');
  assert.equal(x.withCredentials, false);
  // 身份未变时的 50% 进度应透传
  x.__progress({ loaded: 2, total: 4 });
  // 身份切换(换账号) -> xhr.abort() 中止本次上传
  http.setClientToken('bob');
  assert.equal(x.aborted, true);
  // 身份切换后到达的 100% 进度必须被抑制
  x.__progress({ loaded: 4, total: 4 });
  await assert.rejects(request, { name: 'CanceledError', __CANCEL__: true });
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

test('media requests do not inject a browser-owned User-Agent into CORS preflight', async () => {
  const axios = require('axios');
  const sent = [];
  const { http, media, xhr } = load(async () => response(), config => axios.request({
    ...config,
    env: { fetch: async request => {
      sent.push(request);
      // Safari preserves custom User-Agent and therefore preflights it. Production
      // deliberately does not allow callers to replace browser-owned identity headers.
      if (request.headers.has('User-Agent')) throw new TypeError('Load failed');
      return new Response(JSON.stringify({ data: { items: [], total: 0, id: 1 } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } },
  }));
  http.setClientToken('local-user-fixture');
  http.setAdminToken('local-admin-fixture');
  // 非上传请求(list)走 axios fetch, 不注入 User-Agent, 凭证/缓存/重定向策略正确
  assert.equal((await media.list({ scope: 'visible', limit: 50 })).total, 0);
  assert.equal(sent.length, 1);
  const r = sent[0];
  assert.equal(r.headers.has('User-Agent'), false);
  assert.equal(r.headers.get('Authorization'), 'Bearer local-admin-fixture');
  assert.equal(r.headers.get('X-Client-Token'), 'local-user-fixture');
  assert.equal(r.redirect, 'error');
  assert.equal(r.cache, 'no-store');
  assert.equal(r.credentials, 'omit');
  // 上传走原生 XHR, 同样不设 User-Agent(浏览器原生处理), 携带 X-Upload-Size 与鉴权
  const up = media.upload(new Blob(['fixture']));
  await new Promise(resolve => setTimeout(resolve, 0));
  const x = xhr.instances[0];
  assert.equal(x.headers['User-Agent'], undefined);
  assert.equal(x.headers['Authorization'], 'Bearer local-admin-fixture');
  assert.equal(x.headers['X-Client-Token'], 'local-user-fixture');
  assert.equal(x.headers['X-Upload-Size'], '7');
  assert.equal(x.withCredentials, false);
  x.__respond(200, { data: { id: 1, originalName: 'fixture' } });
  assert.equal((await up).id, 1);
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

test('#65 operator rename is broad but delete stays own-private; viewer can do neither', async () => {
  let role = 'operator';
  const env = load(async () => response(200, { kind: 'user', userId: 1, username: 'alice', role }));
  env.http.setClientToken('valid'); const state = env.useActor(); await state.refreshActor();
  // 改名/备注（canEditMedia）：操作员个人账号可改任意非内置素材，不再要求是上传者本人。
  assert.equal(state.canEditMedia({ ownerUserId: 1, visibility: 'private' }), true);
  assert.equal(state.canEditMedia({ ownerUserId: 2, visibility: 'private' }), true);
  assert.equal(state.canEditMedia({ ownerUserId: 1, visibility: 'shared' }), true);
  assert.equal(state.canEditMedia({ ownerUserId: 2, visibility: 'shared' }), true);
  // 内置素材不允许改名。
  assert.equal(state.canEditMedia({ ownerUserId: 1, visibility: 'private', source: 'system' }), false);
  // 删除/转码（canDeleteMedia）：严格对齐后端 assertWriteResource——仅自己的私人资料。
  assert.equal(state.canDeleteMedia({ ownerUserId: 1, visibility: 'private' }), true);
  assert.equal(state.canDeleteMedia({ ownerUserId: 2, visibility: 'private' }), false);
  assert.equal(state.canDeleteMedia({ ownerUserId: 1, visibility: 'shared' }), false);
  assert.equal(state.canDeleteMedia({ ownerUserId: 2, visibility: 'shared' }), false);
  assert.equal(state.canDeleteMedia({ ownerUserId: 1, visibility: 'private', source: 'system' }), false);
  // legacy 共享令牌（operator 角色但无 userId）：不能改名也不能删除。
  role = 'operator'; await state.refreshActor();
  // viewer 一律不能改名/删除。
  role = 'viewer'; await state.refreshActor(); await state.refreshActor();
  assert.equal(state.canEditMedia({ ownerUserId: 1, visibility: 'private' }), false);
  assert.equal(state.canDeleteMedia({ ownerUserId: 1, visibility: 'private' }), false);
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
