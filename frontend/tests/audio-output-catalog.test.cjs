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
          const expected = ++revision;
          const identity = generation;
          return () => identity === generation && expected === revision && active();
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
  const modelModule = { exports: {} };
  vm.runInNewContext(
    transpile(path.resolve(__dirname, '../src/features/audio-view-model.ts')),
    { module: modelModule, exports: modelModule.exports, require, Map },
  );
  const module = { exports: {} };
  vm.runInNewContext(
    transpile(path.resolve(__dirname, '../src/composables/useAudioOutputCatalog.ts')),
    {
      module,
      exports: module.exports,
      Promise,
      Map,
      Set,
      require(id) {
        if (id === 'vue') return vue;
        if (id === 'element-plus') return { ElMessage: {} };
        if (id === '@/services/audio-config.service') return { audioConfigService: {} };
        if (id === '@/features/audio-view-model') return modelModule.exports;
        if (id === '@/services/identity-boundary') return identity;
        throw new Error(id);
      },
    },
  );
  return module.exports.useAudioOutputCatalog;
}

function zone(id, channel, name) {
  return {
    id,
    channel,
    name,
    floor: '1F',
    color: null,
    sortOrder: channel,
    enabled: true,
  };
}

const initialZones = [
  zone(11, 0, 'LED大屏·左'),
  zone(12, 1, 'LED大屏·右'),
  zone(13, 2, '发布厅'),
];

function harness(serviceOverrides = {}, options = {}) {
  const identity = identityBoundary();
  const successes = [];
  const warnings = [];
  const errors = [];
  const updates = [];
  const service = {
    listZones: async () => initialZones.map((row) => ({ ...row })),
    updateZone: async (id, patch) => {
      updates.push([id, patch.name]);
      return { ...initialZones.find((row) => row.id === id), ...patch };
    },
    ...serviceOverrides,
  };
  const useCatalog = execute(identity.api);
  const scope = vue.effectScope();
  const catalog = scope.run(() => useCatalog({
    ensureAdmin: options.ensureAdmin || (async () => true),
    service,
    messages: {
      success: (message) => successes.push(message),
      warning: (message) => warnings.push(message),
      error: (message) => errors.push(message),
    },
  }));
  return { catalog, identity, scope, successes, warnings, errors, updates };
}

test('latest directory read wins and maps the existing output contract', async () => {
  const first = deferred();
  const second = deferred();
  let reads = 0;
  const h = harness({ listZones: () => (++reads === 1 ? first.promise : second.promise) });
  const oldRead = h.catalog.loadOutputChannels();
  const newRead = h.catalog.loadOutputChannels();
  second.resolve([zone(21, 4, '花园')]);
  assert.equal(await newRead, true);
  first.resolve(initialZones);
  assert.equal(await oldRead, false);
  assert.equal(h.catalog.channels.value.length, 1);
  assert.equal(h.catalog.channels.value[0].id, 'audio_out5');
  assert.equal(h.catalog.channels.value[0].zone, 'out5');
  assert.equal(h.catalog.channels.value[0].volume, 50);
  h.scope.stop();
});

test('stereo projection and link mode stay in one catalog boundary', async () => {
  const h = harness();
  await h.catalog.loadOutputChannels();
  const left = h.catalog.channels.value[0];
  const right = h.catalog.channels.value[1];
  assert.equal(h.catalog.displayChannels.value.map((row) => row.id).join(','), 'audio_out1,audio_out3');
  assert.equal(h.catalog.partnerOf(left).id, right.id);
  assert.equal(h.catalog.displayName(left), 'LED大屏');
  assert.equal(h.catalog.displayAddress(left), 'AUDIO_OUT1+2');
  assert.equal(h.catalog.stereoRows(left).map((row) => row.id).join(','), 'audio_out1,audio_out2');
  assert.equal(h.catalog.linkOn(right), true);
  h.catalog.setLink(right, false);
  assert.equal(h.catalog.linkOn(left), false);
  h.scope.stop();
});

test('administrator denial leaves the editor and service untouched', async () => {
  const h = harness({}, { ensureAdmin: async () => false });
  await h.catalog.loadOutputChannels();
  assert.equal(await h.catalog.startRenameChannel(h.catalog.channels.value[0]), false);
  assert.equal(h.catalog.editingChannelId.value, null);
  assert.equal(h.updates.length, 0);
  h.scope.stop();
});

test('single-channel enter and blur commit only one request', async () => {
  const h = harness();
  await h.catalog.loadOutputChannels();
  const row = h.catalog.channels.value[2];
  assert.equal(await h.catalog.startRenameChannel(row), true);
  h.catalog.editingChannelText.value = '贵宾厅';
  const first = h.catalog.commitRenameChannel(row);
  const duplicate = h.catalog.commitRenameChannel(row);
  assert.equal(await duplicate, false);
  assert.equal(await first, true);
  assert.equal(h.updates.map(([id, name]) => `${id}:${name}`).join(','), '13:贵宾厅');
  assert.equal(row.name, '贵宾厅');
  assert.equal(h.successes.length, 1);
  h.scope.stop();
});

test('stereo rename dispatches both stable targets and preserves suffixes', async () => {
  const gates = new Map([[11, deferred()], [12, deferred()]]);
  const sent = [];
  const h = harness({
    updateZone(id, patch) {
      sent.push([id, patch.name]);
      return gates.get(id).promise;
    },
  });
  await h.catalog.loadOutputChannels();
  const left = h.catalog.channels.value[0];
  await h.catalog.startRenameChannel(left);
  h.catalog.editingChannelText.value = '主屏';
  const pending = h.catalog.commitRenameChannel(left);
  await settle();
  assert.deepEqual(sent, [[11, '主屏·左'], [12, '主屏·右']]);
  gates.get(11).resolve(zone(11, 0, '主屏·左'));
  gates.get(12).resolve(zone(12, 1, '主屏·右'));
  assert.equal(await pending, true);
  assert.equal(h.catalog.channels.value.slice(0, 2).map((row) => row.name).join(','), '主屏·左,主屏·右');
  assert.equal(h.successes.length, 1);
  h.scope.stop();
});

test('partial stereo save reloads authoritative names instead of a false rollback', async () => {
  let reads = 0;
  const h = harness({
    listZones: async () => {
      reads += 1;
      return reads === 1
        ? initialZones.map((row) => ({ ...row }))
        : [zone(11, 0, '主屏·左'), zone(12, 1, 'LED大屏·右'), zone(13, 2, '发布厅')];
    },
    updateZone: async (id, patch) => {
      if (id === 12) throw new Error('右声道保存失败');
      return { ...zone(id, id === 11 ? 0 : 1, patch.name) };
    },
  });
  await h.catalog.loadOutputChannels();
  const left = h.catalog.channels.value[0];
  await h.catalog.startRenameChannel(left);
  h.catalog.editingChannelText.value = '主屏';
  assert.equal(await h.catalog.commitRenameChannel(left), false);
  assert.equal(h.catalog.channels.value.slice(0, 2).map((row) => row.name).join(','), '主屏·左,LED大屏·右');
  assert.equal(h.successes.length, 0);
  assert.equal(h.warnings[0], '部分通道改名已提交，已按服务端结果刷新');
  h.scope.stop();
});

test('identity change preserves runtime controls, refreshes names, and suppresses stale success', async () => {
  const pending = deferred();
  let reads = 0;
  const h = harness({
    listZones: async () => (++reads === 1
      ? initialZones
      : [zone(11, 0, '主屏·左'), zone(12, 1, '主屏·右'), zone(13, 2, '发布厅新名')]),
    updateZone: () => pending.promise,
  });
  await h.catalog.loadOutputChannels();
  const oldRow = h.catalog.channels.value[2];
  oldRow.volume = 73;
  oldRow.muted = true;
  await h.catalog.startRenameChannel(oldRow);
  h.catalog.editingChannelText.value = '旧请求';
  const oldSave = h.catalog.commitRenameChannel(oldRow);
  await settle();
  h.identity.invalidate();
  await settle();
  assert.equal(h.catalog.channels.value[0].name, '主屏·左');
  assert.equal(h.catalog.channels.value[2].name, '发布厅新名');
  assert.equal(h.catalog.channels.value[2].volume, 73);
  assert.equal(h.catalog.channels.value[2].muted, true);
  pending.resolve(zone(13, 2, '旧请求'));
  assert.equal(await oldSave, false);
  assert.equal(h.catalog.channels.value[2].name, '发布厅新名');
  assert.equal(h.successes.length, 0);
  h.scope.stop();
});

test('server change clears runtime controls and stereo preferences before loading new catalog', async () => {
  let reads = 0;
  const h = harness({
    listZones: async () => (++reads === 1
      ? initialZones
      : [zone(41, 0, '新服屏·左'), zone(42, 1, '新服屏·右')]),
  });
  await h.catalog.loadOutputChannels();
  const oldLeft = h.catalog.channels.value[0];
  oldLeft.volume = 82;
  oldLeft.muted = true;
  h.catalog.setLink(oldLeft, false);
  assert.equal(h.catalog.linkOn(oldLeft), false);

  h.identity.changeServer();
  await settle();

  const newLeft = h.catalog.channels.value[0];
  assert.equal(newLeft.name, '新服屏·左');
  assert.equal(newLeft.volume, 50);
  assert.equal(newLeft.muted, false);
  assert.equal(h.catalog.linkOn(newLeft), true);
  h.scope.stop();
});

test('scope disposal rolls back optimism and suppresses completion messages', async () => {
  const pending = deferred();
  const h = harness({ updateZone: () => pending.promise });
  await h.catalog.loadOutputChannels();
  const row = h.catalog.channels.value[2];
  await h.catalog.startRenameChannel(row);
  h.catalog.editingChannelText.value = '临时名';
  const save = h.catalog.commitRenameChannel(row);
  await settle();
  assert.equal(row.name, '临时名');
  h.scope.stop();
  assert.equal(row.name, '发布厅');
  pending.resolve(zone(13, 2, '临时名'));
  assert.equal(await save, false);
  assert.equal(h.successes.length, 0);
});
