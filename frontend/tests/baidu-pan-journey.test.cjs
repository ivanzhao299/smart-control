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

function execute(source, customRequire, context = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module,
    exports: module.exports,
    require: customRequire,
    Promise,
    ...context,
  });
  return module.exports;
}

const composableSource = fs.readFileSync(
  path.resolve(__dirname, '../src/composables/useBaiduPanJourney.ts'),
  'utf8',
);
const mediaPage = fs.readFileSync(path.resolve(__dirname, '../src/pages/MediaPage.vue'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function status(overrides = {}) {
  return {
    configured: true,
    authorized: true,
    rootPath: '/展厅素材',
    download: { active: null, last: null },
    ...overrides,
  };
}

function entry(name, fsId = 1) {
  return {
    fsId,
    path: `/展厅素材/${name}`,
    name,
    isDir: false,
    sizeBytes: 1024,
    category: 1,
    downloaded: false,
    ingestible: true,
  };
}

function harness(overrides = {}) {
  const calls = [];
  const messages = [];
  const timers = new Map();
  let timerId = 0;
  let disposed = false;
  class HttpError extends Error {
    constructor(message, httpStatus) {
      super(message);
      this.status = httpStatus;
    }
  }
  const defaultStatus = status();
  const service = {
    status: overrides.status ?? (async () => defaultStatus),
    saveConfig: overrides.saveConfig ?? (async (...args) => { calls.push(['saveConfig', ...args]); }),
    authStart: overrides.authStart ?? (async () => ({
      userCode: 'ABCD', verificationUrl: 'https://example.test', qrcodeUrl: null, expiresIn: 60, interval: 2,
    })),
    authPoll: overrides.authPoll ?? (async () => ({ authorized: false, pending: 'pending' })),
    list: overrides.list ?? (async (dir) => ({ dir, entries: [entry('default.mp4')], rootPath: '/展厅素材' })),
    setRoot: overrides.setRoot ?? (async (...args) => { calls.push(['setRoot', ...args]); }),
    download: overrides.download ?? (async (...args) => { calls.push(['download', ...args]); return { started: true }; }),
  };
  const fakeWindow = {
    setTimeout: (callback, ms) => {
      const id = ++timerId;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); },
  };
  const useBaiduPanJourney = execute(composableSource, (id) => {
    if (id === 'vue') return vue;
    if (id === 'element-plus') {
      return {
        ElMessage: {
          success: (message) => messages.push(['success', message]),
          warning: (message) => messages.push(['warning', message]),
          error: (message) => messages.push(['error', message]),
        },
        ElMessageBox: {
          prompt: overrides.prompt ?? (async () => ({ value: '/新目录' })),
        },
      };
    }
    if (id === '@/services/baidu-pan.service') return { baiduPanService: service };
    if (id === '@/services/http') return { HttpError };
    if (id === '@/stores/admin-auth') {
      return {
        useAdminAuthStore: () => ({
          login: overrides.login ?? (async (...args) => { calls.push(['login', ...args]); }),
        }),
      };
    }
    throw new Error(`unexpected import: ${id}`);
  }, { window: fakeWindow }).useBaiduPanJourney;
  const isAdmin = vue.ref(overrides.isAdmin ?? true);
  const scope = vue.effectScope();
  const state = scope.run(() => useBaiduPanJourney({
    isAdmin,
    refreshMedia: async () => { calls.push(['refreshMedia']); },
    isDisposed: () => disposed,
  }));
  return {
    state,
    scope,
    calls,
    messages,
    timers,
    service,
    HttpError,
    isAdmin,
    setDisposed: (value) => { disposed = value; },
  };
}

test('admin challenge resumes the authorized directory journey with cleared credentials', async () => {
  let statusCalls = 0;
  let h;
  h = harness({
    status: async () => {
      statusCalls += 1;
      if (statusCalls === 1) throw new h.HttpError('forbidden', 403);
      return status();
    },
    list: async (dir) => {
      h.calls.push(['list', dir]);
      return { dir, entries: [entry('welcome.mp4')], rootPath: '/展厅素材' };
    },
  });
  await h.state.openPanDialog();
  assert.equal(h.state.panNeedAdmin.value, true);
  assert.equal(h.state.panErr.value, '');

  h.state.panAdminUsername.value = 'owner';
  h.state.panAdminPwd.value = 'secret';
  await h.state.panVerifyAdmin();

  assert.deepEqual(h.calls, [
    ['login', 'owner', 'secret'],
    ['list', '/'],
  ]);
  assert.equal(h.state.panNeedAdmin.value, false);
  assert.equal(h.state.panAdminUsername.value, '');
  assert.equal(h.state.panAdminPwd.value, '');
  assert.equal(h.state.panEntries.value[0].name, 'welcome.mp4');
  h.scope.stop();
});

test('closing the dialog suppresses stale status and clears its poll timer', async () => {
  const pending = deferred();
  const h = harness({ status: () => pending.promise });
  const opening = h.state.openPanDialog();
  h.state.closePanDialog();
  pending.resolve(status());
  await opening;

  assert.equal(h.state.panDialog.value, false);
  assert.equal(h.state.panStatus.value, null);
  assert.equal(h.timers.size, 0);
  h.scope.stop();
});

test('newer directory navigation wins when an older request finishes last', async () => {
  const slow = deferred();
  const fast = deferred();
  const h = harness({
    list: async (dir) => {
      if (dir === '/slow') return slow.promise;
      if (dir === '/fast') return fast.promise;
      return { dir, entries: [], rootPath: '/展厅素材' };
    },
  });
  await h.state.openPanDialog();
  const older = h.state.panList('/slow');
  const newer = h.state.panList('/fast');
  fast.resolve({ dir: '/fast', entries: [entry('new.mp4', 2)], rootPath: '/展厅素材' });
  await newer;
  slow.resolve({ dir: '/slow', entries: [entry('old.mp4', 3)], rootPath: '/展厅素材' });
  await older;

  assert.equal(h.state.panDir.value, '/fast');
  assert.equal(h.state.panEntries.value[0].name, 'new.mp4');
  assert.equal(h.state.panLoading.value, false);
  h.scope.stop();
});

test('device authorization completion refreshes status and opens the root listing', async () => {
  let statusCalls = 0;
  const h = harness({
    status: async () => {
      statusCalls += 1;
      return status({ authorized: statusCalls > 1 });
    },
    authPoll: async () => ({ authorized: true, pending: null }),
  });
  await h.state.openPanDialog();
  await h.state.panStartAuth();
  await h.state.pollPanState();

  assert.equal(h.state.panAuth.value, null);
  assert.equal(h.state.panStatus.value.authorized, true);
  assert.equal(h.state.panDir.value, '/');
  assert.deepEqual(h.messages, [['success', '百度网盘授权成功']]);
  h.scope.stop();
});

test('a newly completed download refreshes both the media library and current folder', async () => {
  let statusCalls = 0;
  const active = { name: 'film.mp4', receivedBytes: 10, totalBytes: 100, startedAt: 1 };
  const h = harness({
    status: async () => {
      statusCalls += 1;
      if (statusCalls === 1) return status({ download: { active, last: { ok: true, name: 'old.mp4', message: '完成', at: 1 } } });
      return status({ download: { active: null, last: { ok: true, name: 'film.mp4', message: '已入库', at: 2 } } });
    },
    list: async (dir) => {
      h.calls.push(['list', dir]);
      return { dir, entries: [], rootPath: '/展厅素材' };
    },
  });
  await h.state.openPanDialog();
  await h.state.pollPanState();

  assert.deepEqual(h.calls, [
    ['list', '/'],
    ['refreshMedia'],
    ['list', '/'],
  ]);
  assert.deepEqual(h.messages, [['success', '「film.mp4」已入库']]);
  h.scope.stop();
});

test('saving trimmed application credentials clears the secret form after confirmation', async () => {
  const h = harness({
    status: async () => status({ configured: false, authorized: false }),
  });
  await h.state.openPanDialog();
  h.state.panCfg.value = { appKey: '  public-key  ', secretKey: '  private-key  ' };
  await h.state.panSaveConfig();

  assert.deepEqual(h.calls, [['saveConfig', 'public-key', 'private-key']]);
  assert.equal(h.state.panCfg.value.appKey, '');
  assert.equal(h.state.panCfg.value.secretKey, '');
  assert.deepEqual(h.messages, [['success', '已保存, 点「开始授权」用手机完成授权']]);
  h.scope.stop();
});

test('losing administrator permission while the root prompt is open prevents the write', async () => {
  const prompt = deferred();
  const h = harness({ prompt: () => prompt.promise });
  await h.state.openPanDialog();
  const changing = h.state.panSetRoot();
  h.isAdmin.value = false;
  prompt.resolve({ value: '/不应提交' });
  await changing;

  assert.equal(h.calls.some(([name]) => name === 'setRoot'), false);
  assert.deepEqual(h.messages, []);
  h.scope.stop();
});

test('MediaPage delegates the complete Baidu Pan lifecycle to one composable', () => {
  assert.match(mediaPage, /useBaiduPanJourney\(\{/);
  assert.doesNotMatch(mediaPage, /baiduPanService\./);
  assert.doesNotMatch(mediaPage, /async function refreshPanStatus/);
  assert.doesNotMatch(mediaPage, /function schedulePanPoll/);
  assert.doesNotMatch(mediaPage, /async function panVerifyAdmin/);
  assert.match(composableSource, /requestRevision !== listRevision/);
  assert.match(composableSource, /onScopeDispose\(\(\) =>/);
});
