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
  path.resolve(__dirname, '../src/composables/usePlayerPlaylist.ts'),
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

function item(id, ownerUserId = 1, overrides = {}) {
  return {
    id,
    mediaId: id * 10,
    title: `item-${id}`,
    missing: false,
    ownerUserId,
    ...overrides,
  };
}

function historyItem(mediaId, overrides = {}) {
  return { mediaId, mediaName: `history-${mediaId}`, missing: false, ...overrides };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function harness(overrides = {}) {
  const calls = [];
  const messages = [];
  const timers = new Map();
  let timerId = 0;
  let current = true;
  const slot = vue.ref(1);
  const channel = vue.ref({
    currentMediaId: null,
    currentMediaName: null,
    paused: false,
    playbackSession: null,
  });

  const playbackStore = {
    publish: overrides.publish ?? (async (...args) => { calls.push(['publish', ...args]); }),
    pause: overrides.pause ?? (async (...args) => { calls.push(['pause', ...args]); }),
    resume: overrides.resume ?? (async (...args) => { calls.push(['resume', ...args]); }),
    stop: overrides.stop ?? (async (...args) => { calls.push(['stop', ...args]); }),
    next: overrides.next ?? (async (...args) => { calls.push(['next', ...args]); }),
    prev: overrides.prev ?? (async (...args) => { calls.push(['prev', ...args]); }),
    load: overrides.storeLoad ?? (async () => { calls.push(['storeLoad']); }),
  };
  const playbackService = {
    listPlaylist: overrides.listPlaylist ?? (async (value) => { calls.push(['listPlaylist', value]); return []; }),
    listHistory: overrides.listHistory ?? (async (value) => { calls.push(['listHistory', value]); return []; }),
    addToPlaylist: overrides.addToPlaylist ?? (async (...args) => { calls.push(['addToPlaylist', ...args]); }),
    removeFromPlaylist: overrides.removeFromPlaylist ?? (async (...args) => { calls.push(['removeFromPlaylist', ...args]); }),
    renamePlaylistItem: overrides.renamePlaylistItem ?? (async (...args) => { calls.push(['renamePlaylistItem', ...args]); }),
    reorderPlaylist: overrides.reorderPlaylist ?? (async (...args) => { calls.push(['reorderPlaylist', ...args]); }),
    setDisplayFit: overrides.setDisplayFit ?? (async (...args) => { calls.push(['setDisplayFit', ...args]); }),
  };
  const mediaService = {
    list: overrides.mediaList ?? (async (...args) => { calls.push(['mediaList', ...args]); return { items: [] }; }),
    upload: overrides.upload ?? (async (...args) => {
      calls.push(['upload', ...args]);
      return { id: 99, originalName: 'upload.mp4' };
    }),
    createWebpage: overrides.createWebpage ?? (async (...args) => {
      calls.push(['createWebpage', ...args]);
      return { id: 98, originalName: 'web' };
    }),
  };
  const fakeWindow = {
    setTimeout(callback, ms) {
      const id = ++timerId;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  function createLatestIdentityRead(active) {
    let revision = 0;
    return () => {
      const captured = ++revision;
      return () => captured === revision && active();
    };
  }

  const usePlayerPlaylist = execute(composableSource, (id) => {
    if (id === 'vue') return vue;
    if (id === 'element-plus') {
      return {
        ElMessage: {
          success: (message) => messages.push(['success', message]),
          warning: (message) => messages.push(['warning', message]),
          error: (message) => messages.push(['error', message]),
          info: (message) => messages.push(['info', message]),
        },
        ElMessageBox: {
          confirm: overrides.confirm ?? (async () => undefined),
        },
      };
    }
    if (id === '@/stores/playback') return { usePlaybackStore: () => playbackStore };
    if (id === '@/services/playback.service') return playbackService;
    if (id === '@/services/media.service') return { mediaService };
    if (id === '@/services/identity-boundary') return { createLatestIdentityRead };
    throw new Error(`unexpected import: ${id}`);
  }, { window: fakeWindow }).usePlayerPlaylist;

  const scope = vue.effectScope();
  const state = scope.run(() => usePlayerPlaylist({
    slot,
    title: () => 'LED 大屏',
    channel,
    ensureAdmin: overrides.ensureAdmin ?? (async () => true),
    captureAction: () => {
      const capturedSlot = slot.value;
      return () => current && slot.value === capturedSlot;
    },
  }));

  return {
    state,
    scope,
    calls,
    messages,
    timers,
    slot,
    channel,
    setCurrent: (value) => { current = value; },
  };
}

test('the latest slot list wins when an older request finishes last', async () => {
  const slot1Playlist = deferred();
  const slot1History = deferred();
  const slot2Playlist = deferred();
  const slot2History = deferred();
  const h = harness({
    listPlaylist: (slot) => (slot === 1 ? slot1Playlist.promise : slot2Playlist.promise),
    listHistory: (slot) => (slot === 1 ? slot1History.promise : slot2History.promise),
  });

  const older = h.state.loadAll();
  h.slot.value = 2;
  slot2Playlist.resolve([item(2)]);
  slot2History.resolve([historyItem(20)]);
  await flush();
  slot1Playlist.resolve([item(1)]);
  slot1History.resolve([historyItem(10)]);
  await older;

  assert.equal(h.state.playlist.value[0].id, 2);
  assert.equal(h.state.history.value[0].mediaId, 20);
  h.scope.stop();
});

test('idle playback resumes the most recent available history item still in the playlist', async () => {
  const h = harness();
  h.state.playlist.value = [item(1), item(2)];
  h.state.history.value = [historyItem(20), historyItem(10)];

  await h.state.togglePause();

  // 2026-10 起普通视频默认单次 (播完停尾帧), 恢复历史项也不再硬编码循环
  assert.deepEqual(h.calls.filter(([name]) => name === 'publish'), [['publish', 1, 20]]);
  h.scope.stop();
});

test('pause, resume, stop and display fit target the captured slot and session', async () => {
  const h = harness();
  h.channel.value = { currentMediaId: 10, paused: false, playbackSession: 'session-1' };
  await h.state.togglePause();
  h.channel.value.paused = true;
  await h.state.togglePause();
  await h.state.stopPlayback();
  await h.state.changeFit('contain');

  assert.deepEqual(h.calls.filter(([name]) => ['pause', 'resume', 'stop', 'setDisplayFit'].includes(name)), [
    ['pause', 1],
    ['resume', 1],
    ['stop', 1, 'session-1'],
    ['setDisplayFit', 1, 'contain'],
  ]);
  h.scope.stop();
});

test('rename requires administrator approval and restores the title when persistence fails', async () => {
  let allowed = false;
  const h = harness({
    ensureAdmin: async () => allowed,
    renamePlaylistItem: async () => { throw new Error('write failed'); },
  });
  const target = item(1);
  await h.state.startRename(target);
  assert.equal(h.state.editingId.value, null);

  allowed = true;
  await h.state.startRename(target);
  h.state.editingText.value = 'new title';
  await h.state.commitRename(target);

  assert.equal(target.title, 'item-1');
  assert.equal(h.messages.at(-1)[0], 'error');
  h.scope.stop();
});

test('reorder blocks mixed owners and never restores an old slot after a late failure', async () => {
  const pending = deferred();
  const h = harness({ reorderPlaylist: () => pending.promise });
  const first = item(1, 1);
  const second = item(2, 2);
  h.state.playlist.value = [first, second];
  h.state.onDragStart(first, { dataTransfer: { setData() {}, effectAllowed: '' } });
  await h.state.onDrop(second);
  assert.equal(h.messages.at(-1)[0], 'warning');

  second.ownerUserId = 1;
  h.state.onDragStart(first, { dataTransfer: { setData() {}, effectAllowed: '' } });
  const dropping = h.state.onDrop(second);
  h.slot.value = 2;
  pending.reject(new Error('late failure'));
  await dropping;
  await flush();

  assert.equal(h.state.playlist.value.length, 0);
  assert.equal(h.messages.some(([kind, message]) => kind === 'error' && message.includes('late failure')), false);
  h.scope.stop();
});

test('the newest media picker request wins and a late add cannot update another slot', async () => {
  const video = deferred();
  const image = deferred();
  const adding = deferred();
  const h = harness({
    mediaList: ({ kind }) => (kind === 'video' ? video.promise : image.promise),
    addToPlaylist: (...args) => { h.calls.push(['addToPlaylist', ...args]); return adding.promise; },
  });

  const older = h.state.openPicker();
  h.state.pickerKind.value = 'image';
  const newer = h.state.loadAssets();
  image.resolve({ items: [{ id: 7, originalName: 'new.png', kind: 'image' }] });
  await newer;
  video.resolve({ items: [{ id: 8, originalName: 'old.mp4', kind: 'video' }] });
  await older;
  assert.equal(h.state.assets.value[0].originalName, 'new.png');

  const picking = h.state.pickAsset(h.state.assets.value[0]);
  h.slot.value = 2;
  adding.resolve();
  await picking;
  await flush();
  assert.deepEqual(h.calls.filter(([name]) => name === 'addToPlaylist'), [['addToPlaylist', 1, 7]]);
  assert.equal(h.messages.some(([kind]) => kind === 'success'), false);
  h.scope.stop();
});

test('an upload finishing after a slot switch stays in the library and is not added to the new slot', async () => {
  const uploading = deferred();
  let confirmCalls = 0;
  const h = harness({
    upload: () => uploading.promise,
    confirm: async () => { confirmCalls += 1; },
  });
  const input = { files: [{ name: 'late.mp4' }], value: 'selected' };
  const request = h.state.onFilePicked({ target: input });
  h.slot.value = 2;
  uploading.resolve({ id: 90, originalName: 'late.mp4' });
  await request;

  assert.equal(input.value, '');
  assert.equal(confirmCalls, 0);
  assert.equal(h.calls.some(([name]) => name === 'addToPlaylist'), false);
  assert.deepEqual(h.messages, []);
  h.scope.stop();
});

test('an uploaded file reports playlist failure without falsely reporting upload failure', async () => {
  const h = harness({
    addToPlaylist: async () => { throw new Error('playlist unavailable'); },
  });
  await h.state.onFilePicked({ target: { files: [{ name: 'saved.mp4' }], value: 'selected' } });

  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0][1], /文件已保存到媒体库.*加入播放列表失败/);
  assert.doesNotMatch(h.messages[0][1], /^上传失败/);
  h.scope.stop();
});

test('a webpage created after a slot switch is not attached to the new slot', async () => {
  const creating = deferred();
  const h = harness({ createWebpage: () => creating.promise });
  h.state.openWebpageDialog();
  h.state.webpageForm.value = { name: '现场页', url: 'https://example.test/page' };
  const request = h.state.submitWebpage();
  h.slot.value = 2;
  creating.resolve({ id: 91, originalName: '现场页' });
  await request;

  assert.equal(h.calls.some(([name]) => name === 'addToPlaylist'), false);
  assert.equal(h.state.webpageDialog.value, false);
  assert.deepEqual(h.messages, []);
  h.scope.stop();
});

test('scope disposal clears timers and slot-bound rendered data', async () => {
  const h = harness();
  h.state.playlist.value = [item(1)];
  h.state.history.value = [historyItem(10)];
  h.state.assets.value = [{ id: 7, originalName: 'asset', kind: 'image' }];
  h.channel.value.currentMediaId = 10;
  await vue.nextTick();
  assert.equal(h.timers.size, 1);

  h.scope.stop();

  assert.equal(h.timers.size, 0);
  assert.equal(h.state.playlist.value.length, 0);
  assert.equal(h.state.history.value.length, 0);
  assert.equal(h.state.assets.value.length, 0);
});

test('PlayerConsole delegates the playlist journey to the dedicated composable', () => {
  assert.match(playerConsoleSource, /usePlayerPlaylist\(\{/);
  assert.doesNotMatch(playerConsoleSource, /listPlaylist|listHistory|addToPlaylist|reorderPlaylist/);
  assert.doesNotMatch(playerConsoleSource, /mediaService\./);
  assert.doesNotMatch(playerConsoleSource, /async function playItem|async function onDrop|async function submitWebpage/);
  assert.ok(playerConsoleSource.split('\n').length < 1500);
  assert.match(composableSource, /const slot = options\.slot\.value/);
  assert.match(composableSource, /if \(!currentAction\(\)\) return/);
});
