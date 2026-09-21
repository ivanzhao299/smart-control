const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function evaluate(source, customRequire = require) {
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: customRequire, Map, Object, Promise });
  return module.exports;
}

function load() {
  const queue = evaluate(transpile(path.resolve(__dirname, '../src/features/latest-command-queue.ts')));
  return evaluate(
    transpile(path.resolve(__dirname, '../src/features/audio-matrix-command-controller.ts')),
    (specifier) => specifier === './latest-command-queue' ? queue : require(specifier),
  );
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

function harness(initial = false) {
  const values = { '0_1': initial };
  const sent = [];
  const gates = [];
  const errors = [];
  const activity = [];
  const { createAudioMatrixCommandController } = load();
  const controller = createAudioMatrixCommandController({
    read: (key) => values[key] ?? false,
    apply: (key, value) => { values[key] = value; },
    execute: (key, value) => {
      sent.push([key, value]);
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    },
    onStart: (key) => activity.push(`start:${key}`),
    onError: (key, error) => errors.push([key, error.message]),
    onIdle: (key) => activity.push(`idle:${key}`),
  });
  controller.confirmSnapshot(values);
  return { controller, values, sent, gates, errors, activity };
}

test('optimistically toggles and keeps only the latest click behind the in-flight command', async () => {
  const h = harness(false);
  assert.equal(h.controller.toggle('0_1'), true);
  assert.equal(h.values['0_1'], true);
  h.controller.toggle('0_1');
  h.controller.toggle('0_1');
  assert.deepEqual(h.sent, [['0_1', true]]);
  assert.deepEqual(h.activity, ['start:0_1']);

  h.gates[0].resolve();
  await settle();
  assert.deepEqual(h.sent, [['0_1', true], ['0_1', true]]);
  h.gates[1].resolve();
  await settle();
  assert.deepEqual(h.activity, ['start:0_1', 'idle:0_1']);
});

test('rolls a failed later click back to the last device-confirmed value', async () => {
  const h = harness(false);
  h.controller.toggle('0_1');
  h.controller.toggle('0_1');
  h.gates[0].resolve();
  await settle();
  assert.deepEqual(h.sent, [['0_1', true], ['0_1', false]]);

  h.gates[1].reject(new Error('device rejected'));
  await settle();
  assert.equal(h.values['0_1'], true);
  assert.deepEqual(h.errors, [['0_1', 'device rejected']]);
  assert.deepEqual(h.activity, ['start:0_1', 'idle:0_1']);
});

test('a failed first command drops its pending click and restores the readback snapshot', async () => {
  const h = harness(true);
  h.controller.toggle('0_1');
  h.controller.toggle('0_1');
  h.gates[0].reject(new Error('offline'));
  await settle();

  assert.deepEqual(h.sent, [['0_1', false]]);
  assert.equal(h.values['0_1'], true);
  assert.equal(h.controller.isRunning('0_1'), false);
});

test('a fresh device snapshot becomes the next rollback authority', async () => {
  const h = harness(false);
  h.values['0_1'] = true;
  h.controller.confirmSnapshot({ '0_1': true });
  h.controller.toggle('0_1');
  h.gates[0].reject(new Error('timeout'));
  await settle();
  assert.equal(h.values['0_1'], true);
});

test('AudioPage delegates matrix coalescing and confirmed rollback to the controller', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/AudioPage.vue'), 'utf8');
  assert.match(page, /createAudioMatrixCommandController\(/);
  assert.match(page, /matrixController\.confirmSnapshot\(next\)/);
  assert.match(page, /matrixController\.toggle\(`/);
  assert.doesNotMatch(page, /const desiredCross = new Map/);
  assert.doesNotMatch(page, /const inFlightCross = new Set/);
});
