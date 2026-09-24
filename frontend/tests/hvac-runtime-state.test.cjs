const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

const source = fs.readFileSync(path.resolve(__dirname, '../src/composables/useHvacRuntimeState.ts'), 'utf8');
const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/HvacPage.vue'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function indoor(idx, state = {}) {
  return {
    idx, name: `室内机 ${idx}`, floor: '1F', zoneCode: null, sortOrder: idx,
    state: { known: true, on: false, temperature: 22, mode: 'cool', fan: 'auto', online: true, faultCode: 0, ...state },
  };
}
function catalog(idx) {
  const { state, ...row } = indoor(idx);
  return row;
}
function deviceState(idx, state = {}) {
  return { idx, known: true, on: false, temperature: 22, mode: 'cool', fan: 'auto', online: true, faultCode: 0, ...state };
}
function fakeTimers() {
  let next = 1;
  const tasks = new Map();
  return {
    schedule(callback, delay) { const id = next++; tasks.set(id, { callback, delay }); return id; },
    cancel(id) { tasks.delete(id); },
    runDelay(delay) {
      const entry = [...tasks.entries()].find(([, task]) => task.delay === delay);
      assert.ok(entry, `missing timer ${delay}`);
      tasks.delete(entry[0]);
      entry[1].callback();
    },
    count() { return tasks.size; },
    delays() { return [...tasks.values()].map((task) => task.delay); },
  };
}
function execute(messages, identity) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, Promise, Date, Set, Map, require(id) {
    if (id === 'vue') return vue;
    if (id === 'element-plus') return { ElMessage: { error: (message) => messages.push(message) } };
    if (id === '@/services/hvac.service') return { hvacService: {} };
    if (id === '@/features/hvac-view-model') return {
      createUnknownIndoorState: () => ({ known: false, on: false, temperature: 24, mode: 'cool', fan: 'auto', online: false, faultCode: 0 }),
    };
    if (id === '@/services/identity-boundary') return identity;
    throw new Error(id);
  } });
  return module.exports.useHvacRuntimeState;
}
function identityBoundary() {
  let generation = 0;
  const listeners = new Set();
  return {
    api: {
      captureIdentityGuard(active) { const expected = generation; return () => expected === generation && active(); },
      onIdentityChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    invalidate() { generation += 1; for (const listener of [...listeners]) listener(); },
  };
}
function harness(service, options = {}) {
  const messages = [];
  const identity = identityBoundary();
  const timers = fakeTimers();
  const indoors = vue.ref(options.indoors || [indoor(1)]);
  const zones = vue.ref([]);
  const selected = vue.ref(new Set(options.selected || [1]));
  let now = options.now || 10_000;
  const useRuntime = execute(messages, identity.api);
  const scope = vue.effectScope();
  const state = scope.run(() => useRuntime({
    indoors, zones, selected, service,
    isBusy: () => Boolean(options.busy),
    isHidden: () => Boolean(options.hidden),
    now: () => now,
    schedule: timers.schedule,
    cancel: timers.cancel,
  }));
  return { state, indoors, zones, selected, messages, identity, timers, scope, setNow(value) { now = value; } };
}
async function settle(rounds = 8) { for (let i = 0; i < rounds; i += 1) await Promise.resolve(); }


test('catalog refresh preserves known state and prunes selections that no longer exist', async () => {
  const h = harness({
    listIndoors: async () => [catalog(1), catalog(2)],
    listZones: async () => [{ code: 'zone-a', name: 'A', floor: '1F' }],
    listStates: async () => [],
  }, { indoors: [indoor(1, { temperature: 26 })], selected: [1, 99] });
  assert.equal(await h.state.loadAll(), true);
  assert.equal(h.indoors.value[0].state.temperature, 26);
  assert.equal(h.indoors.value[1].state.known, false);
  assert.deepEqual([...h.selected.value], [1]);
  assert.equal(h.zones.value[0].code, 'zone-a');
  h.scope.stop();
});

test('a poll started before a write cannot overwrite the optimistic state', async () => {
  const stale = deferred();
  let reads = 0;
  const h = harness({
    listIndoors: async () => [catalog(1)], listZones: async () => [],
    listStates: async () => (++reads === 1 ? [deviceState(1)] : stale.promise),
  });
  h.state.startPolling();
  await settle();
  const pending = h.state.pollStates();
  h.state.markWrite();
  h.indoors.value[0].state.on = true;
  stale.resolve([deviceState(1, { on: false })]);
  assert.equal(await pending, false);
  assert.equal(h.indoors.value[0].state.on, true);
  h.scope.stop();
});

test('scheduled truth refresh bypasses the normal write cooldown', async () => {
  let reads = 0;
  const h = harness({
    listIndoors: async () => [catalog(1)], listZones: async () => [],
    listStates: async () => { reads += 1; return [deviceState(1, { temperature: reads === 1 ? 22 : 25 })]; },
  });
  h.state.startPolling();
  await settle();
  h.state.markWrite();
  h.indoors.value[0].state.temperature = 24;
  h.state.scheduleTruthRefresh();
  assert.ok(h.timers.delays().includes(1200));
  h.timers.runDelay(1200);
  await settle();
  assert.equal(reads, 2);
  assert.equal(h.indoors.value[0].state.temperature, 25);
  h.scope.stop();
});

test('deactivation suppresses an in-flight poll and prevents an orphan timer chain', async () => {
  const pending = deferred();
  let reads = 0;
  const h = harness({
    listIndoors: async () => [catalog(1)], listZones: async () => [],
    listStates: async () => (++reads === 1 ? [deviceState(1)] : pending.promise),
  });
  h.state.startPolling();
  await settle();
  assert.ok(h.timers.delays().includes(5000));
  h.timers.runDelay(5000);
  await settle(2);
  h.state.stopPolling();
  pending.resolve([deviceState(1, { on: true })]);
  await settle();
  assert.equal(h.indoors.value[0].state.on, false);
  assert.equal(h.timers.count(), 0);
  h.scope.stop();
});

test('identity change reloads the catalog and ignores the old server response', async () => {
  const oldCatalog = deferred();
  let catalogReads = 0;
  const h = harness({
    listIndoors: () => (++catalogReads === 1 ? oldCatalog.promise : Promise.resolve([catalog(2)])),
    listZones: async () => [],
    listStates: async () => [deviceState(2, { on: true })],
  });
  h.state.startPolling();
  await settle(2);
  h.identity.invalidate();
  await settle();
  oldCatalog.resolve([catalog(1)]);
  await settle();
  assert.deepEqual(h.indoors.value.map((row) => row.idx), [2]);
  assert.equal(h.indoors.value[0].state.on, true);
  assert.equal(h.messages.length, 0);
  h.scope.stop();
});

test('HvacPage delegates catalog, polling and write refresh lifecycle to the runtime composable', () => {
  assert.match(page, /useHvacRuntimeState\(\{/);
  assert.doesNotMatch(page, /hvacService\.listIndoors/);
  assert.doesNotMatch(page, /hvacService\.listStates/);
  assert.doesNotMatch(page, /function schedulePoll/);
  assert.match(source, /expectedWriteRevision === writeRevision/);
  assert.match(source, /pollStates\(true\)/);
});
