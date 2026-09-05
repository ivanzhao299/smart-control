const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(fetch, axiosRequest = async () => ({ data: { data: {} } })) {
  const modules = {};
  function compile(name) {
    if (modules[name]) return modules[name];
    if (name === './rum.service') return { trackApiCall() {} };
    if (name === 'axios') return { __esModule: true, default: { request: axiosRequest } };
    const source = fs.readFileSync(path.join(__dirname, '../src/services', name + '.ts'), 'utf8').replaceAll('import.meta.env', '({})');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    vm.runInNewContext(output, {
      exports, require: compile, fetch, DOMException, AbortController, URLSearchParams, FormData,
      setTimeout, clearTimeout, performance,
      window: { localStorage: { getItem: () => null, setItem() {} }, location: { hostname: 'localhost', port: '5173', protocol: 'http:' } },
    });
    return modules[name] = exports;
  }
  return { http: compile('./http'), boundary: compile('./identity-boundary'), media: compile('./media.service').mediaService };
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
