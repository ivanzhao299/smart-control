const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const snapshot = on => ({ ok: true, data: { matrix: [[on, false], [false, true]] } });

function fixture() {
  const calls = [], errors = [], timers = new Map(), modules = {};
  const document = { hidden: false };
  let nextId = 0;
  const service = {
    getLiveMatrix: async () => { calls.push(['read']); return snapshot(false); },
    setMatrix: async (...args) => { calls.push(['write', ...args]); return { ok: true }; },
  };
  const load = name => {
    if (modules[name]) return modules[name];
    if (name === 'vue') return vue;
    if (name === '@/services/audio.service') return { audioService: service };
    const file = name === '@/services/identity-boundary' ? 'services/identity-boundary.ts' : 'features/useAudioMatrix.ts';
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: load, document,
      setTimeout: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
      clearTimeout: id => timers.delete(id),
    });
    return modules[name] = exports;
  };
  const scope = vue.effectScope();
  const state = scope.run(() => load('matrix').useAudioMatrix(message => errors.push(message)));
  const fire = ms => {
    const entry = [...timers.entries()].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `expected a ${ms}ms timer`);
    timers.delete(entry[0]);
    return entry[1].fn();
  };
  return { scope, state, service, calls, errors, timers, fire, document,
    switchIdentity: () => load('@/services/identity-boundary').invalidateIdentity(),
  };
}

test('matrix reads preserve zero-based channel routing; failures retain last state and flag offline', async () => {
  const f = fixture();
  await f.state.loadMatrixState();
  assert.equal(f.state.isMatrixOn(1, 1), true);
  f.service.getLiveMatrix = async () => ({ ok: false, error: 'device timed out' });
  await f.state.loadMatrixState();
  assert.equal(f.state.isMatrixOn(1, 1), true);
  assert.equal(f.state.matrixStale.value, true); assert.equal(f.state.matrixOffline.value, true);
  f.service.getLiveMatrix = async () => snapshot(true);
  await f.state.loadMatrixState();
  assert.equal(f.state.matrixStale.value, false); assert.equal(f.state.matrixErrMsg.value, '');
  f.scope.stop();
});

test('late reads and errors cannot replace the latest successful matrix read', async () => {
  const f = fixture(), old = deferred();
  f.service.getLiveMatrix = () => old.promise;
  const request = f.state.loadMatrixState();
  f.service.getLiveMatrix = async () => snapshot(true);
  await f.state.loadMatrixState();
  old.reject(new Error('offline')); await request;
  assert.equal(f.state.isMatrixOn(0, 0), true); assert.equal(f.state.matrixOffline.value, false);
  f.scope.stop();
});

test('a read issued before a click cannot overwrite it after the write finishes', async () => {
  const f = fixture(), old = deferred();
  f.service.getLiveMatrix = () => old.promise;
  const read = f.state.loadMatrixState();
  await f.state.toggleMatrix(0, 0);
  old.resolve(snapshot(false)); await read;
  assert.equal(f.state.isMatrixOn(0, 0), true);
  assert.equal(f.state.pendingWrites.value, 0);
  f.scope.stop();
});

test('rapid clicks stay responsive, coalesce to the final intent and reconcile once per batch', async () => {
  const f = fixture(), pending = [];
  f.service.setMatrix = (...args) => { f.calls.push(args); const item = deferred(); pending.push(item); return item.promise; };
  const first = f.state.toggleMatrix(0, 0);
  await f.state.toggleMatrix(0, 0); await f.state.toggleMatrix(0, 0); await f.state.toggleMatrix(0, 0);
  assert.equal(f.state.isMatrixOn(0, 0), false); assert.equal(f.calls.length, 1);
  pending[0].resolve({ ok: true }); await flush();
  assert.deepEqual(f.calls, [[0, 0, true], [0, 0, false]]);
  pending[1].resolve({ ok: true }); await first;
  assert.equal(f.state.pendingWrites.value, 0); assert.equal(f.timers.size, 1);
  await f.fire(1200); await flush();
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 1); f.scope.stop();
});

test('failure after one confirmed write restores that confirmation, not the batch initial value', async () => {
  const f = fixture(), pending = [];
  f.service.setMatrix = () => { const item = deferred(); pending.push(item); return item.promise; };
  f.service.getLiveMatrix = async () => { throw new Error('offline'); };
  const first = f.state.toggleMatrix(0, 0); await f.state.toggleMatrix(0, 0);
  pending[0].resolve({ ok: true }); await flush();
  pending[1].resolve({ ok: false, error: 'not acknowledged' }); await first; await flush();
  assert.equal(f.state.isMatrixOn(0, 0), true); assert.equal(f.state.matrixStale.value, true);
  assert.match(f.errors[0], /OUT1←IN1.*not acknowledged/);
  assert.equal(f.state.pendingWrites.value, 0); f.scope.stop();
});

test('different crosspoints drain independently without hardware reads in the middle of writes', async () => {
  const f = fixture(), pending = [];
  f.service.setMatrix = () => { const item = deferred(); pending.push(item); return item.promise; };
  const a = f.state.toggleMatrix(0, 0), b = f.state.toggleMatrix(1, 1);
  await f.state.loadMatrixState(); assert.equal(f.calls.length, 0);
  pending[0].resolve({ ok: true }); await a;
  await f.fire(1200); assert.equal(f.calls.length, 0);
  pending[1].resolve({ ok: true }); await b;
  await f.fire(1200); await flush(); assert.equal(f.calls.length, 1);
  f.scope.stop();
});

test('polling is idempotent, skips hidden pages and stops all timers on leaving', async () => {
  const f = fixture(); f.state.startMatrixPolling(); f.state.startMatrixPolling();
  assert.equal(f.timers.size, 1);
  f.document.hidden = true; await f.fire(8000); assert.equal(f.calls.length, 0);
  f.document.hidden = false; await f.fire(8000); assert.equal(f.calls.length, 1);
  await f.state.toggleMatrix(0, 0); assert.equal(f.timers.size, 2);
  f.state.stopMatrixPolling(); assert.equal(f.timers.size, 0);
  await f.state.toggleMatrix(1, 1); await f.state.loadMatrixState(); assert.equal(f.calls.length, 2);
  f.scope.stop();
});

test('poll skips writes and the reconciliation delay instead of adding device queries', async () => {
  const f = fixture(); f.state.startMatrixPolling(); await f.state.toggleMatrix(0, 0);
  await f.fire(8000);
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 0);
  await f.fire(1200); await flush();
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 1); f.scope.stop();
});

test('leaving and returning during a poll does not resurrect a second polling loop', async () => {
  const f = fixture(), old = deferred(); f.service.getLiveMatrix = () => old.promise;
  f.state.startMatrixPolling(); const poll = f.fire(8000);
  f.state.stopMatrixPolling(); f.state.startMatrixPolling();
  old.resolve(snapshot(true)); await poll;
  assert.equal(f.timers.size, 1); assert.equal(f.state.isMatrixOn(0, 0), false);
  f.scope.stop(); assert.equal(f.timers.size, 0);
});

test('leaving during a write drops queued clicks and late completion cannot schedule reads', async () => {
  const f = fixture(), old = deferred();
  f.service.setMatrix = (...args) => { f.calls.push(args); return old.promise; };
  const request = f.state.toggleMatrix(0, 0); await f.state.toggleMatrix(0, 0);
  f.state.stopMatrixPolling(); old.resolve({ ok: true }); await request;
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0); assert.equal(f.state.pendingWrites.value, 0);
  assert.equal(f.state.matrixStale.value, true); f.scope.stop();
});

test('account changes clear state and old completion cannot cancel a new write of the same crosspoint', async () => {
  const f = fixture(), old = deferred(), fresh = deferred();
  f.service.setMatrix = () => old.promise;
  const first = f.state.toggleMatrix(0, 0); await f.state.toggleMatrix(0, 0);
  f.switchIdentity(); assert.deepEqual(Object.keys(f.state.matrixOn.value), []);
  f.service.setMatrix = () => fresh.promise;
  const second = f.state.toggleMatrix(0, 0); old.reject(new Error('old account failed')); await first;
  assert.equal(f.state.pendingWrites.value, 1); assert.equal(f.errors.length, 0);
  fresh.resolve({ ok: true }); await second;
  assert.equal(f.state.pendingWrites.value, 0); assert.equal(f.state.isMatrixOn(0, 0), true); f.scope.stop();
});

test('disposed scope drops late results, unsubscribes and cannot restart', async () => {
  const f = fixture(), pending = deferred(); f.service.getLiveMatrix = () => pending.promise;
  const read = f.state.loadMatrixState(); f.scope.stop(); pending.resolve(snapshot(true)); await read;
  f.switchIdentity(); f.state.startMatrixPolling(); await f.state.toggleMatrix(0, 0);
  assert.equal(f.timers.size, 0); assert.equal(f.state.isMatrixOn(0, 0), false);
});

test('AudioPage delegates matrix state and lifecycle without reintroducing direct network/timers', () => {
  const page = fs.readFileSync(path.join(__dirname, '../src/pages/AudioPage.vue'), 'utf8');
  assert.match(page, /useAudioMatrix\(/); assert.match(page, /startMatrixPolling\(\)/); assert.match(page, /stopMatrixPolling\(\)/);
  assert.doesNotMatch(page, /audioService\.(getLiveMatrix|setMatrix)\(|desiredCross|inFlightCross|reconcileTimer|matrixTimer|scheduleMatrixPoll/);
});
