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
    Date,
    Promise,
  });
  return module.exports;
}

const intakeSource = fs.readFileSync(
  path.resolve(__dirname, '../src/features/media-file-intake.ts'),
  'utf8',
);
const intake = execute(intakeSource, (id) => { throw new Error(`unexpected import: ${id}`); });
const composableSource = fs.readFileSync(
  path.resolve(__dirname, '../src/composables/useMediaUploadQueue.ts'),
  'utf8',
);
const mediaPage = fs.readFileSync(path.resolve(__dirname, '../src/pages/MediaPage.vue'), 'utf8');

function mediaFile(name, size = 1024, type = 'video/mp4') {
  return { name, size, type };
}

async function eventually(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition timed out');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function harness(overrides = {}) {
  const calls = [];
  const messages = [];
  const canOperate = vue.ref(overrides.canOperate ?? true);
  let disposed = false;
  const upload = overrides.upload ?? (async (file, options) => {
    calls.push(['upload', file.name]);
    options.onProgress?.(100);
    return { id: calls.length };
  });
  const useMediaUploadQueue = execute(composableSource, (id) => {
    if (id === 'vue') return vue;
    if (id === 'element-plus') {
      return {
        ElMessage: {
          success: (message) => messages.push(['success', message]),
          warning: (message) => messages.push(['warning', message]),
          error: (message) => messages.push(['error', message]),
        },
        ElMessageBox: {
          confirm: async (...args) => {
            calls.push(['confirm', ...args]);
            if (overrides.confirmError) throw overrides.confirmError;
          },
        },
      };
    }
    if (id === '@/services/media.service') return { mediaService: { upload } };
    if (id === '@/features/media-file-intake') return intake;
    if (id === 'axios') {
      return { isAxiosError: (e) => !!e && typeof e === 'object' && e.isAxiosError === true };
    }
    if (id === '@/services/http') {
      return {
        isDirectLocalConnection: () => overrides.direct ?? false,
        notifyUnauthorized: () => {},
      };
    }
    if (id === '@/services/upload-keepalive') {
      return {
        beginUploadKeepAlive: () => {},
        endUploadKeepAlive: async () => {},
      };
    }
    throw new Error(`unexpected import: ${id}`);
  }).useMediaUploadQueue;
  const scope = vue.effectScope();
  const state = scope.run(() => useMediaUploadQueue({
    canOperate,
    refresh: async () => { calls.push(['refresh']); },
    isDisposed: () => disposed,
  }));
  return {
    state,
    scope,
    calls,
    messages,
    canOperate,
    setDisposed: (value) => { disposed = value; },
  };
}

test('upload queue filters invalid files and uploads accepted files serially with batch progress', async () => {
  const resolvers = [];
  const h = harness({
    upload: (file, options) => {
      h.calls.push(['upload', file.name]);
      options.onProgress?.(40);
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });
  const first = mediaFile('first.mp4');
  const second = mediaFile('second.mp4');
  await h.state.queueFiles([
    mediaFile('notes.txt', 100, 'text/plain'),
    mediaFile('oversize.mp4', 11 * 1024 ** 3),
    first,
    second,
  ]);

  assert.deepEqual(h.calls, [['upload', 'first.mp4']]);
  assert.equal(h.state.uploadBatchTotal.value, 2);
  assert.equal(h.state.uploadBatchDone.value, 0);
  assert.equal(h.state.uploadPct.value, 40);
  assert.deepEqual(h.messages.slice(0, 2), [
    ['warning', '已跳过: notes.txt (类型不支持)'],
    ['error', '已跳过: oversize.mp4 (超过 10GB 上限)'],
  ]);

  resolvers.shift()({ id: 1 });
  await eventually(() => h.calls.some((call) => call[0] === 'upload' && call[1] === 'second.mp4'));
  assert.equal(h.state.uploadBatchDone.value, 1);
  resolvers.shift()({ id: 2 });
  await eventually(() => h.state.uploadBatchTotal.value === 0);
  assert.deepEqual(h.calls, [
    ['upload', 'first.mp4'],
    ['refresh'],
    ['upload', 'second.mp4'],
    ['refresh'],
  ]);
  assert.equal(h.state.uploadBatchDone.value, 0);
  assert.equal(h.state.uploading.value, false);
  h.scope.stop();
});

test('large-file cancellation and lost permission never enqueue an upload', async () => {
  const cancelled = harness({ confirmError: new Error('cancelled') });
  await cancelled.state.queueFiles([mediaFile('large.mp4', 600 * 1024 ** 2)]);
  assert.equal(cancelled.calls[0][0], 'confirm');
  assert.equal(cancelled.calls.some(([name]) => name === 'upload'), false);
  cancelled.scope.stop();

  const denied = harness({ canOperate: false });
  await denied.state.queueFiles([mediaFile('clip.mp4')]);
  assert.deepEqual(denied.calls, []);
  denied.scope.stop();
});

test('scope disposal clears queued files and suppresses stale upload success', async () => {
  let finish;
  const h = harness({
    upload: (file, options) => {
      h.calls.push(['upload', file.name]);
      options.onProgress?.(25);
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  await h.state.queueFiles([mediaFile('active.mp4'), mediaFile('pending.mp4')]);
  assert.equal(h.state.uploadQueue.value.length, 2);
  h.scope.stop();
  assert.equal(h.state.uploadQueue.value.length, 0);
  finish({ id: 1 });
  await eventually(() => h.state.uploading.value === false);
  assert.deepEqual(h.calls, [['upload', 'active.mp4']]);
  assert.deepEqual(h.messages, []);
});

test('page disposal suppresses an active upload result before the Vue scope finishes closing', async () => {
  let finish;
  const h = harness({
    upload: (file) => {
      h.calls.push(['upload', file.name]);
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  await h.state.queueFiles([mediaFile('active.mp4'), mediaFile('pending.mp4')]);
  h.setDisposed(true);
  finish({ id: 1 });
  await eventually(() => h.state.uploadBatchTotal.value === 0);
  assert.deepEqual(h.calls, [['upload', 'active.mp4']]);
  assert.deepEqual(h.messages, []);
  assert.equal(h.state.uploadQueue.value.length, 0);
  h.scope.stop();
});

test('directory drops consume every entry and reuse the same upload queue', async () => {
  const h = harness();
  const one = mediaFile('one.mp4');
  const two = mediaFile('two.pdf', 2048, 'application/pdf');
  const fileEntry = (file) => ({ isFile: true, isDirectory: false, file: (ok) => ok(file) });
  const batches = [[fileEntry(one), fileEntry(two)], []];
  const directory = {
    isFile: false,
    isDirectory: true,
    createReader: () => ({ readEntries: (ok) => ok(batches.shift()) }),
  };
  let prevented = false;
  await h.state.onDrop({
    preventDefault: () => { prevented = true; },
    dataTransfer: {
      items: { 0: { webkitGetAsEntry: () => directory }, length: 1 },
      files: [],
    },
  });
  await eventually(() => h.state.uploadBatchTotal.value === 0);
  assert.equal(prevented, true);
  assert.deepEqual(h.calls.filter(([name]) => name === 'upload'), [
    ['upload', 'one.mp4'],
    ['upload', 'two.pdf'],
  ]);
  h.scope.stop();
});

test('MediaPage delegates queue, drag/drop and progress lifecycle to one composable', () => {
  assert.match(mediaPage, /useMediaUploadQueue\(\{/);
  assert.doesNotMatch(mediaPage, /async function queueFiles/);
  assert.doesNotMatch(mediaPage, /async function startQueue/);
  assert.doesNotMatch(mediaPage, /async function doUploadOne/);
  assert.doesNotMatch(mediaPage, /collectFilesFromEntry/);
  assert.match(composableSource, /mediaService\.upload\(file/);
  assert.match(composableSource, /entries\.map\(collectFilesFromEntry\)/);
});
