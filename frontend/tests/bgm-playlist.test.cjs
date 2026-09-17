const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const calls = [], messages = [], audio = [], timers = new Map(), activate = [], deactivate = [];
  const dialog = { confirm: async () => {} };
  const modules = {};
  let time = 1000, timerId = 0;
  const rows = [{ id: 10, mediaId: 5, title: '曲目别名', durationSec: 10, missing: false },
    { id: 11, mediaId: 6, title: '已删除媒体', durationSec: null, missing: true }];
  const services = {
    listPlaylist: async slot => { calls.push(['list', slot]); return rows; },
    addToPlaylist: async (...args) => calls.push(['add', ...args]),
    removeFromPlaylist: async (...args) => calls.push(['remove', ...args]),
    renamePlaylistItem: async (...args) => calls.push(['rename', ...args]),
    setChannelPlayMode: async (...args) => calls.push(['mode', ...args]),
  };
  const media = {
    list: async () => ({ items: [{ id: 5, originalName: '原文件名', durationSec: 10 }] }),
    access: async id => { calls.push(['access', id]); return { url: '/api/media/authorized?grant=test' }; },
  };
  const playbackStore = vue.reactive({ slotAudio: null,
    ...Object.fromEntries(['publish', 'stop', 'pause', 'resume', 'prev', 'next'].map(method => [method, async (...args) => calls.push([method, ...args])])),
  });
  class AudioFixture {
    constructor() { this.events = new Map(); this.duration = Infinity; this.src = ''; audio.push(this); }
    addEventListener(name, fn) { this.events.set(name, fn); }
    removeEventListener(name, fn) { if (this.events.get(name) === fn) this.events.delete(name); }
    emit(name) { this.events.get(name)?.(); }
  }
  function load(name) {
    if (modules[name]) return modules[name];
    if (name === 'vue') return { ...vue, onActivated: fn => activate.push(fn), onDeactivated: fn => deactivate.push(fn) };
    if (name === 'element-plus') return { ElMessage: Object.fromEntries(['success', 'error', 'info'].map(level => [level, text => messages.push([level, text])])), ElMessageBox: dialog };
    if (name === '@/services/http') return { absUrl: url => url };
    if (name === '@/services/playback.service') return services;
    if (name === '@/services/media.service') return { mediaService: media };
    const filename = name === '@/services/identity-boundary' ? 'services/identity-boundary.ts' : 'features/useBgmPlaylist.ts';
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: load, Audio: AudioFixture, DOMException,
      Date: class extends Date { static now() { return time; } },
      setInterval: fn => { timers.set(++timerId, { fn, kind: 'interval' }); return timerId; },
      setTimeout: fn => { timers.set(++timerId, { fn, kind: 'timeout' }); return timerId; },
      clearInterval: id => timers.delete(id), clearTimeout: id => timers.delete(id),
    });
    return modules[name] = exports;
  }
  const scope = vue.effectScope();
  const state = scope.run(() => load('bgm').useBgmPlaylist({ playbackStore, ensureAdmin: async () => true }));
  return { scope, state, calls, messages, rows, audio, timers, services, media, playbackStore, dialog,
    tick: ms => { time += ms; for (const timer of [...timers.values()]) if (timer.kind === 'interval') timer.fn(); },
    deactivate: () => deactivate.forEach(fn => fn()), activate: () => activate.forEach(fn => fn()),
    switchIdentity: () => load('@/services/identity-boundary').invalidateIdentity(),
  };
}

test('BGM playlist preserves persisted identifiers and missing items; play/skip use slot 3 only', async () => {
  const f = fixture(); await f.state.loadPlaylist(); await f.state.loadAudioAssets();
  assert.equal(f.state.playlist.value[0].itemId, 10);
  assert.equal(f.state.playlist.value[0].id, 5);
  assert.equal(f.state.playlist.value[1].missing, true);
  await f.state.playAt(0); await f.state.plNext(); await f.state.plPrev();
  assert.ok(f.calls.some(call => JSON.stringify(call) === JSON.stringify(['publish', 3, 5, 'loop'])));
  assert.ok(f.calls.some(call => call[0] === 'next' && call[1] === 3));
  assert.ok(f.calls.some(call => call[0] === 'prev' && call[1] === 3));
  assert.equal(f.state.plIdx.value, -1); // server state, not the click, controls highlighting
  f.scope.stop();
});

test('local progress reaching the end never issues a next-track command', async () => {
  const f = fixture(); await f.state.loadPlaylist();
  f.playbackStore.slotAudio = { currentMediaId: 5, paused: false }; await flush();
  assert.equal(f.state.plIdx.value, 0);
  f.tick(5000); assert.equal(f.state.plProgress.value, 50);
  f.tick(6000); assert.equal(f.state.plProgress.value, 100);
  assert.equal(f.timers.size, 0);
  assert.equal(f.calls.filter(call => ['next', 'publish'].includes(call[0])).length, 0);
  f.scope.stop();
});

test('pause/resume progress retains elapsed time and mode-save failure restores prior selection', async () => {
  const f = fixture(); await f.state.loadPlaylist();
  f.playbackStore.slotAudio = { currentMediaId: 5, paused: false }; await flush();
  f.tick(3000); await f.state.plTogglePause();
  f.tick(2000); assert.equal(f.state.plProgress.value, 30);
  f.playbackStore.slotAudio.paused = true;
  await f.state.plTogglePause(); f.tick(2000);
  assert.equal(f.state.plProgress.value, 50);
  f.services.setChannelPlayMode = async () => { throw new Error('offline'); };
  await f.state.setPlayModeAndSave('shuffle');
  assert.equal(f.state.playMode.value, 'loopAll');
  f.scope.stop();
});

test('unknown durations use an authenticated access grant and preserve the VBR duration-change workaround', async () => {
  const f = fixture(); await f.state.loadPlaylist();
  f.playbackStore.slotAudio = { currentMediaId: 6, paused: false }; await flush();
  const probe = f.audio[0];
  assert.equal(probe.src, '/api/media/authorized?grant=test');
  probe.emit('loadedmetadata'); assert.equal(probe.currentTime, 1e7);
  probe.duration = 120; probe.emit('durationchange'); await flush();
  assert.equal(f.state.playlist.value[1].durationSec, 120);
  assert.equal(probe.src, ''); assert.equal(probe.events.size, 0);
  f.scope.stop(); assert.equal(f.timers.size, 0);
});

test('leaving a keep-alive page cancels duration probes and late events cannot resurrect timers', async () => {
  const f = fixture(); await f.state.loadPlaylist();
  f.playbackStore.slotAudio = { currentMediaId: 6, paused: false }; await flush();
  const probe = f.audio[0]; f.deactivate();
  probe.duration = 90; probe.emit('loadedmetadata'); await flush();
  assert.equal(f.timers.size, 0); assert.equal(probe.src, '');
  assert.equal(f.state.playlist.value[1].durationSec, null);
  f.activate(); f.playbackStore.slotAudio.currentMediaId = 5; await flush();
  assert.equal(f.timers.size, 1); f.scope.stop();
});

test('late playlist reads cannot restore another account data or replace a newer refresh', async () => {
  const f = fixture(); const reads = [];
  f.services.listPlaylist = () => new Promise(resolve => reads.push(resolve));
  const first = f.state.loadPlaylist(), second = f.state.loadPlaylist();
  reads[1]([f.rows[1]]); await second; reads[0]([f.rows[0]]); await first;
  assert.equal(f.state.playlist.value[0].id, 6);
  const old = f.state.loadPlaylist(); f.switchIdentity(); reads[2](f.rows); await old;
  assert.equal(f.state.playlist.value.length, 0);
  assert.equal(f.state.audioAssets.value.length, 0); f.scope.stop();
});

test('rename uses playlist item identity and does not rename the underlying media', async () => {
  const f = fixture(); await f.state.loadPlaylist();
  const item = f.state.playlist.value[0];
  await f.state.startRenamePl(item); f.state.plEditingText.value = '新版别名';
  await f.state.commitRenamePl(item);
  assert.ok(f.calls.some(call => JSON.stringify(call) === JSON.stringify(['rename', 10, '新版别名'])));
  assert.equal(item.id, 5); f.scope.stop();
});

test('failed stop keeps playlist and visual progress available; partial clear retains unconfirmed rows', async () => {
  const f = fixture(); await f.state.loadPlaylist();
  f.playbackStore.slotAudio = { currentMediaId: 5, paused: false }; await flush();
  f.tick(2000);
  f.playbackStore.stop = async () => { throw new Error('offline'); };
  await f.state.clearPlaylist();
  assert.equal(f.state.playlist.value.length, 2);
  assert.equal(f.calls.filter(call => call[0] === 'remove').length, 0);
  assert.equal(f.state.plProgress.value, 20); assert.equal(f.timers.size, 1);
  f.playbackStore.stop = async () => {};
  f.services.removeFromPlaylist = async id => { if (id === 11) throw new Error('delete failed'); };
  await f.state.clearPlaylist();
  assert.equal(f.state.playlist.value.length, 1);
  assert.equal(f.state.playlist.value[0].itemId, 11);
  assert.match(f.messages.at(-1)[1], /未删除的曲目已保留/);
  f.scope.stop();
});

test('clear is deduplicated and does not continue a sequential deletion after an account switch', async () => {
  const f = fixture(); await f.state.loadPlaylist(); let finish;
  f.services.removeFromPlaylist = id => { f.calls.push(['remove', id]); return new Promise(resolve => { finish = resolve; }); };
  const first = f.state.clearPlaylist(); await f.state.clearPlaylist();
  assert.equal(f.calls.filter(call => call[0] === 'remove').length, 1);
  f.switchIdentity(); finish(); await first;
  assert.equal(f.calls.filter(call => call[0] === 'remove').length, 1);
  assert.equal(f.state.playlist.value.length, 0); f.scope.stop();
});

test('confirmation from a previous account or page activation cannot delete a playlist item', async () => {
  for (const change of [f => f.switchIdentity(), f => { f.deactivate(); f.activate(); }]) {
    const f = fixture(); await f.state.loadPlaylist(); let confirm;
    f.dialog.confirm = () => new Promise(resolve => { confirm = resolve; });
    const pending = f.state.removeFromPlaylist(0);
    change(f); confirm(); await pending;
    assert.equal(f.calls.filter(call => call[0] === 'remove').length, 0);
    f.scope.stop();
  }
});

test('late mode-save rejection cannot overwrite a newer mode or leak into another account', async () => {
  const f = fixture(); const pending = [];
  f.services.setChannelPlayMode = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const first = f.state.setPlayModeAndSave('seq'), second = f.state.setPlayModeAndSave('shuffle');
  pending[1].resolve(); await second; pending[0].reject(new Error('old request')); await first;
  assert.equal(f.state.playMode.value, 'shuffle');
  const third = f.state.setPlayModeAndSave('loop1'); f.switchIdentity();
  pending[2].reject(new Error('prior account')); await third;
  assert.equal(f.state.playMode.value, 'loopAll'); assert.equal(f.messages.length, 0); f.scope.stop();
});
