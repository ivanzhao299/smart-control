const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function loadModule(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transpile(file), {
    module,
    exports: module.exports,
    require(id) {
      if (id in dependencies) return dependencies[id];
      throw new Error(id);
    },
    Map,
    Set,
    Promise,
    JSON,
    Number,
    Error,
  });
  return module.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function settle(rounds = 6) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function identityBoundary() {
  let generation = 0;
  const listeners = new Set();
  const serverListeners = new Set();
  return {
    api: {
      captureIdentityGuard(active = () => true) {
        const expected = generation;
        return () => expected === generation && active();
      },
      onIdentityChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onServerChange(listener) {
        serverListeners.add(listener);
        return () => serverListeners.delete(listener);
      },
    },
    invalidate() {
      generation += 1;
      for (const listener of [...listeners]) listener();
    },
    changeServer() {
      for (const listener of [...serverListeners]) listener();
      this.invalidate();
    },
  };
}

function execute(identity) {
  const queue = loadModule(path.resolve(__dirname, '../src/features/latest-command-queue.ts'));
  const viewModel = loadModule(path.resolve(__dirname, '../src/features/audio-view-model.ts'));
  return loadModule(
    path.resolve(__dirname, '../src/composables/useAudioOutputControls.ts'),
    {
      vue,
      'element-plus': { ElMessage: {}, ElMessageBox: { confirm: async () => {} } },
      '@/services/audio.service': { audioService: {} },
      '@/features/audio-view-model': viewModel,
      '@/features/latest-command-queue': queue,
      '@/services/identity-boundary': identity,
      './useAudioOutputCatalog': {},
    },
  ).useAudioOutputControls;
}

function row(index, options = {}) {
  return {
    dbId: index + 1,
    id: `audio_out${index + 1}`,
    name: options.name || `OUT${index + 1}`,
    zone: `out${index + 1}`,
    channel: index,
    volume: options.volume ?? 50,
    muted: options.muted ?? false,
    bgm: '',
    bgmPlaying: false,
    mic: false,
    busy: false,
    error: null,
  };
}

function harness(options = {}) {
  const identity = identityBoundary();
  const channels = vue.ref(options.channels || [row(0), row(1)]);
  const sent = [];
  const messages = { success: [], warning: [], error: [] };
  const storageState = new Map(Object.entries(options.storage || {}));
  const delays = [];
  const service = {
    setVolume: async (id, value, zone) => {
      sent.push(['volume', id, value, zone]);
      return { ok: true };
    },
    mute: async (id, zone) => {
      sent.push(['mute', id, zone]);
      return { ok: true };
    },
    unmute: async (id, zone) => {
      sent.push(['unmute', id, zone]);
      return { ok: true };
    },
    ...options.service,
  };
  const useControls = execute(identity.api);
  const scope = vue.effectScope();
  const controls = scope.run(() => useControls({
    channels,
    partnerOf: (target) => {
      if (target.id === channels.value[0]?.id) return channels.value[1];
      if (target.id === channels.value[1]?.id) return channels.value[0];
      return undefined;
    },
    linkOn: () => options.linked !== false,
    service,
    messages: {
      success: (message) => messages.success.push(message),
      warning: (message) => messages.warning.push(message),
      error: (message) => messages.error.push(message),
    },
    confirm: options.confirm || (async () => {}),
    storage: {
      getItem: (key) => storageState.get(key) ?? null,
      setItem: (key, value) => storageState.set(key, value),
    },
    documentPort: options.documentPort,
    scheduler: options.scheduler || {
      delay: () => {
        const gate = deferred();
        delays.push(gate);
        return gate.promise;
      },
    },
  }));
  return { channels, controls, delays, identity, messages, scope, sent, storageState };
}

test('restores only valid persisted channel state and keeps safe defaults for corrupt entries', () => {
  const h = harness({
    storage: {
      audio_mute_state_v1: JSON.stringify({
        audio_out1: { muted: true, volume: 72 },
        audio_out2: { muted: 'yes', volume: 300 },
      }),
    },
  });
  h.controls.restoreOutputState();
  assert.equal(h.channels.value[0].muted, true);
  assert.equal(h.channels.value[0].volume, 72);
  assert.equal(h.channels.value[1].muted, false);
  assert.equal(h.channels.value[1].volume, 50);
  h.scope.stop();
});

test('linked fader sends first and latest values per output without replaying intermediates', async () => {
  const gates = [];
  const h = harness({
    service: {
      setVolume(id, value, zone) {
        h.sent.push(['volume', id, value, zone]);
        const gate = deferred();
        gates.push(gate);
        return gate.promise;
      },
    },
  });
  h.controls.setFaderValue(h.channels.value[0], 10);
  h.controls.setFaderValue(h.channels.value[0], 20);
  h.controls.setFaderValue(h.channels.value[0], 30);
  assert.deepEqual(h.sent.map((entry) => entry.slice(1, 3)), [
    ['audio_out1', 10],
    ['audio_out2', 10],
  ]);
  gates[0].resolve({ ok: true });
  gates[1].resolve({ ok: true });
  await settle();
  assert.deepEqual(h.sent.map((entry) => entry.slice(1, 3)), [
    ['audio_out1', 10],
    ['audio_out2', 10],
    ['audio_out1', 30],
    ['audio_out2', 30],
  ]);
  gates[2].resolve({ ok: true });
  gates[3].resolve({ ok: true });
  await settle();
  h.scope.stop();
});

test('identity change drops queued fader values and suppresses stale device errors', async () => {
  const first = deferred();
  const h = harness({
    service: {
      setVolume(id, value, zone) {
        h.sent.push(['volume', id, value, zone]);
        return first.promise;
      },
    },
    linked: false,
  });
  h.controls.setFaderValue(h.channels.value[0], 10);
  h.controls.setFaderValue(h.channels.value[0], 80);
  h.identity.invalidate();
  first.reject(new Error('旧服务器离线'));
  await settle();
  assert.deepEqual(h.sent.map((entry) => entry[2]), [10]);
  assert.equal(h.channels.value[0].error, null);
  assert.equal(h.messages.error.length, 0);
  h.scope.stop();
});

test('a stale mute completion cannot unlock a newer operation for the same channel', async () => {
  const gates = [deferred(), deferred()];
  let calls = 0;
  const h = harness({
    channels: [row(0)],
    linked: false,
    service: {
      mute(id, zone) {
        h.sent.push(['mute', id, zone]);
        return gates[calls++].promise;
      },
    },
  });
  const oldMute = h.controls.toggleMute(h.channels.value[0]);
  h.identity.invalidate();
  const currentMute = h.controls.toggleMute(h.channels.value[0]);
  gates[0].resolve({ ok: true });
  assert.equal(await oldMute, false);
  assert.equal(await h.controls.toggleMute(h.channels.value[0]), false);
  assert.equal(h.sent.length, 2);
  gates[1].resolve({ ok: true });
  assert.equal(await currentMute, true);
  assert.equal(h.channels.value[0].muted, true);
  h.scope.stop();
});

test('stereo mute reports partial failure and keeps each channel at its confirmed result', async () => {
  const h = harness({
    service: {
      mute: async (id, zone) => {
        h.sent.push(['mute', id, zone]);
        return id === 'audio_out1' ? { ok: true } : { ok: false, error: '右声道离线' };
      },
    },
  });
  assert.equal(await h.controls.toggleMute(h.channels.value[0]), false);
  assert.equal(h.channels.value[0].muted, true);
  assert.equal(h.channels.value[1].muted, false);
  assert.equal(h.channels.value[1].error, '右声道离线');
  assert.equal(h.messages.success.length, 0);
  assert.equal(h.messages.warning[0], 'OUT1 部分声道静音失败，请按当前状态重试');
  h.scope.stop();
});

test('bulk mute waits for every channel and never claims full success after a partial failure', async () => {
  const h = harness({
    service: {
      mute: async (id, zone) => {
        h.sent.push(['mute', id, zone]);
        return id === 'audio_out2' ? { ok: false, error: '设备拒绝' } : { ok: true };
      },
    },
  });
  assert.equal(await h.controls.toggleMuteAll(), false);
  assert.equal(h.channels.value[0].muted, true);
  assert.equal(h.channels.value[1].muted, false);
  assert.equal(h.messages.success.length, 0);
  assert.equal(h.messages.warning[0], '静音部分成功，失败通道已保留原状态');
  h.scope.stop();
});

test('bulk confirmation cannot cross an identity change and control the next session', async () => {
  const confirmation = deferred();
  const h = harness({ confirm: () => confirmation.promise });
  const pending = h.controls.toggleMuteAll();
  h.identity.invalidate();
  confirmation.resolve();
  assert.equal(await pending, false);
  assert.equal(h.sent.length, 0);
  assert.equal(h.messages.success.length, 0);
  h.scope.stop();
});

test('identity change stops a running fade before another device step is sent', async () => {
  const saved = JSON.stringify({
    audio_out1: { muted: true, volume: 50 },
    audio_out2: { muted: true, volume: 40 },
  });
  const h = harness({
    channels: [row(0, { muted: true }), row(1, { muted: true })],
    storage: { audio_mute_state_v1: saved },
  });
  h.controls.restoreOutputState();
  assert.equal(await h.controls.toggleMute(h.channels.value[0]), true);
  await settle();
  const before = h.sent.filter((entry) => entry[0] === 'volume').length;
  assert.equal(before, 4);
  h.identity.invalidate();
  h.delays[0].resolve();
  await settle();
  assert.equal(h.sent.filter((entry) => entry[0] === 'volume').length, before);
  assert.equal(h.messages.error.length, 0);
  h.scope.stop();
});

test('AudioPage delegates output commands, mute, fade and drag cleanup to the composable', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/AudioPage.vue'), 'utf8');
  const composable = fs.readFileSync(path.resolve(__dirname, '../src/composables/useAudioOutputControls.ts'), 'utf8');
  assert.match(page, /useAudioOutputControls\(\{ channels, partnerOf, linkOn \}\)/);
  assert.doesNotMatch(page, /createLatestCommandQueue<string, OutputVolumeCommand>/);
  assert.doesNotMatch(page, /async function fadeInVolumes/);
  assert.doesNotMatch(page, /localStorage\.getItem\(MUTE_STATE_KEY\)/);
  assert.match(composable, /function stopOutputControls/);
  assert.match(composable, /onIdentityChange\(stopOutputControls\)/);
  assert.match(composable, /onServerChange/);
});
