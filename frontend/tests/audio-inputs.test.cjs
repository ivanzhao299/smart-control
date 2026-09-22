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
    Promise,
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
      createLatestIdentityRead(active = () => true) {
        let revision = 0;
        return () => {
          const expectedRevision = ++revision;
          const expectedIdentity = generation;
          return () => expectedIdentity === generation && expectedRevision === revision && active();
        };
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
  const queue = loadModule(
    path.resolve(__dirname, '../src/features/latest-command-queue.ts'),
  );
  const viewModel = loadModule(
    path.resolve(__dirname, '../src/features/audio-view-model.ts'),
  );
  return loadModule(
    path.resolve(__dirname, '../src/composables/useAudioInputs.ts'),
    {
      vue,
      'element-plus': { ElMessage: {} },
      '@/services/audio.service': { audioService: {} },
      '@/services/audio-config.service': { audioConfigService: {} },
      '@/features/audio-view-model': viewModel,
      '@/features/latest-command-queue': queue,
      '@/services/identity-boundary': identity,
    },
  ).useAudioInputs;
}

function source(id, channel, name) {
  return {
    id,
    channel,
    name,
    color: null,
    sortOrder: channel,
    enabled: true,
  };
}

function live(channels) {
  return { ok: true, data: { channels } };
}

function harness(overrides = {}) {
  const identity = identityBoundary();
  const errors = [];
  const sent = [];
  const catalogService = {
    readInputs: async () => [source(1, 0, '无线话筒'), source(2, 1, '有线话筒')],
    ...overrides.catalogService,
  };
  const controlService = {
    getLiveInputs: async () => live([
      { ch: 0, gainDb: -10, muted: false },
      { ch: 1, gainDb: null, muted: null },
    ]),
    setInputVolume: async (channel, value) => {
      sent.push([channel, value]);
      return { ok: true };
    },
    ...overrides.controlService,
  };
  const useAudioInputs = execute(identity.api);
  const scope = vue.effectScope();
  const inputs = scope.run(() => useAudioInputs({
    catalogService,
    controlService,
    messages: { error: (message) => errors.push(message) },
  }));
  return { inputs, identity, scope, errors, sent };
}

test('latest catalog and live reads win and preserve the existing device mapping', async () => {
  const oldCatalog = deferred();
  const newCatalog = deferred();
  const oldLive = deferred();
  const newLive = deferred();
  let catalogReads = 0;
  let liveReads = 0;
  const h = harness({
    catalogService: { readInputs: () => (++catalogReads === 1 ? oldCatalog.promise : newCatalog.promise) },
    controlService: { getLiveInputs: () => (++liveReads === 1 ? oldLive.promise : newLive.promise) },
  });

  const oldCatalogResult = h.inputs.loadInputs();
  const newCatalogResult = h.inputs.loadInputs();
  const oldLiveResult = h.inputs.loadInputChannels();
  const newLiveResult = h.inputs.loadInputChannels();
  newCatalog.resolve([source(8, 4, '背景音乐')]);
  newLive.resolve(live([
    { ch: 4, gainDb: 1.5, muted: false },
    { ch: 5, gainDb: null, muted: null },
  ]));
  assert.equal(await newCatalogResult, true);
  assert.equal(await newLiveResult, true);
  oldCatalog.resolve([source(1, 0, '旧服务器输入')]);
  oldLive.resolve(live([{ ch: 0, gainDb: -60, muted: true }]));
  assert.equal(await oldCatalogResult, false);
  assert.equal(await oldLiveResult, false);

  assert.deepEqual(h.inputs.inputs.value.map((row) => [row.channel, row.name]), [[4, '背景音乐']]);
  assert.equal(h.inputs.inputGainDb.value[4], 1.5);
  assert.equal(h.inputs.inputMuted.value[4], false);
  assert.equal(h.inputs.inputGainOf(4), 76);
  assert.equal(h.inputs.inputGainLabel(4), '+1.5 dB');
  assert.equal(h.inputs.inputGainOf(5), 0);
  assert.equal(h.inputs.inputGainLabel(5), '—');
  assert.equal(h.inputs.inputsLoading.value, false);
  h.scope.stop();
});

test('same-channel dragging sends the first and latest values while channels stay independent', async () => {
  const gates = [];
  const h = harness({
    controlService: {
      setInputVolume: (channel, value) => {
        h.sent.push([channel, value]);
        const gate = deferred();
        gates.push(gate);
        return gate.promise;
      },
    },
  });

  h.inputs.onInputGain(0, 10);
  h.inputs.onInputGain(0, 20);
  h.inputs.onInputGain(0, 30);
  h.inputs.onInputGain(1, 75);
  assert.deepEqual(h.sent, [[0, 10], [1, 75]]);
  assert.equal(h.inputs.inputGainDb.value[0], -30);
  assert.equal(h.inputs.inputGainDb.value[1], 1);

  gates[0].resolve({ ok: true });
  await settle();
  assert.deepEqual(h.sent, [[0, 10], [1, 75], [0, 30]]);
  gates[1].resolve({ ok: true });
  gates[2].resolve({ ok: true });
  await settle();
  h.scope.stop();
});

test('identity change reloads truth, drops queued writes, and suppresses stale errors', async () => {
  const oldWrite = deferred();
  let writes = 0;
  const h = harness({
    catalogService: { readInputs: async () => [source(9, 2, '新身份输入')] },
    controlService: {
      getLiveInputs: async () => live([{ ch: 2, gainDb: 3, muted: false }]),
      setInputVolume: () => {
        writes += 1;
        return oldWrite.promise;
      },
    },
  });

  h.inputs.onInputGain(0, 40);
  h.inputs.onInputGain(0, 60);
  assert.equal(writes, 1);
  h.identity.invalidate();
  await settle();
  oldWrite.reject(new Error('旧身份设备离线'));
  await settle();

  assert.equal(writes, 1);
  assert.equal(h.errors.length, 0);
  assert.equal(h.inputs.inputs.value[0].name, '新身份输入');
  assert.equal(h.inputs.inputGainDb.value[2], 3);
  h.scope.stop();
});

test('server change clears visible old data before fresh direct reads commit', async () => {
  const nextCatalog = deferred();
  const nextLive = deferred();
  let catalogReads = 0;
  let liveReads = 0;
  const h = harness({
    catalogService: {
      readInputs: () => (++catalogReads === 1
        ? Promise.resolve([source(1, 0, '旧服务器')])
        : nextCatalog.promise),
    },
    controlService: {
      getLiveInputs: () => (++liveReads === 1
        ? Promise.resolve(live([{ ch: 0, gainDb: -10, muted: false }]))
        : nextLive.promise),
    },
  });
  await h.inputs.loadInputs();
  await h.inputs.loadInputChannels();

  h.identity.changeServer();
  assert.equal(h.inputs.inputs.value.length, 0);
  assert.deepEqual({ ...h.inputs.inputGainDb.value }, {});
  assert.equal(h.inputs.inputsLoading.value, true);
  nextCatalog.resolve([source(2, 3, '新服务器')]);
  nextLive.resolve(live([{ ch: 3, gainDb: 0, muted: true }]));
  await settle();
  assert.equal(h.inputs.inputs.value[0].name, '新服务器');
  assert.equal(h.inputs.inputGainDb.value[3], 0);
  assert.equal(h.inputs.inputMuted.value[3], true);
  h.scope.stop();
});

test('scope disposal suppresses late reads, writes, and messages', async () => {
  const catalog = deferred();
  const liveRead = deferred();
  const write = deferred();
  const h = harness({
    catalogService: { readInputs: () => catalog.promise },
    controlService: {
      getLiveInputs: () => liveRead.promise,
      setInputVolume: () => write.promise,
    },
  });
  const catalogResult = h.inputs.loadInputs();
  const liveResult = h.inputs.loadInputChannels();
  h.inputs.onInputGain(0, 50);
  h.scope.stop();
  catalog.resolve([source(1, 0, '迟到目录')]);
  liveRead.resolve(live([{ ch: 0, gainDb: -10, muted: false }]));
  write.reject(new Error('迟到错误'));
  assert.equal(await catalogResult, false);
  assert.equal(await liveResult, false);
  await settle();
  assert.equal(h.inputs.inputs.value.length, 0);
  assert.equal(h.errors.length, 0);
});

test('AudioPage delegates the input boundary and keeps only output-volume queueing', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/AudioPage.vue'), 'utf8');
  const composable = fs.readFileSync(path.resolve(__dirname, '../src/composables/useAudioInputs.ts'), 'utf8');
  const service = fs.readFileSync(path.resolve(__dirname, '../src/services/audio-config.service.ts'), 'utf8');
  assert.match(page, /useAudioInputs\(\)/);
  assert.doesNotMatch(page, /audioConfigService\.listInputs|getLiveInputs\(|setInputVolume\(/);
  assert.doesNotMatch(page, /createLatestCommandQueue<number,/);
  assert.match(composable, /createLatestCommandQueue<number, InputGainCommand>/);
  assert.match(composable, /createLatestIdentityRead/);
  assert.match(composable, /onServerChange/);
  assert.match(service, /readInputs: \(includeDisabled = false\) => fetchInputs\(includeDisabled\)/);
});
