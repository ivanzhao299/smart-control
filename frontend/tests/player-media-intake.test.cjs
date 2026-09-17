const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  let generation = 0, slot = 1, reloads = 0;
  const calls = [], confirms = [], messages = [];
  const media = {
    upload: async () => ({ id: 42, originalName: '素材' }),
    createWebpage: async () => ({ id: 43, originalName: '网页' }),
  };
  const playback = { addToPlaylist: async (...args) => calls.push(args) };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/usePlayerMediaIntake.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => {
    if (name === 'vue') return vue;
    if (name === '@/services/media.service') return { mediaService: media };
    if (name === '@/services/playback.service') return playback;
    if (name === 'element-plus') return {
      ElMessage: Object.fromEntries(['success', 'error', 'info', 'warning'].map(level => [level, message => messages.push([level, message])])),
      ElMessageBox: { confirm: () => new Promise((resolve, reject) => confirms.push({ resolve, reject })) },
    };
    throw new Error(name);
  } });
  const state = exports.usePlayerMediaIntake({ slot: () => slot,
    captureAction: () => { const identity = generation, target = slot; return () => identity === generation && target === slot; },
    reload: async () => { reloads++; },
  });
  return { state, calls, confirms, messages, media, playback, reloads: () => reloads,
    invalidate: () => { generation++; }, slot: value => { slot = value; },
    pick: () => state.onFilePicked({ target: { files: [{ name: '素材.mp4' }], value: 'selected' } }),
  };
}

test('upload remains only in the media library until the user confirms adding to this screen playlist', async () => {
  const f = fixture(); const upload = f.pick(); await flush();
  assert.equal(f.calls.length, 0); assert.equal(f.confirms.length, 1);
  f.confirms[0].resolve(); await upload;
  assert.deepEqual(f.calls, [[1, 42]]); assert.equal(f.reloads(), 1);
  assert.equal(f.state.uploading.value, false);
});

test('declining playlist confirmation does not delete the uploaded file or switch playback', async () => {
  const f = fixture(); const upload = f.pick(); await flush();
  f.confirms[0].reject('cancel'); await upload;
  assert.equal(f.calls.length, 0); assert.equal(f.reloads(), 0);
  assert.match(f.messages[0][1], /未加入播放列表/);
});

test('identity or target-screen change during confirmation prevents adding to a different context', async () => {
  for (const invalidate of [f => f.invalidate(), f => f.slot(2)]) {
    const f = fixture(); const upload = f.pick(); await flush();
    invalidate(f); f.confirms[0].resolve(); await upload;
    assert.equal(f.calls.length, 0); assert.equal(f.messages.length, 0);
  }
});

test('playlist failure is reported as a partial result, not as user cancellation', async () => {
  const f = fixture(); f.playback.addToPlaylist = async () => { throw new Error('offline'); };
  const upload = f.pick(); await flush(); f.confirms[0].resolve(); await upload;
  assert.equal(f.messages[0][0], 'error');
  assert.match(f.messages[0][1], /媒体已保存，但加入播放列表失败/);
});

test('webpage creation deduplicates repeated clicks and stays bound to the initiating screen', async () => {
  const f = fixture(); let finish, creates = 0;
  f.media.createWebpage = () => { creates++; return new Promise(resolve => { finish = resolve; }); };
  f.state.webpageForm.value = { name: '网页', url: 'https://example.com/' };
  const first = f.state.submitWebpage(); await f.state.submitWebpage();
  assert.equal(creates, 1); assert.equal(f.state.webpageBusy.value, true);
  f.slot(2); finish({ id: 43, originalName: '网页' }); await first;
  assert.equal(f.calls.length, 0); assert.equal(f.state.webpageBusy.value, false);
});

test('invalid webpage URLs issue no writes and successful creation adds exactly once to the current playlist', async () => {
  const f = fixture(); f.state.webpageForm.value.url = 'javascript:alert(1)';
  await f.state.submitWebpage(); assert.equal(f.calls.length, 0);
  f.state.webpageForm.value = { name: '', url: ' https://example.com/ ' };
  f.slot(2); await f.state.submitWebpage();
  assert.deepEqual(f.calls, [[2, 43]]); assert.equal(f.reloads(), 1);
});
