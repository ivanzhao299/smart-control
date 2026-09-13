const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('../../frontend/node_modules/typescript');

const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/services/player-device.service.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), clear: () => values.clear() };
}
function load(local = storage(), session = storage()) {
  let server = 'http://localhost:3200';
  const requests = [];
  const context = {
    exports: {}, localStorage: local, sessionStorage: session, AbortSignal,
    require: name => {
      assert.equal(name, './http');
      return { absUrl: suffix => server + suffix };
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ data: { slot: 1 } }) };
    },
  };
  vm.runInNewContext(code, context);
  return { api: context.exports, local, session, requests, setServer: value => { server = value; } };
}
const token = 'test-only-device-credential-1234567890';

test('default device configuration disappears with the browser session', () => {
  const h = load(); h.api.configurePlayer(1, token);
  assert.equal(h.api.hasPlayerCredential(1), true);
  assert.equal(load(h.local).api.hasPlayerCredential(1), false);
});

test('explicitly remembered kiosk survives a new session and sends only the token header', async () => {
  const h = load(); h.api.configurePlayer(1, token, true);
  const reopened = load(h.local);
  assert.equal(reopened.api.hasPlayerCredential(1), true);
  await reopened.api.getPlayerState(1);
  assert.equal(reopened.requests[0].options.headers['X-Player-Token'], token);
  assert.equal(reopened.requests[0].url.includes(token), false);
});

test('remembered credentials remain scoped to the server and channel', () => {
  const h = load(); h.api.configurePlayer(1, token, true);
  assert.equal(h.api.hasPlayerCredential(2), false);
  h.setServer('http://other-server:3200');
  assert.equal(h.api.hasPlayerCredential(1), false);
});

test('switching back to session-only removes remembered credentials', () => {
  const h = load(); h.api.configurePlayer(1, token, true);
  h.api.configurePlayer(1, token + '-replacement', false);
  assert.equal(load(h.local).api.hasPlayerCredential(1), false);
});

test('invalid replacement cannot erase a valid remembered credential', async () => {
  const h = load(); h.api.configurePlayer(1, token, true);
  assert.throws(() => h.api.configurePlayer(1, 'short', false));
  const reopened = load(h.local); await reopened.api.getPlayerState(1);
  assert.equal(reopened.requests[0].options.headers['X-Player-Token'], token);
});
