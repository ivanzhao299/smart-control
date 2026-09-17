const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const flush = () => new Promise(resolve => setImmediate(resolve));
const file = (name, size = 12) => ({ name, size, type: 'video/mp4' });

function fixture() {
  const pending = [], messages = [], confirms = [], modules = {};
  let allowed = true, refreshes = 0;
  function load(name) {
    if (modules[name]) return modules[name];
    if (name === 'vue') return vue;
    if (name === 'element-plus') return {
      ElMessage: Object.fromEntries(['success', 'error', 'warning'].map(level => [level, text => messages.push({ level, text })])),
      ElMessageBox: { confirm: () => new Promise((resolve, reject) => confirms.push({ resolve, reject })) },
    };
    if (name === '@/services/media.service') return { mediaService: { upload: (file, options) => new Promise((resolve, reject) => pending.push({ file, options, resolve, reject })) } };
    const filename = name === '@/services/identity-boundary' ? 'services/identity-boundary.ts'
      : name === './media-file-intake' ? 'features/media-file-intake.ts' : 'features/useMediaUploadQueue.ts';
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: load, DOMException });
    return modules[name] = exports;
  }
  const scope = vue.effectScope();
  const state = scope.run(() => load('queue').useMediaUploadQueue({ canUpload: () => allowed, onUploaded: async () => { refreshes++; } }));
  return { state, pending, confirms, messages, scope, refreshes: () => refreshes,
    allow: value => { allowed = value; }, switchIdentity: () => load('@/services/identity-boundary').invalidateIdentity() };
}

test('uploads stay serial, appended files share a batch, and failures do not skip later files', async () => {
  const f = fixture();
  await f.state.queueFiles([file('a.mp4'), file('b.mp4')]);
  await f.state.queueFiles([file('c.mp4')]);
  assert.equal(f.pending.length, 1);
  assert.equal(f.state.uploadBatchTotal.value, 3);
  f.pending[0].options.onProgress(40);
  assert.equal(f.state.uploadPct.value, 40);
  f.pending[0].resolve({}); await flush();
  assert.equal(f.state.uploadBatchDone.value, 1);
  assert.equal(f.pending[1].file.name, 'b.mp4');
  f.pending[1].reject(new Error('failed')); await flush();
  assert.equal(f.pending[2].file.name, 'c.mp4');
  f.pending[2].resolve({}); await flush();
  assert.equal(f.refreshes(), 2);
  assert.equal(f.state.uploading.value, false);
  assert.equal(f.state.uploadBatchTotal.value, 0);
  f.scope.stop();
});

test('account change drops old queued files and late progress/completion cannot corrupt the new account batch', async () => {
  const f = fixture();
  await f.state.queueFiles([file('old-1.mp4'), file('old-2.mp4')]);
  f.switchIdentity();
  await f.state.queueFiles([file('new.mp4')]);
  f.pending[0].options.onProgress(99);
  f.pending[0].reject(new Error('aborted')); await flush();
  assert.equal(f.state.uploadName.value, 'new.mp4');
  assert.equal(f.state.uploadPct.value, 0);
  assert.equal(f.state.uploadBatchTotal.value, 1);
  assert.deepEqual(f.pending.map(p => p.file.name), ['old-1.mp4', 'new.mp4']);
  assert.equal(f.messages.length, 0);
  f.pending[1].resolve({}); await flush();
  assert.equal(f.refreshes(), 1);
  f.scope.stop();
});

test('switching identity while a large-file confirmation is open cannot enqueue under the new account', async () => {
  const f = fixture();
  const confirmation = f.state.queueFiles([file('large.mp4', 600 * 1024 ** 2)]);
  assert.equal(f.confirms.length, 1);
  f.switchIdentity(); f.confirms[0].resolve(); await confirmation;
  assert.equal(f.pending.length, 0);
  f.scope.stop();
});

test('a completed earlier batch does not cancel a same-account large-file confirmation', async () => {
  const f = fixture();
  await f.state.queueFiles([file('first.mp4')]);
  const confirmation = f.state.queueFiles([file('large.mp4', 600 * 1024 ** 2)]);
  f.pending[0].resolve({}); await flush();
  f.confirms[0].resolve(); await confirmation;
  assert.equal(f.pending[1].file.name, 'large.mp4');
  f.pending[1].resolve({}); await flush(); f.scope.stop();
});

test('dispose suppresses late upload effects and cannot start another queued file', async () => {
  const f = fixture();
  await f.state.queueFiles([file('a.mp4'), file('b.mp4')]);
  f.scope.stop();
  f.pending[0].resolve({}); await flush();
  assert.equal(f.pending.length, 1);
  assert.equal(f.refreshes(), 0);
  assert.equal(f.messages.length, 0);
  assert.equal(f.state.uploading.value, false);
});

test('permission loss stops the batch and resumption requires explicit re-selection', async () => {
  const f = fixture();
  await f.state.queueFiles([file('a.mp4'), file('b.mp4')]);
  f.allow(false); f.pending[0].resolve({}); await flush(); f.allow(true);
  assert.equal(f.pending.length, 1);
  assert.equal(f.state.uploadBatchTotal.value, 0);
  assert.equal(f.refreshes(), 0);
  f.scope.stop();
});

test('unsupported, oversized and canceled files never enter the upload queue', async () => {
  const f = fixture();
  await f.state.queueFiles([{ name: 'text.txt', type: 'text/plain', size: 12 }, file('huge.mp4', 11 * 1024 ** 3)]);
  const confirm = f.state.queueFiles([file('large.mp4', 600 * 1024 ** 2)]);
  f.confirms[0].reject('cancel'); await confirm;
  assert.equal(f.pending.length, 0);
  f.allow(false); await f.state.queueFiles([file('allowed.mp4')]);
  assert.equal(f.pending.length, 0);
  f.scope.stop();
});
