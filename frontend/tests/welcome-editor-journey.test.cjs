const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

function loadComposable(runtime) {
  let source = fs.readFileSync(
    path.resolve(__dirname, '../src/composables/useWelcomeEditor.ts'),
    'utf8',
  );
  source = source.replace(
    "`${import.meta.env.DEV ? '/' : import.meta.env.BASE_URL}welcome/index.html?preview=1`",
    "'/welcome/index.html?preview=1'",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const customRequire = (id) => {
    if (id === 'vue') return vue;
    if (id === 'element-plus') {
      return {
        ElMessage: {
          info: (message) => runtime.messages.push(['info', message]),
          success: (message) => runtime.messages.push(['success', message]),
          warning: (message) => runtime.messages.push(['warning', message]),
          error: (message) => runtime.messages.push(['error', message]),
        },
        ElMessageBox: { confirm: async () => undefined },
      };
    }
    if (id === '@/services/system-branding.service') {
      return {
        DEFAULT_WELCOME_PRESENTATION: runtime.presentation,
        fetchWelcomeSchemes: runtime.fetch,
        saveWelcomeSchemes: runtime.save,
        publishWelcomeScheme: runtime.publish,
        removeWelcomeAsset: async () => { throw new Error('unexpected remove'); },
      };
    }
    if (id === '@/services/http') return { absUrl: (url) => url };
    if (id === '@/services/media.service') {
      return { mediaService: { list: async () => ({ items: [] }) } };
    }
    if (id === '@/features/welcome-image-assets') {
      return {
        classifyWelcomeImageAssets: () => ({ backgrounds: [], logos: [] }),
        addWelcomeImageAsset: (libraries) => libraries,
      };
    }
    if (id === '@/features/welcome-background-image') {
      return { normalizeWelcomeBackground: async () => { throw new Error('unexpected normalize'); } };
    }
    if (id === '@/features/welcome-scheme-draft') {
      return {
        chooseWelcomeLogo: (draft, mediaId) => ({ ...draft, welcomeLogoMediaId: mediaId }),
        chooseWelcomeBackground: (draft, mediaId) => ({ ...draft, welcomeBgMediaId: mediaId }),
        changeWelcomePresentation: (draft, key, value) => ({
          ...draft,
          presentation: { ...draft.presentation, [key]: value },
        }),
      };
    }
    throw new Error(`unexpected import: ${id}`);
  };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: customRequire,
    window: runtime.window,
    URL,
    File,
    Blob,
    fetch,
    document: {},
    IntersectionObserver: undefined,
    createImageBitmap: async () => { throw new Error('unexpected bitmap'); },
  });
  return module.exports.useWelcomeEditor;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function harness(overrides = {}) {
  const presentation = {
    layout: 'ceremony', tone: 'light', overlay: 'soft', contentPosition: 'center', logoSize: 'medium',
  };
  const scheme = {
    id: 'default', name: '默认接待', welcomeTitle: '热烈欢迎', welcomeGuest: '各位嘉宾',
    welcomeTagline: '欢迎莅临', welcomeBgMediaId: null, welcomeLogoMediaId: null,
    presentation: clone(presentation),
  };
  let authoritative = {
    config: { version: 2, schemes: [scheme] },
    revision: 5,
    checksum: 'r5',
    updatedAt: null,
    publishedSchemeId: 'default',
  };
  const calls = [];
  const messages = [];
  const runtime = {
    presentation,
    messages,
    window: {
      location: { origin: 'http://localhost' },
      localStorage: { getItem: () => null, setItem: () => undefined },
    },
    fetch: async () => clone(authoritative),
    save: async (config, expectedRevision) => {
      calls.push(['save', expectedRevision, clone(config)]);
      authoritative = {
        ...authoritative,
        config: clone(config),
        revision: expectedRevision + 1,
        checksum: `r${expectedRevision + 1}`,
      };
      return clone(authoritative);
    },
    publish: async (id, expectedRevision) => {
      calls.push(['publish', id, expectedRevision]);
      const selected = authoritative.config.schemes.find((item) => item.id === id);
      return {
        scheme: clone(selected),
        branding: {
          welcomeTitle: selected.welcomeTitle,
          welcomeGuest: selected.welcomeGuest,
          welcomeTagline: selected.welcomeTagline,
          welcomeBgMediaId: selected.welcomeBgMediaId,
          welcomeLogoMediaId: selected.welcomeLogoMediaId,
          welcomePresentation: clone(selected.presentation),
        },
      };
    },
    ...overrides.runtime,
  };
  const ensureCalls = [];
  let republished = 0;
  const scope = vue.effectScope();
  const useWelcomeEditor = loadComposable(runtime);
  const state = scope.run(() => useWelcomeEditor({
    ensureAdmin: async (action) => { ensureCalls.push(action); return true; },
    captureAction: () => () => true,
    isEditableSourceActive: () => overrides.editableActive ?? true,
    republishEditable: async () => {
      republished += 1;
      if (overrides.republishError) throw overrides.republishError;
    },
  }));
  return {
    state,
    scope,
    calls,
    messages,
    ensureCalls,
    getRepublished: () => republished,
    setAuthoritative: (next) => { authoritative = next; },
    getAuthoritative: () => authoritative,
  };
}

test('draft save verifies the authoritative readback and publishing reuses the current revision', async () => {
  const h = harness();
  await h.state.openWelcomeEditor();
  h.state.welcomeForm.value.welcomeGuest = '合作伙伴代表';
  h.state.markWelcomeDraftChanged();

  await h.state.saveWelcomeScheme();
  assert.deepEqual(h.calls[0].slice(0, 2), ['save', 5]);
  assert.equal(h.state.welcomeSchemesRevision.value, 6);
  assert.equal(h.state.lastWelcomeSaveRevision.value, 6);
  assert.equal(h.getRepublished(), 0);
  assert.match(h.messages.at(-1)[1], /当前 LED 画面未切换/);

  await h.state.publishSelectedWelcomeScheme();
  assert.deepEqual(h.calls[1].slice(0, 2), ['save', 6]);
  assert.deepEqual(h.calls[2], ['publish', 'default', 7]);
  assert.equal(h.getRepublished(), 1);
  assert.deepEqual(h.ensureCalls, ['编辑欢迎页', '保存欢迎方案', '发布欢迎页']);
  h.scope.stop();
});

test('a mismatched readback never reports a successful save or advances the local revision', async () => {
  let fetchCount = 0;
  const h = harness({
    runtime: {
      fetch: async () => {
        fetchCount += 1;
        if (fetchCount === 1) return clone(h.getAuthoritative());
        return { ...clone(h.getAuthoritative()), checksum: 'different-server-state' };
      },
    },
  });
  await h.state.openWelcomeEditor();
  h.state.welcomeForm.value.welcomeTitle = '新的标题';
  h.state.markWelcomeDraftChanged();
  await h.state.saveWelcomeScheme();

  assert.equal(h.state.welcomeSchemesRevision.value, 5);
  assert.equal(h.state.lastWelcomeSaveRevision.value, null);
  assert.equal(h.messages.some(([kind, message]) => kind === 'success' && /已保存到服务器/.test(message)), false);
  assert.match(h.messages.at(-1)[1], /回读结果与本次保存不一致/);
  h.scope.stop();
});

test('publishing remains durable when only the active-screen refresh fails', async () => {
  const h = harness({ republishError: new Error('player offline') });
  await h.state.openWelcomeEditor();
  await h.state.publishSelectedWelcomeScheme();

  assert.deepEqual(h.calls.at(-1), ['publish', 'default', 6]);
  assert.equal(h.state.publishedWelcomeSchemeId.value, 'default');
  assert.equal(h.getRepublished(), 1);
  assert.deepEqual(h.messages.at(-1), ['warning', '方案已发布；大屏重推失败，将在轮询后自动更新']);
  h.scope.stop();
});
