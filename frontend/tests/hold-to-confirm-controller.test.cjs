const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadController() {
  const file = path.resolve(__dirname, '../src/features/hold-to-confirm-controller.ts');
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require, Math });
  return module.exports.createHoldToConfirmController;
}

function harness() {
  let now = 0;
  let nextId = 0;
  const frames = new Map();
  const states = [];
  const confirmed = [];
  const createController = loadController();
  const controller = createController({
    durationMs: 1100,
    movementThreshold: 12,
    now: () => now,
    schedule: (callback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelScheduled: (id) => frames.delete(id),
    onState: (key, progress) => states.push([key, progress]),
    onConfirm: (key) => confirmed.push(key),
  });
  return {
    controller,
    states,
    confirmed,
    advance(value) {
      now = value;
      const pending = Array.from(frames.values());
      frames.clear();
      for (const callback of pending) callback(now);
    },
    pendingFrames: () => frames.size,
  };
}

test('confirms once only after the complete hold duration', () => {
  const h = harness();
  h.controller.start(3, { x: 10, y: 20 });
  h.advance(550);
  assert.equal(h.confirmed.length, 0);
  assert.deepEqual(h.states.at(-1), [3, 50]);
  h.advance(1100);
  assert.deepEqual(h.confirmed, [3]);
  assert.deepEqual(h.states.at(-1), [null, 0]);
  assert.equal(h.controller.end(), false);
  assert.deepEqual(h.confirmed, [3]);
});

test('moving farther than the threshold cancels the active hold', () => {
  const h = harness();
  h.controller.start(2, { x: 0, y: 0 });
  h.advance(220);
  h.controller.move({ x: 13, y: 0 });
  h.advance(1100);
  assert.deepEqual(h.confirmed, []);
  assert.deepEqual(h.states.at(-1), [null, 0]);
});

test('ending a meaningful partial hold requests the existing hint', () => {
  const h = harness();
  h.controller.start(1, { x: 0, y: 0 });
  h.advance(109);
  assert.equal(h.controller.end(), false);
  h.controller.start(1, { x: 0, y: 0 });
  h.advance(219);
  assert.equal(h.controller.end(), true);
  assert.equal(h.pendingFrames(), 0);
});

test('a replacement hold cancels the old frame and confirms only the new key', () => {
  const h = harness();
  h.controller.start(1, { x: 0, y: 0 });
  h.controller.start(4, { x: 5, y: 5 });
  assert.equal(h.pendingFrames(), 1);
  h.advance(1100);
  assert.deepEqual(h.confirmed, [4]);
});

test('dispose clears the scheduled frame and visible hold state', () => {
  const h = harness();
  h.controller.start(8, { x: 0, y: 0 });
  h.advance(440);
  h.controller.dispose();
  assert.equal(h.pendingFrames(), 0);
  assert.deepEqual(h.states.at(-1), [null, 0]);
});

test('AudioPage delegates the complete scene journey to one composable', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/AudioPage.vue'), 'utf8');
  const scenes = fs.readFileSync(path.resolve(__dirname, '../src/composables/useAudioScenes.ts'), 'utf8');
  assert.match(page, /useAudioScenes\(\)/);
  assert.doesNotMatch(page, /const HOLD_MS/);
  assert.doesNotMatch(page, /function recallScene/);
  assert.match(scenes, /audioConfigService\.listScenes\(\)/);
  assert.match(scenes, /audioService\.applyScene\(scene\.id\)/);
  assert.match(scenes, /audioService\.currentScene\(\)/);
  assert.match(scenes, /createHoldToConfirmController<number>/);
  assert.match(scenes, /onDeactivated\(holdController\.cancel\)/);
});
