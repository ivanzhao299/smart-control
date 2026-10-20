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
  const ampCodes = vue.ref(undefined);
  const keepPeers = vue.ref(undefined);
  let current = true;
  const available = overrides.available ?? [
    circuit(1, 'screen', '大屏总闸'),
    circuit(2, 'amp', '大屏功放'),
  ];
  const service = {
    list: overrides.list ?? (async () => { calls.push(['list']); return available; }),
    listFresh: overrides.listFresh ?? (async () => available),
    switchOnByCode: overrides.switchOnByCode ?? (async (code) => {
      const t = available.find((x) => x.code === code);
      if (!t) throw new Error('not found');
      return t.reading.on;
    }),
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
    powerAmpCodes: () => ampCodes.value,
    powerKeepPeers: () => keepPeers.value,
    captureAction: () => () => current,
  }));
  return {
    calls,
    messages,
    code,
    groups,
    ampCodes,
    keepPeers,
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

test('explicit amp codes bind by code and skip name matching even with duplicate names', () => {
  const service = { list() {}, on() {}, off() {} };
  const { resolvePlayerPowerCircuits } = moduleWith(service);
  const circuits = [
    circuit(7, 'seq-1', '投影功放', false, 'audio-seq'),
    circuit(11, 'seq-5', '投影仪开关', false, 'display'),
    circuit(10, 'seq-4', '音频矩阵主机', false, 'display'),
    circuit(31, 'seq55-8', '投影功放', false, 'audio-seq'),
  ];

  const result = resolvePlayerPowerCircuits(
    circuits, 'seq-5,seq-4', [['功放', '投影']], ['seq55-8'],
  );
  assert.deepEqual(Array.from(result, (item) => item.id), [11, 10, 31]);
});

test('LED power-on also powers the audio matrix (seq-4) and the amp (seq-2)', () => {
  const service = { list() {}, on() {}, off() {} };
  const { resolvePlayerPowerCircuits } = moduleWith(service);
  const led = [
    circuit(4, '1f-led', '一层 LED 大屏', false, 'led'),
    circuit(10, 'seq-4', '音频矩阵主机', false, 'display'),
    circuit(8, 'seq-2', 'LED大屏功放', false, 'audio-seq'),
  ];
  const ledResult = resolvePlayerPowerCircuits(led, '1f-led,seq-4', [], ['seq-2']);
  assert.deepEqual(Array.from(ledResult, (item) => item.id), [4, 10, 8]);
});

test('projector amp binds to seq55-8 by code', () => {
  const service = { list() {}, on() {}, off() {} };
  const { resolvePlayerPowerCircuits } = moduleWith(service);
  const projector = [
    circuit(11, 'seq-5', '投影仪开关', false, 'display'),
    circuit(10, 'seq-4', '音频矩阵主机', false, 'display'),
    circuit(31, 'seq55-8', '投影功放', false, 'audio-seq'),
  ];
  const projectorResult = resolvePlayerPowerCircuits(
    projector, 'seq-5,seq-4', [], ['seq55-8'],
  );
  assert.deepEqual(Array.from(projectorResult, (item) => item.id), [11, 10, 31]);
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

test('power-off keeps the shared matrix while the other screen is still on', async () => {
  const offCalls = [];
  const available = [
    circuit(4, '1f-led', '一层 LED 大屏', true, 'led'),
    circuit(10, 'seq-4', '音频矩阵主机', true, 'display'),
    circuit(8, 'seq-2', 'LED大屏功放', true, 'audio-seq'),
    circuit(11, 'seq-5', '投影仪开关', true, 'display'), // peer: 投影也开着
  ];
  const h = harness({
    available,
    off: async (id) => {
      offCalls.push(id);
      const t = available.find((x) => x.id === id);
      return { ...t, reading: { on: false } };
    },
  });
  h.code.value = '1f-led,seq-4';
  h.ampCodes.value = ['seq-2'];
  h.keepPeers.value = [{ code: 'seq-4', peers: ['seq-5'] }];
  await flush();
  assert.equal(h.state.powerAllOn.value, true);

  await h.state.togglePower();

  // 大屏、功放断电；矩阵因投影仪(seq-5)仍通电而保留
  assert.deepEqual(offCalls, [4, 8]);
  const matrix = h.state.powerCircuits.value.find((c) => c.id === 10);
  assert.equal(matrix.reading.on, true);
  assert.equal(h.messages.at(-1)[0], 'success');
  assert.match(h.messages.at(-1)[1], /保持通电/);
  h.scope.stop();
});

test('power-off turns off the shared matrix once the other screen is already off', async () => {
  const offCalls = [];
  const available = [
    circuit(4, '1f-led', '一层 LED 大屏', true, 'led'),
    circuit(10, 'seq-4', '音频矩阵主机', true, 'display'),
    circuit(8, 'seq-2', 'LED大屏功放', true, 'audio-seq'),
    circuit(11, 'seq-5', '投影仪开关', false, 'display'), // peer: 投影已关
  ];
  const h = harness({
    available,
    off: async (id) => {
      offCalls.push(id);
      const t = available.find((x) => x.id === id);
      return { ...t, reading: { on: false } };
    },
  });
  h.code.value = '1f-led,seq-4';
  h.ampCodes.value = ['seq-2'];
  h.keepPeers.value = [{ code: 'seq-4', peers: ['seq-5'] }];
  await flush();

  await h.state.togglePower();

  assert.deepEqual(offCalls, [4, 10, 8]);
  assert.equal(h.messages.at(-1)[1], 'LED 大屏电源已断开');
  h.scope.stop();
});

test('power-off queries only the peer switch, never the full list', async () => {
  const switchCalls = [];
  const available = [
    circuit(4, '1f-led', '一层 LED 大屏', true, 'led'),
    circuit(10, 'seq-4', '音频矩阵主机', true, 'display'),
    circuit(8, 'seq-2', 'LED大屏功放', true, 'audio-seq'),
    circuit(11, 'seq-5', '投影仪开关', true, 'display'),
  ];
  const h = harness({
    available,
    switchOnByCode: async (code) => {
      switchCalls.push(code);
      return available.find((x) => x.code === code).reading.on;
    },
    listFresh: async () => { throw new Error('should not read the full list'); },
    off: async (id) => { const t = available.find((x) => x.id === id); return { ...t, reading: { on: false } }; },
  });
  h.code.value = '1f-led,seq-4';
  h.ampCodes.value = ['seq-2'];
  h.keepPeers.value = [{ code: 'seq-4', peers: ['seq-5'], peerLabel: '投影仪' }];
  await flush();

  await h.state.togglePower();

  assert.deepEqual(switchCalls, ['seq-5']); // 只回传一个开关位，不读全量
  h.scope.stop();
});

test('power-off keeps the shared matrix when the peer query fails', async () => {
  const offCalls = [];
  const available = [
    circuit(4, '1f-led', '一层 LED 大屏', true, 'led'),
    circuit(10, 'seq-4', '音频矩阵主机', true, 'display'),
    circuit(8, 'seq-2', 'LED大屏功放', true, 'audio-seq'),
  ];
  const h = harness({
    available,
    switchOnByCode: async () => { throw new Error('unreachable'); },
    off: async (id) => {
      offCalls.push(id);
      const t = available.find((x) => x.id === id);
      return { ...t, reading: { on: false } };
    },
  });
  h.code.value = '1f-led,seq-4';
  h.ampCodes.value = ['seq-2'];
  h.keepPeers.value = [{ code: 'seq-4', peers: ['seq-5'] }];
  await flush();

  await h.state.togglePower();

  assert.deepEqual(offCalls, [4, 8]); // 状态无法确认，矩阵保留
  const matrix = h.state.powerCircuits.value.find((c) => c.id === 10);
  assert.equal(matrix.reading.on, true);
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
  // 2026-10-17 手机端播放页 UI 优化：输入源统一下拉、进度条 seek、单次/循环、
  // 防长名换行与 ≤640px 紧凑样式；增量 118 行中 template/style 占 98 行，script
  // 仅 20 行纯 UI 事件聚合（路由回已有 handler），未内联电源逻辑，预算相应放宽。
  // 2026-10-18 #139：手机端 .led-head 锁死单行(nowrap+固定 36px)，根治切自定义欢迎方案
  // 只读 chip 闪现把电源块挤换行的整页跳动；纯 CSS、零 JS/模板逻辑，预算相应放宽。
  // 第三十轮 #30：新增 powerAmpCodes prop 及其注释（功放按 code 精确绑定），
  // 属 props 声明、业务逻辑仍在 composable，预算相应放宽到 1630。
  assert.ok(playerConsoleSource.split('\n').length < 1630);
});
