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
  });
  return module.exports;
}

const composableSource = fs.readFileSync(
  path.resolve(__dirname, '../src/composables/usePlayerDocumentControls.ts'),
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

function channel(overrides = {}) {
  return {
    currentMediaId: 10,
    currentMediaKind: 'doc',
    playbackSession: 'session-1',
    docPage: 2,
    docZoom: 100,
    currentMediaPageCount: 8,
    ...overrides,
  };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function harness(overrides = {}) {
  const calls = [];
  const messages = [];
  const slot = vue.ref(1);
  const currentChannel = vue.ref(channel());
  let identityCurrent = true;

  const playbackStore = {
    handleWs: (...args) => calls.push(['handleWs', ...args]),
  };
  const playbackService = {
    setDocPage: overrides.setDocPage ?? (async (...args) => {
      calls.push(['setDocPage', ...args]);
      return channel({ docPage: args[1], playbackSession: args[2] });
    }),
    setDocZoom: overrides.setDocZoom ?? (async (...args) => {
      calls.push(['setDocZoom', ...args]);
      return channel({ docZoom: args[1], playbackSession: args[2] });
    }),
  };

  const usePlayerDocumentControls = execute(composableSource, (id) => {
    if (id === 'vue') return vue;
    if (id === 'element-plus') {
      return {
        ElMessage: {
          warning: (message) => messages.push(['warning', message]),
          error: (message) => messages.push(['error', message]),
        },
        ElMessageBox: {
          confirm: overrides.confirm ?? (async () => undefined),
        },
      };
    }
    if (id === '@/stores/playback') return { usePlaybackStore: () => playbackStore };
    if (id === '@/services/playback.service') return playbackService;
    throw new Error(`unexpected import: ${id}`);
  }).usePlayerDocumentControls;

  const scope = vue.effectScope();
  const state = scope.run(() => usePlayerDocumentControls({
    slot,
    title: () => 'LED 大屏',
    channel: currentChannel,
    captureAction: () => {
      const capturedSlot = slot.value;
      return () => identityCurrent && slot.value === capturedSlot;
    },
    stopPlayback: overrides.stopPlayback ?? (async (...args) => calls.push(['stopPlayback', ...args])),
  }));

  return {
    calls,
    messages,
    slot,
    channel: currentChannel,
    scope,
    state,
    setIdentityCurrent(value) { identityCurrent = value; },
  };
}

test('document presentation state follows the authoritative playback channel', () => {
  const h = harness();
  assert.equal(h.state.isDocPlaying.value, true);
  assert.equal(h.state.docPage.value, 2);
  assert.equal(h.state.docTotal.value, 8);
  assert.equal(h.state.docZoom.value, 100);

  h.channel.value = channel({ currentMediaKind: 'video', docPage: undefined, docZoom: undefined });
  assert.equal(h.state.isDocPlaying.value, false);
  assert.equal(h.state.docPage.value, 1);
  assert.equal(h.state.docZoom.value, 100);
  h.scope.stop();
});

test('page commands clamp to the document bounds and publish the authoritative response', async () => {
  const h = harness();
  await h.state.gotoDocPage(99);

  assert.deepEqual(h.calls[0], ['setDocPage', 1, 8, 'session-1']);
  assert.equal(h.calls[1][0], 'handleWs');
  assert.equal(h.calls[1][1].data.docPage, 8);
  assert.equal(h.state.pageBusy.value, false);
  h.scope.stop();
});

test('duplicate page commands are blocked while the active request is pending', async () => {
  const pending = deferred();
  let requestCount = 0;
  const h = harness({
    setDocPage: () => { requestCount += 1; return pending.promise; },
  });

  const first = h.state.gotoDocPage(3);
  await h.state.gotoDocPage(4);
  assert.equal(requestCount, 1);
  assert.equal(h.state.pageBusy.value, true);
  pending.resolve(channel({ docPage: 3 }));
  await first;
  h.scope.stop();
});

test('a late page response cannot overwrite another slot and does not block its controls', async () => {
  const oldRequest = deferred();
  const newRequest = deferred();
  const h = harness({
    setDocPage: (slot) => (slot === 1 ? oldRequest.promise : newRequest.promise),
  });

  const oldAction = h.state.gotoDocPage(3);
  h.slot.value = 2;
  h.channel.value = channel({ playbackSession: 'session-2', docPage: 1 });
  const newAction = h.state.gotoDocPage(4);
  assert.equal(h.state.pageBusy.value, true);

  oldRequest.resolve(channel({ docPage: 3, playbackSession: 'session-1' }));
  await oldAction;
  assert.equal(h.state.pageBusy.value, true);
  assert.equal(h.calls.some(([name]) => name === 'handleWs'), false);

  newRequest.resolve(channel({ docPage: 4, playbackSession: 'session-2' }));
  await newAction;
  assert.equal(h.state.pageBusy.value, false);
  assert.equal(h.calls.filter(([name]) => name === 'handleWs').length, 1);
  assert.equal(h.calls.at(-1)[1].data.docPage, 4);
  h.scope.stop();
});

test('a late zoom response cannot overwrite a newer playback session', async () => {
  const oldRequest = deferred();
  const newRequest = deferred();
  let requestCount = 0;
  const h = harness({
    setDocZoom: () => (++requestCount === 1 ? oldRequest.promise : newRequest.promise),
  });

  const oldAction = h.state.applyDocZoom(115);
  h.channel.value = channel({ playbackSession: 'session-2', docZoom: 100 });
  const newAction = h.state.applyDocZoom(130);

  oldRequest.resolve(channel({ docZoom: 115, playbackSession: 'session-1' }));
  await oldAction;
  assert.equal(h.state.zoomBusy.value, true);
  newRequest.resolve(channel({ docZoom: 130, playbackSession: 'session-2' }));
  await newAction;

  assert.equal(h.calls.filter(([name]) => name === 'handleWs').length, 1);
  assert.equal(h.calls.at(-1)[1].data.docZoom, 130);
  h.scope.stop();
});

test('commands without a playback session are rejected locally', async () => {
  const h = harness();
  h.channel.value = channel({ playbackSession: null });
  await h.state.gotoDocPage(3);
  await h.state.applyDocZoom(115);
  await h.state.exitDocShow();

  assert.equal(h.calls.length, 0);
  assert.equal(h.messages.length, 3);
  assert.ok(h.messages.every(([kind]) => kind === 'warning'));
  h.scope.stop();
});

test('exit confirmation stops only the session that is still current', async () => {
  const confirm = deferred();
  const h = harness({ confirm: () => confirm.promise });
  const exiting = h.state.exitDocShow();
  h.channel.value = channel({ playbackSession: 'session-2' });
  confirm.resolve();
  await exiting;
  assert.equal(h.calls.some(([name]) => name === 'stopPlayback'), false);

  await h.state.exitDocShow();
  assert.deepEqual(h.calls.at(-1), ['stopPlayback', 'session-2']);
  h.scope.stop();
});

test('scope disposal suppresses responses and errors from abandoned requests', async () => {
  const pending = deferred();
  const h = harness({ setDocPage: () => pending.promise });
  const request = h.state.gotoDocPage(3);
  h.scope.stop();
  pending.reject(new Error('late failure'));
  await request;
  await flush();

  assert.equal(h.calls.length, 0);
  assert.equal(h.messages.length, 0);
  assert.equal(h.state.pageBusy.value, false);
});

test('PlayerConsole delegates document controls to the dedicated composable', () => {
  assert.match(playerConsoleSource, /usePlayerDocumentControls\(\{/);
  assert.doesNotMatch(playerConsoleSource, /setDocPage|setDocZoom|identityGeneration/);
  assert.doesNotMatch(playerConsoleSource, /async function gotoDocPage|async function applyDocZoom/);
  assert.match(composableSource, /options\.channel\.value\?\.playbackSession === session/);
  assert.match(composableSource, /revision !== pageRevision/);
  // 2026-10-17 手机端播放页 UI 优化（输入源统一下拉/进度条 seek/单次循环/紧凑样式）：
  // 增量为 template/style 视图层 + 少量 UI 事件聚合，文档控制逻辑仍全部委托 composable，
  // 上方委托断言不变，仅放宽行数预算。
  // 第三十一轮：新增 powerBootPlan prop + 开机倒计时 UI（仅 props/模板/样式），
  // 文档控制仍全部委托 composable，预算相应放宽到 1640。
  assert.ok(playerConsoleSource.split('\n').length < 1640);
});
