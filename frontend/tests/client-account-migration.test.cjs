const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const redirectSource = fs.readFileSync(require.resolve('../src/services/client-login-journey.ts'), 'utf8');
const redirectExports = {};
vm.runInNewContext(ts.transpileModule(redirectSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: redirectExports });

function setup(username) {
  const storage = new Map([
    ['sc.client.authServer', 'http://test/api'],
    ['sc.client.savedPassword', 'synthetic-password'],
    ...(username ? [['sc.client.savedUsername', username]] : []),
  ]);
  const calls = [];
  const dependencies = {
    pinia: { defineStore: (_id, create) => create },
    vue: { ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }), onScopeDispose() {} },
    '@/services/identity-boundary': { onServerChange: () => () => {} },
    '@/services/http': {
      getApiBaseURL: () => 'http://test/api', setClientToken() {},
      api: { post: async (url, body) => { calls.push({ url, body }); return { token: 'synthetic-token', expiresAt: '2099-01-01' }; } },
    },
  };
  const source = fs.readFileSync(require.resolve('../src/stores/client-auth.ts'), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: name => dependencies[name],
    window: { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } },
  });
  return { store: exports.useClientAuthStore(), calls, storage };
}

test('old browser plaintext password is erased without issuing a login request', () => {
  const { calls, storage } = setup('admin');
  assert.equal(storage.has('sc.client.savedPassword'), false);
  assert.equal(storage.get('sc.client.savedUsername'), 'admin');
  assert.equal(calls.length, 0);
});
test('blank username is rejected before issuing any login request', async () => {
  const { store, calls } = setup();
  await assert.rejects(store.login('  ', 'synthetic-password'), /请输入用户名/);
  assert.equal(calls.length, 0);
});
test('successful named login stores the signed token and username but never the password', async () => {
  const { store, calls, storage } = setup('previous-user');
  await store.login(' admin ', 'synthetic-password');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.username, 'admin');
  assert.equal(storage.get('sc.client.token'), 'synthetic-token');
  assert.equal(storage.get('sc.client.savedUsername'), 'admin');
  assert.equal(storage.has('sc.client.savedPassword'), false);
});

test('session expiry clears the rejected token while preserving the username for reauthentication', async () => {
  const { store, storage } = setup('admin');
  await store.login('admin', 'synthetic-password');
  store.markSessionExpired();
  assert.equal(storage.has('sc.client.token'), false);
  assert.equal(storage.get('sc.client.savedUsername'), 'admin');
});

test('post-login redirect accepts only a local application path', () => {
  const { normalizeClientRedirect } = redirectExports;
  assert.equal(normalizeClientRedirect('/media?slot=2'), '/media?slot=2');
  for (const unsafe of ['https://attacker.test', '//attacker.test', '/\\attacker.test', '/media\n/admin', null]) {
    assert.equal(normalizeClientRedirect(unsafe), '/');
  }
});
