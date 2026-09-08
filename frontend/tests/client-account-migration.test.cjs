const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

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
  return { store: exports.useClientAuthStore(), calls };
}

test('old saved password without username does not silently recreate a legacy session', async () => {
  const { store, calls } = setup();
  assert.equal(await store.tryAutoLogin(), false);
  assert.equal(calls.length, 0);
});
test('blank username is rejected before issuing any login request', async () => {
  const { store, calls } = setup();
  await assert.rejects(store.login('  ', 'synthetic-password'), /请输入用户名/);
  assert.equal(calls.length, 0);
});
test('saved named account still automatically signs in using both credentials', async () => {
  const { store, calls } = setup('admin');
  assert.equal(await store.tryAutoLogin(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.username, 'admin');
});
