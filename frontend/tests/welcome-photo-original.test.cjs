const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

/** Deterministic IDB event stub; real browser storage remains a separate acceptance gate. */
function fixture() {
  let stored, closed = 0, opens = 0;
  const hooks = { afterOpen: () => {}, beforeGet: () => {} };
  const indexedDB = { open() {
    opens += 1;
    const request = {};
    queueMicrotask(() => {
      hooks.afterOpen();
      request.result = {
        close: () => closed += 1,
        transaction: () => {
          const tx = {};
          tx.objectStore = () => ({
            get: () => {
              const req = {};
              queueMicrotask(() => { hooks.beforeGet(); req.result = stored; req.onsuccess(); queueMicrotask(() => tx.oncomplete?.()); });
              return req;
            },
            put: value => { stored = value; queueMicrotask(() => tx.oncomplete?.()); },
            delete: () => { stored = undefined; },
          });
          return tx;
        },
      };
      request.onsuccess();
    });
    return request;
  } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/welcome-photo-original.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, indexedDB, crypto: webcrypto, TextEncoder, Uint8Array });
  return { api: exports, hooks, set: value => stored = value, get: () => stored, stats: () => ({ opens, closed }) };
}
const original = (scope = 'session-a', mediaId = 41) => ({ scope, mediaId, ts: 1, file: { synthetic: true } });

test('local original scope is stable for a reload but differs across servers and credentials', async () => {
  const { api } = fixture();
  const a = await api.welcomeOriginalScope('https://a.invalid/api', 'test-token-a', null);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(await api.welcomeOriginalScope('https://a.invalid/api', 'test-token-a', null), a);
  assert.notEqual(await api.welcomeOriginalScope('https://b.invalid/api', 'test-token-a', null), a);
  assert.notEqual(await api.welcomeOriginalScope('https://a.invalid/api', 'test-token-b', null), a);
  assert.equal(await api.welcomeOriginalScope('https://a.invalid/api', null, null), null);
});

test('cache returns only its scope and never restores legacy unscoped records', async () => {
  const f = fixture();
  await f.api.writeWelcomeOriginal(original(), () => true);
  assert.equal((await f.api.readWelcomeOriginal('session-a', () => true)).mediaId, 41);
  assert.equal(await f.api.readWelcomeOriginal('session-b', () => true), null);
  f.set({ mediaId: 41, file: { legacy: true } });
  assert.equal(await f.api.readWelcomeOriginal('session-a', () => true), null);
  assert.ok(f.get()); // No indiscriminate deletion of unknown old originals.
  assert.equal(f.stats().opens, f.stats().closed);
});

test('late storage open or read cannot restore or overwrite an invalidated session', async () => {
  for (const operation of ['read', 'write']) {
    const f = fixture(); f.set(original('session-b', 99)); let active = true;
    f.hooks.afterOpen = () => active = false;
    if (operation === 'read') assert.equal(await f.api.readWelcomeOriginal('session-b', () => active), null);
    else await f.api.writeWelcomeOriginal(original(), () => active);
    assert.equal(f.get().mediaId, 99); assert.equal(f.stats().opens, f.stats().closed);
  }
  const f = fixture(); f.set(original()); let active = true;
  f.hooks.beforeGet = () => active = false;
  assert.equal(await f.api.readWelcomeOriginal('session-a', () => active), null);
});

test('compare-and-delete preserves different sessions, newer media and invalidated operations', async () => {
  const f = fixture(); f.set(original());
  await f.api.removeWelcomeOriginal('session-b', 41, () => true); assert.ok(f.get());
  await f.api.removeWelcomeOriginal('session-a', 40, () => true); assert.ok(f.get());
  let active = true; f.hooks.beforeGet = () => active = false;
  await f.api.removeWelcomeOriginal('session-a', 41, () => active); assert.ok(f.get());
  f.hooks.beforeGet = () => {}; active = true;
  await f.api.removeWelcomeOriginal('session-a', 41, () => active); assert.equal(f.get(), undefined);
  assert.equal(f.stats().opens, f.stats().closed);
});
