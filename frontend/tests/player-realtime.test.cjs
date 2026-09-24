const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const sockets = [], timeouts = new Map(), intervals = new Map(), listeners = new Set(), builds = [];
  let timerId = 0;
  const identity = { admin: null, user: null, base: 'http://localhost:3200/api' };
  const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; };
  class Socket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    open() { this.readyState = 1; this.onopen(); }
    send(data) { this.sent.push(JSON.parse(data)); }
    receive(data) { this.onmessage({ data: JSON.stringify(data) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const modules = {
    './pwa-update-monitor': { notifyFrontendBuild: build => builds.push(build) },
    './http': { getApiBaseURL: () => identity.base, getAdminToken: () => identity.admin,
      getClientToken: () => identity.user, absUrl: p => 'http://localhost:3200' + p },
    './identity-boundary': { onIdentityChange: fn => { listeners.add(fn); return () => listeners.delete(fn); } },
  };
  const localStorage = storage(), sessionStorage = storage();
  function compile(name) {
    const source = fs.readFileSync(path.join(__dirname, '../src/services', name + '.ts'), 'utf8').replaceAll('import.meta.env', '({})');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    vm.runInNewContext(output, { exports, require: n => modules[n], WebSocket: Socket, console,
      localStorage, sessionStorage, window: { location: { protocol: 'http:', host: 'localhost:5173' },
        setTimeout: fn => { timeouts.set(++timerId, fn); return timerId; }, clearTimeout: id => timeouts.delete(id),
        setInterval: fn => { intervals.set(++timerId, fn); return timerId; }, clearInterval: id => intervals.delete(id) },
    });
    return exports;
  }
  const ws = compile('websocket.service'), device = compile('player-device.service');
  return { ws, device, identity, sockets, intervals, listeners, builds,
    reconnect: () => { const callbacks = [...timeouts.values()]; timeouts.clear(); callbacks.forEach(fn => fn()); } };
}

test('dedicated player authenticates without any personal login and receives immediate invalidations', () => {
  const e = load();
  e.device.configurePlayer(1, 'synthetic-device-credential-00000001');
  const client = new e.ws.WsClient({ authentication: () => e.device.playerSocketAuthentication(1) });
  const events = [], states = [];
  client.on(event => events.push(event.type)); client.onState(state => states.push(state));
  client.connect(); e.sockets[0].open();
  assert.equal(e.sockets[0].sent[0].event, 'authenticate_player');
  assert.equal(e.sockets[0].sent[0].data.slot, 1);
  assert.equal(client.getState(), 'connecting');
  e.sockets[0].receive({ type: 'hello' });
  e.sockets[0].receive({ type: 'playback_channel_changed', slot: 1 });
  assert.deepEqual(events, ['hello', 'playback_channel_changed']);
  assert.equal(states.at(-1), 'open');
  client.disconnect();
  assert.equal(e.intervals.size, 0);
});

test('a missing device credential never falls back to an administrator login', () => {
  const e = load(); e.identity.admin = 'admin-test';
  const client = new e.ws.WsClient({ authentication: () => e.device.playerSocketAuthentication(2) });
  client.connect(); e.sockets[0].open();
  assert.equal(e.sockets[0].readyState, 3);
  assert.equal(e.sockets[0].sent.length, 0);
  client.disconnect();
});

test('both device and personal sockets forward release and reconnect identity without opening another socket', () => {
  for (const device of [true, false]) {
    const e = load(); e.identity.user = 'user-test';
    e.device.configurePlayer(1, 'synthetic-device-credential-00000001');
    const client = device ? new e.ws.WsClient({ authentication: () => e.device.playerSocketAuthentication(1) }) : e.ws.wsClient;
    client.connect(); e.sockets[0].open();
    e.sockets[0].receive({ type: 'hello', frontendBuildId: 'first' });
    e.sockets[0].receive({ type: 'frontend_release', frontendBuildId: 'second' });
    assert.deepEqual(e.builds, ['first', 'second']);
    assert.equal(e.sockets.length, 1);
    client.disconnect();
  }
});

test('reconnect authenticates again and notifies subscribers to immediately reconcile missed changes', () => {
  const e = load(); e.device.configurePlayer(1, 'synthetic-device-credential-00000001');
  const client = new e.ws.WsClient({ authentication: () => e.device.playerSocketAuthentication(1) });
  let refreshes = 0;
  client.onState(state => { if (state === 'open') refreshes++; });
  client.connect(); client.connect();
  assert.equal(e.sockets.length, 1, 'do not open duplicate connecting sockets');
  e.sockets[0].open(); e.sockets[0].receive({ type: 'hello' });
  e.sockets[0].close(); e.reconnect();
  e.sockets[1].open(); e.sockets[1].receive({ type: 'hello' });
  assert.equal(refreshes, 2);
  assert.equal(e.sockets[1].sent[0].event, 'authenticate_player');
  client.disconnect();
});

test('rotated credentials discard events from the old identity', () => {
  const e = load(); e.device.configurePlayer(1, 'synthetic-device-credential-00000001');
  const client = new e.ws.WsClient({ authentication: () => e.device.playerSocketAuthentication(1) });
  const events = []; client.on(event => events.push(event));
  client.connect(); e.sockets[0].open();
  e.device.configurePlayer(1, 'synthetic-device-credential-00000002');
  e.sockets[0].receive({ type: 'playback_channel_changed', slot: 1 });
  assert.equal(events.length, 0); assert.equal(e.sockets[0].readyState, 3);
  client.disconnect();
});

test('personal-account websocket authentication remains unchanged', () => {
  const e = load(); e.identity.user = 'user-test';
  e.ws.wsClient.connect(); e.sockets[0].open();
  assert.equal(e.sockets[0].sent[0].event, 'authenticate');
  assert.equal(e.sockets[0].sent[0].data.token, 'user-test');
  assert.equal(e.sockets[0].sent[0].data.admin, false);
  e.ws.wsClient.disconnect();
});

test('PlayerPage uses the dedicated connection, immediate reconnect reconciliation and cleanup', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/pages/PlayerPage.vue'), 'utf8');
  assert.match(source, /new WsClient\(\{ authentication: \(\) => playerSocketAuthentication\(slot.value\)/);
  assert.match(source, /if \(state === 'open'\) void fetchChannel\(\)/);
  assert.match(source, /playerWs.disconnect\(\)/);
  assert.match(source, /if \(playerWsState !== 'open'\) void fetchChannel\(\)/);
  assert.match(source, /}, 2_000\)/);
  assert.match(source, /:key="channel\.playbackSession"/);
  assert.match(source, /clearInterval\(disconnectedReconcileTimer\)/);
  assert.doesNotMatch(source, /wsClient\.connect\(\)/);
});
