const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class HttpError extends Error {
  constructor(message, status) { super(message); this.name = 'HttpError'; this.status = status; }
}

function loadAdminStore(adminMe) {
  const apiBase = 'https://example.test/control/api';
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const sessionStorage = new MemoryStorage({
    'sc.adminToken': 'named-admin',
    'sc.adminToken:exp': expiresAt,
    'sc.adminAuthServer': apiBase,
  });
  const localStorage = new MemoryStorage({
    'sc.adminToken.persist': JSON.stringify({ token: 'named-admin', expiresAt, server: apiBase }),
  });
  let httpAdmin = null;
  const source = fs.readFileSync(path.resolve(__dirname, '../src/stores/admin-auth.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const requireMock = (name) => {
    if (name === 'pinia') return { defineStore: (_id, setup) => setup };
    if (name === 'vue') return {
      ref: value => ({ value }),
      computed: getter => ({ get value() { return getter(); } }),
      onScopeDispose() {},
    };
    if (name === '@/services/identity-boundary') return { onServerChange: () => () => {} };
    if (name === '@/services/admin-auth.service') return {
      adminLogin: async () => { throw new Error('unused'); },
      adminLogout: async () => undefined,
      adminMe,
    };
    if (name === '@/services/http') return {
      HttpError,
      setAdminToken: value => { httpAdmin = value; },
      getApiBaseURL: () => apiBase,
      getClientToken: () => 'legacy-client',
    };
    throw new Error(`Unexpected import: ${name}`);
  };
  vm.runInNewContext(output, {
    module, exports: module.exports, require: requireMock,
    sessionStorage, localStorage, Date, JSON, Error,
  });
  return {
    store: module.exports.useAdminAuthStore(),
    sessionStorage,
    localStorage,
    getHttpAdmin: () => httpAdmin,
  };
}

test('administrator verification retries an identity-boundary abort without erasing the restored session', async () => {
  let calls = 0;
  const env = loadAdminStore(async () => {
    calls += 1;
    if (calls === 1) throw new DOMException('identity changed', 'AbortError');
    return { authenticated: true };
  });

  assert.equal(await env.store.ensureChecked(), true);
  assert.equal(calls, 2);
  assert.equal(env.getHttpAdmin(), 'named-admin');
  assert.equal(env.sessionStorage.getItem('sc.adminToken'), 'named-admin');
  assert.ok(env.localStorage.getItem('sc.adminToken.persist'));
});

test('transient verification failure preserves credentials, while an authoritative rejection clears them', async () => {
  const offline = loadAdminStore(async () => { throw new HttpError('offline', 0); });
  assert.equal(await offline.store.ensureChecked(), false);
  assert.equal(offline.sessionStorage.getItem('sc.adminToken'), 'named-admin');
  assert.ok(offline.localStorage.getItem('sc.adminToken.persist'));

  const rejected = loadAdminStore(async () => { throw new HttpError('forbidden', 403); });
  assert.equal(await rejected.store.ensureChecked(), false);
  assert.equal(rejected.sessionStorage.getItem('sc.adminToken'), null);
  assert.equal(rejected.localStorage.getItem('sc.adminToken.persist'), null);
  assert.equal(rejected.getHttpAdmin(), null);
});
