const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

function transpile(file, customRequire, globals = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: customRequire,
    Date,
    setInterval,
    clearInterval,
    ...globals,
  });
  return module.exports;
}

function loadComposable() {
  const featureDir = path.resolve(__dirname, '../src/features');
  const progress = transpile(
    path.join(featureDir, 'playback-progress-controller.ts'),
    require,
  );
  const noCall = () => { throw new Error('unexpected default dependency'); };
  const customRequire = (id) => {
    if (id === 'vue') return vue;
    if (id === 'element-plus') return { ElMessage: {}, ElMessageBox: { confirm: noCall } };
    if (id === '@/stores/playback') return { usePlaybackStore: noCall };
    if (id === '@/services/playback.service') {
      return {
        addToPlaylist: noCall,
        listPlaylist: noCall,
        removeFromPlaylist: noCall,
        renamePlaylistItem: noCall,
        setChannelPlayMode: noCall,
      };
    }
    if (id === '@/services/media.service') return { mediaService: { list: noCall } };
    if (id === '@/services/http') return { absUrl: (value) => value };
    if (id === '@/features/playback-progress-controller') return progress;
    if (id === '@/features/audio-duration-probe') return { probeAudioDuration: noCall };
    throw new Error(`unexpected import: ${id}`);
  };
  return transpile(
    path.resolve(__dirname, '../src/composables/useAudioPlaylist.ts'),
    customRequire,
  ).useAudioPlaylist;
}

function row(id, mediaId, title, durationSec = null) {
  return {
    id,
    ownerUserId: null,
    mediaId,
    title,
    sortOrder: id,
    kind: 'audio',
    durationSec,
    missing: false,
  };
}

function harness(overrides = {}) {
  const channel = vue.ref(null);
  const calls = [];
  const messages = [];
  let rows = overrides.rows ?? [row(11, 101, '迎宾音乐', 60)];
  const api = {
    list: async () => rows,
    add: async (mediaId) => { calls.push(['add', mediaId]); },
    remove: async (itemId) => { calls.push(['remove', itemId]); },
    rename: async (itemId, title) => { calls.push(['rename', itemId, title]); },
    setPlayMode: async (mode) => { calls.push(['mode', mode]); },
    listAudioAssets: async () => [],
    probeDuration: async () => null,
    ...overrides.api,
  };
  if (overrides.getRows) api.list = async () => overrides.getRows();
  const playback = {
    channel,
    publish: async (mediaId) => { calls.push(['publish', mediaId]); },
    stop: async () => { calls.push(['stop']); },
    pause: async () => { calls.push(['pause']); },
    resume: async () => { calls.push(['resume']); },
    previous: async () => { calls.push(['previous']); },
    next: async () => { calls.push(['next']); },
    ...overrides.playback,
  };
  const scope = vue.effectScope();
  const useAudioPlaylist = loadComposable();
  const state = scope.run(() => useAudioPlaylist({
    playback,
    api,
    ensureAdmin: overrides.ensureAdmin ?? (async () => true),
    confirmRemove: overrides.confirmRemove ?? (async () => true),
    messages: {
      info: (message) => messages.push(['info', message]),
      success: (message) => messages.push(['success', message]),
      error: (message) => messages.push(['error', message]),
    },
  }));
  return { state, scope, channel, calls, messages, setRows: (value) => { rows = value; } };
}

test('loads the authoritative backend playlist projection', async () => {
  const h = harness({ rows: [row(11, 101, '迎宾音乐', 60), row(12, 102, '休息音乐')] });
  await h.state.loadPlaylist();
  assert.deepEqual(
    h.state.playlist.value.map(({ id, itemId, name, durationSec }) => ({ id, itemId, name, durationSec })),
    [
      { id: 101, itemId: 11, name: '迎宾音乐', durationSec: 60 },
      { id: 102, itemId: 12, name: '休息音乐', durationSec: null },
    ],
  );
  h.scope.stop();
});

test('rename requires admin and rolls the optimistic title back on failure', async () => {
  const h = harness({
    api: { rename: async () => { throw new Error('保存拒绝'); } },
  });
  await h.state.loadPlaylist();
  const item = h.state.playlist.value[0];
  await h.state.startRenamePl(item);
  h.state.plEditingText.value = '新名称';
  await h.state.commitRenamePl(item);
  assert.equal(item.name, '迎宾音乐');
  assert.match(h.messages.at(-1)[1], /保存拒绝/);
  h.scope.stop();
});

test('partial clear re-reads backend truth instead of showing a false empty list', async () => {
  let current = [row(11, 101, '一'), row(12, 102, '二')];
  const h = harness({
    getRows: () => current,
    api: {
      remove: async (itemId) => {
        if (itemId === 12) throw new Error('busy');
        current = current.filter((item) => item.id !== itemId);
      },
    },
  });
  await h.state.loadPlaylist();
  await h.state.clearPlaylist();
  assert.deepEqual(h.state.playlist.value.map((item) => item.itemId), [12]);
  assert.match(h.messages.at(-1)[1], /1 项未能移出/);
  h.scope.stop();
});

test('partial clear reports when backend truth cannot be re-read', async () => {
  let listCalls = 0;
  const h = harness({
    api: {
      list: async () => {
        listCalls += 1;
        if (listCalls > 1) throw new Error('read unavailable');
        return [row(11, 101, '一')];
      },
      remove: async () => { throw new Error('busy'); },
    },
  });
  await h.state.loadPlaylist();
  await h.state.clearPlaylist();
  assert.match(h.messages.at(-1)[1], /重新读取也失败/);
  assert.deepEqual(h.state.playlist.value.map((item) => item.itemId), [11]);
  h.scope.stop();
});

test('late duration result cannot cross into a newer playback session', async () => {
  let resolveDuration;
  const duration = new Promise((resolve) => { resolveDuration = resolve; });
  const h = harness({
    rows: [row(11, 101, '迎宾音乐')],
    api: { probeDuration: async () => duration },
  });
  await h.state.loadPlaylist();
  h.channel.value = { currentMediaId: 101, playbackSession: 'old', paused: false, playMode: 'loopAll' };
  const pending = h.state.syncPlaybackFromChannel(101, 'old');
  h.channel.value = { currentMediaId: 102, playbackSession: 'new', paused: false, playMode: 'loopAll' };
  resolveDuration(75);
  await pending;
  assert.equal(h.state.playlist.value[0].durationSec, null);
  h.scope.stop();
});

test('failed play-mode save restores the backend-confirmed mode', async () => {
  const h = harness({ api: { setPlayMode: async () => { throw new Error('offline'); } } });
  assert.equal(h.state.playMode.value, 'loopAll');
  await h.state.setPlayModeAndSave('shuffle');
  assert.equal(h.state.playMode.value, 'loopAll');
  assert.match(h.messages.at(-1)[1], /offline/);
  h.scope.stop();
});

test('play, pause and resume dispatch only through the playback port', async () => {
  const h = harness({ rows: [row(11, 101, '一'), row(12, 102, '二')] });
  await h.state.loadPlaylist();
  await h.state.playAt(3);
  assert.deepEqual(h.calls.at(-1), ['publish', 102]);

  h.channel.value = { currentMediaId: 102, playbackSession: 's1', paused: false, playMode: 'loopAll' };
  await h.state.plTogglePause();
  assert.deepEqual(h.calls.at(-1), ['pause']);
  h.channel.value = { ...h.channel.value, paused: true };
  await h.state.plTogglePause();
  assert.deepEqual(h.calls.at(-1), ['resume']);
  h.scope.stop();
});

test('media-picker handoff persists once and treats an existing item as idempotent', async () => {
  let current = [row(11, 101, '已有')];
  const h = harness({
    getRows: () => current,
    api: {
      add: async (mediaId) => {
        h.calls.push(['add', mediaId]);
        current = [...current, row(12, mediaId, '新增')];
      },
    },
  });
  await h.state.loadPlaylist();
  await h.state.addPickedMedia(101, '已有');
  assert.equal(h.calls.filter(([name]) => name === 'add').length, 0);
  await h.state.addPickedMedia(102, '新增');
  assert.deepEqual(h.state.playlist.value.map((item) => item.id), [101, 102]);
  assert.equal(h.calls.filter(([name]) => name === 'add').length, 1);
  h.scope.stop();
});

test('AudioPage delegates the complete playlist journey to one composable', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/AudioPage.vue'), 'utf8');
  const composable = fs.readFileSync(path.resolve(__dirname, '../src/composables/useAudioPlaylist.ts'), 'utf8');
  assert.match(page, /useAudioPlaylist\(\{ ensureAdmin \}\)/);
  assert.doesNotMatch(page, /apiAddToPlaylist/);
  assert.doesNotMatch(page, /createPlaybackProgressController/);
  assert.match(composable, /apiListPlaylist\(BGM_SLOT\)/);
  assert.match(composable, /current\?\.playbackSession !== session/);
  assert.match(composable, /failed > 0/);
});
