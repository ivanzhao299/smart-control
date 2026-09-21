const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/features/latest-command-queue.ts'),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require, Map, Promise });
  return module.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

const { createLatestCommandQueue } = load();

test('sends the first value immediately and only the latest value waiting for the same key', async () => {
  const gates = [];
  const sent = [];
  const queue = createLatestCommandQueue({
    execute: (key, value) => {
      sent.push([key, value]);
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    },
  });

  queue.enqueue('out1', 10);
  queue.enqueue('out1', 20);
  queue.enqueue('out1', 30);
  assert.deepEqual(sent, [['out1', 10]]);
  assert.equal(queue.isRunning('out1'), true);

  gates[0].resolve();
  await settle();
  assert.deepEqual(sent, [['out1', 10], ['out1', 30]]);

  gates[1].resolve();
  await settle();
  assert.equal(queue.isRunning('out1'), false);
});

test('serializes each key independently', async () => {
  const gates = new Map();
  const sent = [];
  const queue = createLatestCommandQueue({
    execute: (key, value) => {
      sent.push([key, value]);
      const gate = deferred();
      gates.set(key, gate);
      return gate.promise;
    },
  });

  queue.enqueue('left', 25);
  queue.enqueue('right', 75);
  assert.deepEqual(sent, [['left', 25], ['right', 75]]);

  gates.get('left').resolve();
  gates.get('right').resolve();
  await settle();
  assert.equal(queue.isRunning('left'), false);
  assert.equal(queue.isRunning('right'), false);
});

test('reports success for every dispatched value', async () => {
  const succeeded = [];
  const queue = createLatestCommandQueue({
    execute: async () => {},
    onSuccess: (key, value) => succeeded.push([key, value]),
  });

  queue.enqueue(1, 45);
  await settle();
  assert.deepEqual(succeeded, [[1, 45]]);
  assert.equal(queue.isRunning(1), false);
});

test('reports one active lifecycle for a coalesced run', async () => {
  const first = deferred();
  const events = [];
  const queue = createLatestCommandQueue({
    execute: async (_key, value) => {
      if (value === 10) await first.promise;
    },
    onStart: (key) => events.push(`start:${key}`),
    onIdle: (key) => events.push(`idle:${key}`),
  });

  queue.enqueue('out3', 10);
  queue.enqueue('out3', 20);
  assert.deepEqual(events, ['start:out3']);
  first.resolve();
  await settle();
  assert.deepEqual(events, ['start:out3', 'idle:out3']);
});

test('stops a failed key, drops its stale wait, and restarts on the next enqueue', async () => {
  const first = deferred();
  const sent = [];
  const errors = [];
  let attempt = 0;
  const queue = createLatestCommandQueue({
    execute: async (key, value) => {
      sent.push([key, value]);
      attempt += 1;
      if (attempt === 1) await first.promise;
    },
    onError: (key, error, value) => errors.push([key, value, error.message]),
  });

  queue.enqueue('out2', 10);
  queue.enqueue('out2', 20);
  first.reject(new Error('device offline'));
  await settle();

  assert.deepEqual(sent, [['out2', 10]]);
  assert.deepEqual(errors, [['out2', 10, 'device offline']]);
  assert.equal(queue.isRunning('out2'), false);

  queue.enqueue('out2', 30);
  await settle();
  assert.deepEqual(sent, [['out2', 10], ['out2', 30]]);
  assert.equal(queue.isRunning('out2'), false);
});

test('AudioPage uses the shared queue for input gain and output volume', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/AudioPage.vue'), 'utf8');
  assert.match(page, /from '@\/features\/latest-command-queue'/);
  assert.match(page, /createLatestCommandQueue<number, number>/);
  assert.match(page, /createLatestCommandQueue<string, OutputVolumeCommand>/);
  assert.doesNotMatch(page, /const gainSend: Record/);
  assert.doesNotMatch(page, /const volSend: Record/);
});
