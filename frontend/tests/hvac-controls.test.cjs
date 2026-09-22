const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

const source = fs.readFileSync(path.resolve(__dirname, '../src/composables/useHvacControls.ts'), 'utf8');
const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/HvacPage.vue'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function indoor(idx, state = {}) {
  return {
    idx,
    name: `室内机 ${idx}`,
    floor: idx === 3 ? '2F' : '1F',
    zoneCode: 'zone-a',
    sortOrder: idx,
    state: {
      known: true,
      on: false,
      temperature: 22,
      mode: 'cool',
      fan: 'auto',
      online: true,
      faultCode: 0,
      ...state,
    },
  };
}

function result(okCount = 1, failCount = 0) {
  return { total: okCount + failCount, okCount, failCount, results: [] };
}

async function settle(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function identityBoundary() {
  let generation = 0;
  const listeners = new Set();
  return {
    api: {
      captureIdentityGuard(active) {
        const expected = generation;
        return () => expected === generation && active();
      },
      onIdentityChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    invalidate() {
      generation += 1;
      for (const listener of [...listeners]) listener();
    },
  };
}

function execute(identity) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    Promise,
    Map,
    require(id) {
      if (id === 'vue') return vue;
      if (id === 'element-plus') return { ElMessage: {}, ElMessageBox: { confirm: async () => {} } };
      if (id === '@/services/haptics') return { haptics: { tap() {} } };
      if (id === '@/services/hvac.service') return { hvacService: {} };
      if (id === '@/services/identity-boundary') return identity;
      if (id === '@/features/hvac-view-model') return {};
      throw new Error(id);
    },
  });
  return module.exports.useHvacControls;
}

function harness(serviceOverrides = {}, options = {}) {
  const rows = vue.ref(options.rows || [indoor(1), indoor(2)]);
  const selected = vue.ref(new Set(options.selected || [1]));
  let floor = options.floor || 'all';
  let writes = 0;
  let refreshes = 0;
  let taps = 0;
  const warnings = [];
  const errors = [];
  const identity = identityBoundary();
  const ok = async () => result();
  const service = {
    batchOn: ok,
    batchOff: ok,
    batchTemperature: ok,
    batchMode: ok,
    batchFanSpeed: ok,
    ...serviceOverrides,
  };
  const useControls = execute(identity.api);
  const scope = vue.effectScope();
  const controls = scope.run(() => useControls({
    indoors: rows,
    selectedRows: () => rows.value.filter((row) => selected.value.has(row.idx)),
    visibleIndoors: () => floor === 'all' ? rows.value : rows.value.filter((row) => row.floor === floor),
    floor: () => floor,
    markWrite: () => { writes += 1; },
    scheduleTruthRefresh: () => { refreshes += 1; },
    service,
    confirm: options.confirm || (async () => {}),
    messages: {
      warning: (message) => warnings.push(message),
      error: (message) => errors.push(message),
    },
    tap: () => { taps += 1; },
  }));
  return {
    controls,
    rows,
    selected,
    identity,
    scope,
    warnings,
    errors,
    counts: () => ({ writes, refreshes, taps }),
    setFloor(value) { floor = value; },
  };
}

function zoneCard(rows, overrides = {}) {
  return {
    code: 'zone-a',
    name: '会议区',
    members: rows,
    onCount: rows.filter((row) => row.state.on).length,
    temp: 22,
    mode: 'cool',
    avgRoomT: null,
    ...overrides,
  };
}

test('selected and zone controls share one command lock', async () => {
  const pending = deferred();
  let zoneCalls = 0;
  const h = harness({
    batchOn: () => pending.promise,
    batchMode: async () => { zoneCalls += 1; return result(); },
  });
  const selectedCommand = h.controls.turnOn();
  assert.equal(h.controls.busy.value, true);
  assert.equal(h.controls.dispatching.value, true);

  const zoneCommand = await h.controls.zoneSetMode(zoneCard(h.rows.value), 'heat');
  assert.equal(zoneCommand, false);
  assert.equal(zoneCalls, 0);

  pending.resolve(result());
  assert.equal(await selectedCommand, true);
  assert.equal(h.controls.busy.value, false);
  assert.deepEqual(h.counts(), { writes: 1, refreshes: 1, taps: 1 });
  h.scope.stop();
});

test('current total failure rolls back while partial success keeps optimistic state', async () => {
  const h = harness({
    batchOn: async () => { throw new Error('网关超时'); },
    batchTemperature: async () => result(1, 1),
  }, { selected: [1, 2] });

  assert.equal(await h.controls.turnOn(), false);
  assert.deepEqual(h.rows.value.map((row) => row.state.on), [false, false]);
  assert.match(h.errors[0], /开机 失败: 网关超时/);

  assert.equal(await h.controls.setTemperature(25), true);
  assert.deepEqual(h.rows.value.map((row) => row.state.temperature), [25, 25]);
  assert.match(h.warnings[0], /温度: 部分成功 \(1\/2\)/);
  assert.deepEqual(h.counts(), { writes: 2, refreshes: 2, taps: 2 });
  h.scope.stop();
});

test('identity change suppresses stale rollback and stale completion cannot unlock a newer command', async () => {
  const oldRequest = deferred();
  const newRequest = deferred();
  let calls = 0;
  const h = harness({
    batchOn: () => oldRequest.promise,
    batchOff: () => { calls += 1; return newRequest.promise; },
  });

  const oldCommand = h.controls.turnOn();
  assert.equal(h.rows.value[0].state.on, true);
  h.identity.invalidate();
  h.rows.value = [indoor(1, { on: true })];
  const newCommand = h.controls.turnOff();
  assert.equal(calls, 1);
  assert.equal(h.controls.busy.value, true);

  oldRequest.reject(new Error('旧服务器失败'));
  assert.equal(await oldCommand, false);
  assert.equal(h.controls.busy.value, true);
  assert.equal(h.errors.length, 0);
  assert.equal(h.rows.value[0].state.on, false);

  newRequest.resolve(result());
  assert.equal(await newCommand, true);
  assert.equal(h.controls.busy.value, false);
  assert.deepEqual(h.counts(), { writes: 2, refreshes: 1, taps: 2 });
  h.scope.stop();
});

test('floor confirmation holds the global lock and aborts when the visible floor changes', async () => {
  const confirmation = deferred();
  let sends = 0;
  const h = harness({ batchOn: async () => { sends += 1; return result(2); } }, {
    floor: '1F',
    confirm: () => confirmation.promise,
    selected: [1],
    rows: [indoor(1), indoor(2), indoor(3)],
  });

  const floorCommand = h.controls.floorPower(true);
  assert.equal(h.controls.busy.value, true);
  assert.equal(await h.controls.turnOn(), false);
  h.setFloor('2F');
  confirmation.resolve();

  assert.equal(await floorCommand, false);
  assert.equal(sends, 0);
  assert.equal(h.controls.busy.value, false);
  assert.deepEqual(h.counts(), { writes: 0, refreshes: 0, taps: 0 });
  h.scope.stop();
});

test('changing floor after dispatch does not suppress the command failure rollback', async () => {
  const pending = deferred();
  const h = harness({ batchOn: () => pending.promise }, {
    floor: '1F',
    rows: [indoor(1), indoor(2), indoor(3)],
  });

  const command = h.controls.floorPower(true);
  await settle();
  assert.deepEqual(h.rows.value.map((row) => row.state.on), [true, true, false]);
  h.setFloor('2F');
  pending.reject(new Error('总线占用'));

  assert.equal(await command, false);
  assert.deepEqual(h.rows.value.map((row) => row.state.on), [false, false, false]);
  assert.match(h.errors[0], /全开 失败: 总线占用/);
  assert.deepEqual(h.counts(), { writes: 1, refreshes: 1, taps: 1 });
  h.scope.stop();
});

test('page deactivation invalidates an in-flight command without scheduling a stale readback', async () => {
  const pending = deferred();
  const h = harness({ batchOn: () => pending.promise });
  const command = h.controls.turnOn();
  h.controls.stopControls();
  assert.equal(h.controls.busy.value, false);
  pending.resolve(result());
  assert.equal(await command, false);
  assert.deepEqual(h.counts(), { writes: 1, refreshes: 0, taps: 1 });
  h.scope.stop();
});

test('HvacPage delegates every batch control path to the shared control boundary', () => {
  assert.match(page, /useHvacControls\(\{/);
  assert.doesNotMatch(page, /async function run\(/);
  assert.doesNotMatch(page, /async function zoneRun\(/);
  assert.doesNotMatch(page, /hvacService\.batch(On|Off|Temperature|Mode|FanSpeed)/);
  assert.match(page, /isBusy: \(\) => busy\.value/);
  assert.equal((page.match(/:disabled="busy"/g) || []).length >= 8, true);
  assert.match(source, /captureIdentityGuard/);
  assert.match(source, /onIdentityChange\(stopControls\)/);
});
