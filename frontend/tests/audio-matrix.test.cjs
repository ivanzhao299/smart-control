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

function evaluate(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transpile(file), {
    module,
    exports: module.exports,
    require(id) {
      if (id in dependencies) return dependencies[id];
      throw new Error(id);
    },
    Map,
    Object,
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

function fakeScheduler() {
  let sequence = 0;
  const tasks = new Map();
  return {
    api: {
      schedule(callback, delayMs) {
        const id = ++sequence;
        tasks.set(id, { callback, delayMs });
        return id;
      },
      cancel(id) {
        tasks.delete(id);
      },
    },
    count(delayMs) {
      return [...tasks.values()].filter((task) => delayMs === undefined || task.delayMs === delayMs).length;
    },
    async run(delayMs) {
      const entry = [...tasks.entries()].find(([, task]) => task.delayMs === delayMs);
      assert.ok(entry, `missing timer ${delayMs}`);
      tasks.delete(entry[0]);
      await entry[1].callback();
      await settle();
    },
  };
}

function execute(identity) {
  const queue = evaluate(path.resolve(__dirname, '../src/features/latest-command-queue.ts'));
  const controller = evaluate(
    path.resolve(__dirname, '../src/features/audio-matrix-command-controller.ts'),
    { './latest-command-queue': queue },
  );
  return evaluate(
    path.resolve(__dirname, '../src/composables/useAudioMatrix.ts'),
    {
      vue,
      'element-plus': { ElMessage: {} },
      '@/services/audio.service': { audioService: {} },
      '@/features/audio-matrix-command-controller': controller,
      '@/services/identity-boundary': identity,
    },
  ).useAudioMatrix;
}

function snapshot(matrix) {
  return { ok: true, data: { matrix } };
}

function harness(overrides = {}) {
  const identity = identityBoundary();
  const scheduler = fakeScheduler();
  const errors = [];
  const writes = [];
  let hidden = false;
  const service = {
    getLiveMatrix: async () => snapshot([[false, true], [true, false]]),
    setMatrix: async (outChannel, inputChannel, on) => {
      writes.push([outChannel, inputChannel, on]);
      return { ok: true };
    },
    ...overrides.service,
  };
  const useAudioMatrix = execute(identity.api);
  const scope = vue.effectScope();
  const matrix = scope.run(() => useAudioMatrix({
    service,
    scheduler: scheduler.api,
    isDocumentHidden: () => hidden,
    messages: { error: (message) => errors.push(message) },
  }));
  return {
    matrix,
    identity,
    scheduler,
    scope,
    errors,
    writes,
    setHidden(value) { hidden = value; },
  };
}

test('latest device read wins and offline failures preserve the last truth', async () => {
  const oldRead = deferred();
  const newRead = deferred();
  let reads = 0;
  const h = harness({
    service: { getLiveMatrix: () => (++reads === 1 ? oldRead.promise : newRead.promise) },
  });
  const oldResult = h.matrix.loadMatrixState();
  const newResult = h.matrix.loadMatrixState();
  newRead.resolve(snapshot([[true, false]]));
  assert.equal(await newResult, true);
  oldRead.resolve(snapshot([[false, true]]));
  assert.equal(await oldResult, false);
  assert.equal(h.matrix.isMatrixOn(0, 0), true);
  assert.equal(h.matrix.isMatrixOn(0, 1), false);

  h.scope.stop();
  const offline = harness({
    service: { getLiveMatrix: async () => { throw new Error('EKX offline timeout'); } },
  });
  offline.matrix.matrixOn.value = { '0_0': true };
  assert.equal(await offline.matrix.loadMatrixState(), false);
  assert.equal(offline.matrix.matrixOn.value['0_0'], true);
  assert.equal(offline.matrix.matrixStale.value, true);
  assert.equal(offline.matrix.matrixOffline.value, true);
  assert.equal(offline.matrix.matrixErrMsg.value, 'EKX offline timeout');
  offline.scope.stop();
});

test('active polling skips hidden and writing states, refreshes on return, and stops cleanly', async () => {
  let reads = 0;
  const h = harness({ service: { getLiveMatrix: async () => { reads += 1; return snapshot([[true]]); } } });
  h.setHidden(true);
  h.matrix.startMatrixPolling();
  assert.equal(h.scheduler.count(8000), 1);
  await h.scheduler.run(8000);
  assert.equal(reads, 0);
  assert.equal(h.scheduler.count(8000), 1);

  h.setHidden(false);
  await h.scheduler.run(8000);
  assert.equal(reads, 1);
  h.matrix.stopMatrixPolling();
  assert.equal(h.scheduler.count(), 0);

  h.matrix.startMatrixPolling();
  await settle();
  assert.equal(reads, 2);
  h.matrix.stopMatrixPolling();
  h.scope.stop();
});

test('matrix writes keep the latest click and perform one deferred truth read', async () => {
  const gates = [];
  let reads = 0;
  const h = harness({
    service: {
      getLiveMatrix: async () => { reads += 1; return snapshot([[true, false]]); },
      setMatrix: (outChannel, inputChannel, on) => {
        h.writes.push([outChannel, inputChannel, on]);
        const gate = deferred();
        gates.push(gate);
        return gate.promise;
      },
    },
  });
  h.matrix.startMatrixPolling();
  h.matrix.matrixOn.value = { '0_1': false };
  assert.equal(h.matrix.toggleMatrix(0, 1), true);
  h.matrix.toggleMatrix(0, 1);
  h.matrix.toggleMatrix(0, 1);
  assert.deepEqual(h.writes, [[0, 1, true]]);
  assert.equal(h.matrix.pendingWrites.value, 1);

  gates[0].resolve({ ok: true });
  await settle();
  assert.deepEqual(h.writes, [[0, 1, true], [0, 1, true]]);
  gates[1].resolve({ ok: true });
  await settle();
  assert.equal(h.matrix.pendingWrites.value, 0);
  assert.equal(h.scheduler.count(1200), 1);
  await h.scheduler.run(1200);
  assert.equal(reads, 1);
  assert.equal(h.matrix.isMatrixOn(0, 0), true);
  h.scope.stop();
});

test('a current write failure rolls back, reports once, and immediately reloads device truth', async () => {
  const gate = deferred();
  let reads = 0;
  const h = harness({
    service: {
      getLiveMatrix: async () => { reads += 1; return snapshot([[false]]); },
      setMatrix: () => gate.promise,
    },
  });
  h.matrix.startMatrixPolling();
  h.matrix.matrixOn.value = { '0_0': false };
  h.matrix.toggleMatrix(0, 0);
  gate.reject(new Error('设备拒绝'));
  await settle();
  assert.equal(h.matrix.isMatrixOn(0, 0), false);
  assert.equal(h.errors[0], '路由 OUT1←IN1 失败: 设备拒绝');
  assert.equal(reads, 1);
  h.scope.stop();
});

test('identity and server changes suppress old queued writes and replace old server truth', async () => {
  const oldWrite = deferred();
  const nextRead = deferred();
  let reads = 0;
  let writes = 0;
  const h = harness({
    service: {
      getLiveMatrix: () => (++reads === 1
        ? Promise.resolve(snapshot([[false]]))
        : nextRead.promise),
      setMatrix: () => {
        writes += 1;
        return oldWrite.promise;
      },
    },
  });
  h.matrix.startMatrixPolling();
  await h.matrix.loadMatrixState();
  h.matrix.toggleMatrix(0, 0);
  h.matrix.toggleMatrix(0, 0);
  assert.equal(writes, 1);

  h.identity.changeServer();
  assert.deepEqual({ ...h.matrix.matrixOn.value }, {});
  oldWrite.reject(new Error('旧服务器失败'));
  nextRead.resolve(snapshot([[true]]));
  await settle();
  assert.equal(writes, 1);
  assert.equal(h.errors.length, 0);
  assert.equal(h.matrix.isMatrixOn(0, 0), true);
  h.scope.stop();
});

test('scope disposal cancels timers and suppresses late device reads', async () => {
  const read = deferred();
  const h = harness({ service: { getLiveMatrix: () => read.promise } });
  h.matrix.startMatrixPolling();
  const pending = h.matrix.loadMatrixState();
  h.scope.stop();
  assert.equal(h.scheduler.count(), 0);
  read.resolve(snapshot([[true]]));
  assert.equal(await pending, false);
  assert.deepEqual({ ...h.matrix.matrixOn.value }, {});
});

test('AudioPage delegates matrix truth, commands, reconciliation, and polling', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/AudioPage.vue'), 'utf8');
  const composable = fs.readFileSync(path.resolve(__dirname, '../src/composables/useAudioMatrix.ts'), 'utf8');
  assert.match(page, /useAudioMatrix\(\)/);
  assert.doesNotMatch(page, /getLiveMatrix\(|setMatrix\(|createAudioMatrixCommandController/);
  assert.doesNotMatch(page, /matrixTimer|reconcileTimer|pendingWrites|matrixOn/);
  assert.match(composable, /createLatestIdentityRead/);
  assert.match(composable, /captureCurrent/);
  assert.match(composable, /startMatrixPolling/);
});
