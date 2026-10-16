const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function execute(source, customRequire) {
  const module = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module,
    exports: module.exports,
    require: customRequire,
    Promise,
    JSON,
  });
  return module.exports;
}

const composableSource = fs.readFileSync(
  path.resolve(__dirname, '../src/composables/usePlayerPowerControls.ts'),
  'utf8',
);
const playerConsoleSource = fs.readFileSync(
  path.resolve(__dirname, '../src/components/PlayerConsole.vue'),
  'utf8',
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function circuit(id, code, name, on = false, category = 'display') {
  return { id, code, name, category, reading: { on } };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function moduleWith(service, messages = [], confirm = async () => undefined) {
  return execute(composableSource, (id) => {
    if (id === 'vue') return vue;
    if (id === 'element-plus') {
      return {
        ElMessage: {
          success: (message) => messages.push(['success', message]),
          error: (message) => messages.push(['error', message]),
        },
        ElMessageBox: { confirm },
      };
    }
    if (id === '@/services/power-circuits.service') return { powerCircuitsService: service };
    throw new Error(`unexpected import: ${id}`);
  });
}

function harness(overrides = {}) {
  const calls = [];
  const messages = [];
  const code = vue.ref('screen,amp');
  const groups = vue.ref([]);
  let current = true;
  const available = overrides.available ?? [
    circuit(1, 'screen', '大屏总闸'),
    circuit(2, 'amp', '大屏功放'),
  ];
  const service = {
    list: overrides.list ?? (async () => { calls.push(['list']); return available; }),
    on: overrides.on ?? (async (id) => {
      calls.push(['on', id]);
      const target = available.find((item) => item.id === id);
      return { ...target, reading: { ...target.reading, on: true } };
    }),
    off: overrides.off ?? (async (id) => {
      calls.push(['off', id]);
      const target = available.find((item) => item.id === id);
      return { ...target, reading: { ...target.reading, on: false } };
    }),
  };
  const exports = moduleWith(
    service,
    messages,
    overrides.confirm ?? (async () => undefined),
  );
  const scope = vue.effectScope();
  const state = scope.run(() => exports.usePlayerPowerControls({
    title: () => 'LED 大屏',
    powerCode: () => code.value,
    powerNameGroups: () => groups.value,
    captureAction: () => () => current,
  }));
  return {
    calls,
    messages,
    code,
    groups,
    scope,
    state,
    setCurrent(value) { current = value; },
  };
}

test('configured circuits keep code order, append named sequencer matches and de-duplicate ids', () => {
  const service = { list() {}, on() {}, off() {} };
  const { resolvePlayerPowerCircuits } = moduleWith(service);
  const circuits = [
    circuit(3, 'other', '投影仪功放 A', false, 'audio-seq'),
    circuit(1, 'screen', '大屏总闸'),
    circuit(2, 'amp', '大屏功放', false, 'audio-seq'),
    circuit(4, 'wrong', '投影仪功放 B', false, 'display'),
  ];

  const result = resolvePlayerPowerCircuits(
    circuits,
    ' amp, screen, amp ',
    [['投影仪', '功放']],
  );
  assert.deepEqual(Array.from(result, (item) => item.id), [2, 1, 3]);
});

test('initial load projects authoritative circuit state and all-on requires every circuit', async () => {
  const h = harness({
    available: [circuit(1, 'screen', '大屏总闸', true), circuit(2, 'amp', '大屏功放', false)],
  });
  await flush();

  assert.deepEqual(Array.from(h.state.powerCircuits.value, (item) => item.id), [1, 2]);
  assert.equal(h.state.powerAllOn.value, false);
  h.state.powerCircuits.value[1] = circuit(2, 'amp', '大屏功放', true);
  assert.equal(h.state.powerAllOn.value, true);
  h.scope.stop();
});

test('the latest configured group wins when an older directory request finishes last', async () => {
  const first = deferred();
  const second = deferred();
  let reads = 0;
  const h = harness({ list: () => (++reads === 1 ? first.promise : second.promise) });
  h.code.value = 'projector';
  second.resolve([circuit(3, 'projector', '投影仪')]);
  await flush();
  first.resolve([circuit(1, 'screen', '大屏总闸')]);
  await flush();

  assert.deepEqual(Array.from(h.state.powerCircuits.value, (item) => item.id), [3]);
  h.scope.stop();
});

test('power-on commands stay serial and update each response by circuit id', async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const h = harness({
    on: (id) => {
      calls.push(id);
      return id === 1 ? first.promise : second.promise;
    },
  });
  await flush();
  const toggling = h.state.togglePower();
  assert.deepEqual(calls, [1]);
  first.resolve(circuit(1, 'screen', '大屏总闸', true));
  await flush();
  assert.deepEqual(calls, [1, 2]);
  second.resolve(circuit(2, 'amp', '大屏功放', true));
  await toggling;

  assert.equal(h.state.powerAllOn.value, true);
  assert.equal(h.messages.at(-1)[0], 'success');
  h.scope.stop();
});

test('a group change while the power-off confirmation is open cancels the old action', async () => {
  const confirming = deferred();
  const h = harness({
    available: [circuit(1, 'screen', '大屏总闸', true), circuit(2, 'amp', '大屏功放', true)],
    confirm: () => confirming.promise,
  });
  await flush();
  const toggling = h.state.togglePower();
  h.code.value = 'projector';
  confirming.resolve();
  await toggling;
  await flush();

  assert.equal(h.calls.some(([name]) => name === 'off'), false);
  assert.equal(h.messages.length, 0);
  h.scope.stop();
});

test('a failed circuit does not skip later serial commands and reports a partial failure', async () => {
  const h = harness({
    on: async (id) => {
      h.calls.push(['on', id]);
      if (id === 1) throw new Error('gateway unavailable');
      return circuit(2, 'amp', '大屏功放', true);
    },
  });
  await flush();
  await h.state.togglePower();

  assert.deepEqual(h.calls.filter(([name]) => name === 'on'), [['on', 1], ['on', 2]]);
  assert.equal(h.state.powerCircuits.value[0].reading.on, false);
  assert.equal(h.state.powerCircuits.value[1].reading.on, true);
  assert.equal(h.messages.at(-1)[0], 'error');
  assert.match(h.messages.at(-1)[1], /大屏总闸: gateway unavailable/);
  h.scope.stop();
});

test('identity invalidation stops the remaining hardware sequence and suppresses stale messages', async () => {
  const first = deferred();
  const calls = [];
  const h = harness({
    on: (id) => { calls.push(id); return first.promise; },
  });
  await flush();
  const toggling = h.state.togglePower();
  h.setCurrent(false);
  first.resolve(circuit(1, 'screen', '大屏总闸', true));
  await toggling;

  assert.deepEqual(calls, [1]);
  assert.equal(h.messages.length, 0);
  assert.equal(h.state.powerBusy.value, false);
  h.scope.stop();
});

test('scope disposal suppresses a late directory response and clears visible power state', async () => {
  const listing = deferred();
  const h = harness({ list: () => listing.promise });
  h.scope.stop();
  listing.resolve([circuit(1, 'screen', '大屏总闸')]);
  await flush();

  assert.equal(h.state.powerCircuits.value.length, 0);
  assert.equal(h.state.powerBusy.value, false);
});

test('PlayerConsole delegates display power orchestration to the dedicated composable', () => {
  assert.match(playerConsoleSource, /usePlayerPowerControls\(\{/);
  assert.doesNotMatch(playerConsoleSource, /powerCircuitsService|PowerCircuitView/);
  assert.doesNotMatch(playerConsoleSource, /async function togglePower|async function loadPowerCircuit/);
  assert.match(composableSource, /for \(const target of targets\)/);
  assert.match(composableSource, /circuit\.id === target\.id/);
  // 欢迎编辑器新增场馆/落款四条同构输入(v-for)、“主标题效果”选择器, 以及
  // 2026-10-09 主标题/嘉宾行字号控件 (字号 number 框内联在对应文字框同一行右侧,
  // 清洗逻辑 setWelcomeSize 下沉在 useWelcomeEditor, 不再单独起标签行/子组件)。
  // 业务逻辑仍全部下沉在 useWelcomeEditor/usePlayerPowerControls 等 composable,
  // 这里只放宽模板行数预算, 下方“不得内联电源逻辑”的断言保持不变。
  // 2026-10-16 #67：新增整台播控只读 gate（import permission store + 一个只读
  // class/chip，共约 2 行），未内联任何电源逻辑，预算相应放宽。
  assert.ok(playerConsoleSource.split('\n').length < 1422);
});
