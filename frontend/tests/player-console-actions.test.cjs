const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vueRuntime = require('vue');

const playerConsole = fs.readFileSync(path.join(__dirname, '../src/components/PlayerConsole.vue'), 'utf8');
const welcomePhoto = fs.readFileSync(path.join(__dirname, '../src/composables/useWelcomePhoto.ts'), 'utf8');
const inputSourceText = fs.readFileSync(path.join(__dirname, '../src/features/player-input-source.ts'), 'utf8');
const inputSourcesComposableText = fs.readFileSync(
  path.join(__dirname, '../src/composables/usePlayerInputSources.ts'),
  'utf8',
);

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function executeModule(source, customRequire, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module,
    exports: module.exports,
    require: customRequire,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  return module.exports;
}

const inputSource = executeModule(inputSourceText, (id) => { throw new Error(`unexpected import: ${id}`); });

function createHarness(overrides = {}) {
  const calls = [];
  const messages = [];
  const timers = new Map();
  let timerId = 0;
  let intervalId = 0;
  let current = true;
  let displayResolver;
  const controlledDisplaySwitch = overrides.controlledDisplaySwitch ?? false;
  const parkState = overrides.parkState ?? { page: 2, autoPlay: false, totalPages: 6 };
  const welcomeSnapshot = overrides.welcomeSnapshot ?? {
    config: { schemes: [{ id: 'reception', name: '接待方案' }] },
    revision: 6,
    publishedSchemeId: 'reception',
  };
  const playbackServices = {
    publishWelcome: async (slot, variant) => { calls.push(['welcome', slot, variant]); },
    publishParkDashboard: async (slot) => { calls.push(['park-dashboard', slot]); },
  };
  const brandingServices = {
    fetchWelcomeSchemes: async () => { calls.push(['fetch-schemes']); return welcomeSnapshot; },
    publishWelcomeScheme: async (id, revision) => { calls.push(['publish-scheme', id, revision]); },
  };
  const parkServices = {
    state: async () => { calls.push(['park-state']); return parkState; },
    next: async () => { calls.push(['park-next']); return parkState; },
    prev: async () => { calls.push(['park-prev']); return parkState; },
    setAuto: async (value) => { calls.push(['park-auto', value]); return { ...parkState, autoPlay: value }; },
    refresh: async () => { calls.push(['park-refresh']); return parkState; },
    claim: async (ownerName) => { calls.push(['park-claim', ownerName]);
      return { ...parkState, claimed: true, claim: { ownerId: 'owner-test-1', ownerName: ownerName ?? 'tester', remainingMs: 90000 } }; },
    release: async () => { calls.push(['park-release']); return { ...parkState, claimed: false, claim: null }; },
  };
  Object.assign(playbackServices, overrides.playbackServices);
  Object.assign(brandingServices, overrides.brandingServices);
  Object.assign(parkServices, overrides.parkServices);

  const usePlayerInputSources = executeModule(
    inputSourcesComposableText,
    (id) => {
      if (id === 'vue') return vueRuntime;
      if (id === 'element-plus') {
        return {
          ElMessage: {
            info: (message) => messages.push(['info', message]),
            success: (message) => messages.push(['success', message]),
            warning: (message) => messages.push(['warning', message]),
            error: (message) => messages.push(['error', message]),
          },
        };
      }
      if (id === '@/services/projector.service') {
        return { projectorService: { showHdmi: async () => { calls.push(['projector-hdmi']); } } };
      }
      if (id === '@/services/led.service') {
        return {
          ledService: {
            switchInput: async (...args) => {
              calls.push(['led-input', ...args]);
              if (controlledDisplaySwitch) await new Promise((resolve) => { displayResolver = resolve; });
              if (overrides.ledError) throw overrides.ledError;
              return overrides.ledResult ?? { ok: true };
            },
          },
        };
      }
      if (id === '@/services/playback.service') return playbackServices;
      if (id === '@/services/system-branding.service') return brandingServices;
      if (id === '@/services/park-ops-control.service') {
        return { parkOpsControlService: parkServices, getParkOpsOwnerId: () => 'owner-test-1' };
      }
      if (id === '@/services/current-actor') {
        return { useCurrentActor: () => ({ actor: vueRuntime.ref({ kind: 'admin', userId: 1, username: 'tester', role: 'admin' }) }) };
      }
      if (id === '@/features/player-input-source') return inputSource;
      throw new Error(`unexpected import: ${id}`);
    },
    {
      window: { setInterval: () => ++intervalId, clearInterval: () => {} },
      setTimeout: (callback, delay) => {
        const id = ++timerId;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => { timers.delete(id); },
    },
  ).usePlayerInputSources;

  const slot = vueRuntime.ref(overrides.slot ?? 1);
  const channel = vueRuntime.ref(overrides.channel ?? {
    currentMediaId: 10,
    currentMediaName: inputSource.WELCOME_DEFAULT_NAMES[0],
  });
  const activeSource = vueRuntime.computed(() => inputSource.detectPlayerInputSource(channel.value));
  const playlist = vueRuntime.ref(overrides.playlist ?? [{ id: 1, mediaId: 20 }]);
  const busy = vueRuntime.ref(false);
  const welcomeSchemes = vueRuntime.ref([{ id: 'reception', name: '接待方案' }]);
  const welcomeSchemesRevision = vueRuntime.ref(5);
  const publishedWelcomeSchemeId = vueRuntime.ref('reception');
  const scope = vueRuntime.effectScope();
  const state = scope.run(() => usePlayerInputSources({
    slot,
    title: () => 'LED 大屏',
    deviceId: () => overrides.deviceId ?? 'LED-NOVA-1',
    activeSource,
    playlist,
    busy,
    welcomeSchemes,
    welcomeSchemesRevision,
    publishedWelcomeSchemeId,
    ensureAdmin: async (action) => { calls.push(['admin', action]); return overrides.adminAllowed ?? true; },
    captureAction: () => () => current,
    nextPlayback: async (targetSlot) => { calls.push(['next', targetSlot]); },
    reloadLists: async () => { calls.push(['reload']); },
  }));

  return {
    state,
    scope,
    calls,
    messages,
    timers,
    busy,
    welcomeSchemesRevision,
    publishedWelcomeSchemeId,
    setCurrent: (value) => { current = value; },
    finishDisplaySwitch: () => displayResolver?.(),
  };
}

test('input source identity and welcome picker are pure projections of authoritative playback state', () => {
  assert.equal(inputSource.detectPlayerInputSource(null), null);
  assert.equal(inputSource.detectPlayerInputSource({ currentMediaId: 1, currentMediaName: inputSource.PARK_DASHBOARD_NAME }), 'park-dashboard');
  assert.equal(inputSource.detectPlayerInputSource({ currentMediaId: 1, currentMediaName: inputSource.WELCOME_EDITABLE_NAME }), 'welcome-editable');
  assert.equal(inputSource.detectPlayerInputSource({ currentMediaId: 1, currentMediaName: inputSource.WELCOME_DEFAULT_NAMES[0] }), 'welcome-default');
  assert.equal(inputSource.detectPlayerInputSource({ currentMediaId: 1, currentMediaName: '会议视频.mp4' }), 'content');
  assert.equal(inputSource.welcomePickerValue('welcome-default', 'reception'), inputSource.WELCOME_PICK_DEFAULT);
  assert.equal(inputSource.welcomePickerValue('welcome-editable', 'reception'), 'reception');
  assert.equal(inputSource.welcomePickerValue('content', 'reception'), '');
});

for (const action of ['selectContent', 'selectWelcome', 'selectParkDashboard']) {
  test(`${action} does not publish after identity or scope changes during display switching`, async () => {
    const stale = createHarness({ controlledDisplaySwitch: true });
    const pending = action === 'selectWelcome'
      ? stale.state[action]('default')
      : stale.state[action]();
    stale.setCurrent(false);
    stale.finishDisplaySwitch();
    await pending;
    assert.deepEqual(stale.calls, [['led-input', 'LED-NOVA-1', 'video']]);
    assert.deepEqual(stale.messages, []);
    assert.equal(stale.busy.value, false);
    stale.scope.stop();

    const current = createHarness();
    await (action === 'selectWelcome'
      ? current.state[action]('default')
      : current.state[action]());
    const expected = action === 'selectContent'
      ? ['next', 1]
      : action === 'selectWelcome'
        ? ['welcome', 1, 'default']
        : ['park-dashboard', 1];
    assert.deepEqual(current.calls[1], expected);
    assert.equal(current.messages.at(-1)[0], 'success');
    current.scope.stop();
  });
}

test('saved welcome scheme publishing carries the current revision and reloads authoritative state', async () => {
  const h = createHarness();
  const select = { value: 'reception' };
  await h.state.onWelcomeSchemePick({ target: select });
  assert.deepEqual(h.calls.slice(0, 4), [
    ['admin', '投放欢迎方案'],
    ['publish-scheme', 'reception', 5],
    ['fetch-schemes'],
    ['led-input', 'LED-NOVA-1', 'video'],
  ]);
  assert.deepEqual(h.calls[4], ['welcome', 1, 'editable']);
  assert.equal(h.welcomeSchemesRevision.value, 6);
  assert.equal(h.publishedWelcomeSchemeId.value, 'reception');
  assert.deepEqual(h.calls.at(-1), ['reload']);
  h.scope.stop();
});

test('an unconfirmed display-path switch warns but does not block a requested publication', async () => {
  const h = createHarness({ ledResult: { ok: false, error: '控制器离线' } });
  await h.state.selectWelcome('default');
  assert.deepEqual(h.calls, [
    ['led-input', 'LED-NOVA-1', 'video'],
    ['welcome', 1, 'default'],
  ]);
  assert.deepEqual(h.messages, [
    ['warning', '显示链路切换未确认: 控制器离线'],
    ['success', '已投放默认欢迎页'],
  ]);
  h.scope.stop();
});

test('projector publications restore the HDMI path without sending an LED command', async () => {
  const h = createHarness({ slot: 2 });
  await h.state.selectParkDashboard();
  assert.deepEqual(h.calls.slice(0, 2), [
    ['projector-hdmi'],
    ['park-dashboard', 2],
  ]);
  h.scope.stop();
});

test('welcome revision conflicts refresh authority and roll the selector back', async () => {
  const h = createHarness({
    brandingServices: {
      publishWelcomeScheme: async () => { throw new Error('revision conflict'); },
    },
  });
  const select = { value: 'reception' };
  await h.state.onWelcomeSchemePick({ target: select });
  assert.equal(select.value, inputSource.WELCOME_PICK_DEFAULT);
  assert.equal(h.calls.filter(([name]) => name === 'fetch-schemes').length, 1);
  assert.equal(h.calls.some(([name]) => name === 'welcome'), false);
  assert.deepEqual(h.messages.at(-1), ['error', '欢迎方案刚被其它终端修改，已刷新，请重新选择']);
  h.scope.stop();
});

test('park dashboard commands update server-confirmed state and refresh cooldown is disposable', async () => {
  const h = createHarness();
  await h.state.parkOpsControl('next');
  assert.deepEqual(h.calls.at(-1), ['park-next']);
  assert.equal(h.state.parkOpsPage.value, 2);
  assert.equal(h.state.parkOpsTotalPages.value, 6);
  assert.deepEqual(h.messages.at(-1), ['success', '已切到下一页']);

  await h.state.parkOpsControl('auto');
  assert.deepEqual(h.calls.at(-1), ['park-auto', true]);
  assert.equal(h.state.parkOpsAuto.value, true);

  await h.state.parkOpsControl('refresh');
  assert.equal(h.state.parkOpsBusy.value, true);
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 3000);
  timer.callback();
  assert.equal(h.state.parkOpsBusy.value, false);

  await h.state.parkOpsControl('refresh');
  assert.equal(h.timers.size, 2);
  h.scope.stop();
  assert.equal(h.timers.size, 1);
});

test('PlayerConsole delegates input-source orchestration and park mutations use the shared client', () => {
  assert.match(playerConsole, /usePlayerInputSources\(\{/);
  assert.match(playerConsole, /@click="selectParkDashboard"/);
  assert.match(playerConsole, /> 园区运营大屏<\/button>/);
  assert.match(playerConsole, /activeSource === 'park-dashboard'/);
  assert.doesNotMatch(playerConsole, /async function ensureDisplayPath/);
  assert.doesNotMatch(playerConsole, /parkOpsControlService\./);
  assert.match(inputSourcesComposableText, /parkOpsControlService\.(next|prev|setAuto|refresh)/);
  assert.doesNotMatch(inputSourcesComposableText, /fetch\(['"`]\/api\/park-ops-control/);
  assert.match(welcomePhoto, /parkOpsControlService\.goto\(0\)/);
  assert.doesNotMatch(welcomePhoto, /fetch\(['"`]\/api\/park-ops-control/);
});
