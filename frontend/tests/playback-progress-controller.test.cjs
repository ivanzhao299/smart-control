const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/features/playback-progress-controller.ts'),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require, Date, setInterval, clearInterval });
  return module.exports;
}

function harness() {
  let nowMs = 0;
  let nextId = 1;
  const callbacks = new Map();
  const progress = [];
  const { createPlaybackProgressController } = load();
  const controller = createPlaybackProgressController({
    onProgress: (value) => progress.push(value),
    now: () => nowMs,
    schedule: (callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel: (id) => { callbacks.delete(id); },
  });
  return {
    controller,
    progress,
    advance(ms) { nowMs += ms; },
    tick() { for (const callback of [...callbacks.values()]) callback(); },
    scheduled: () => callbacks.size,
  };
}

test('estimates progress and stops itself at the track duration', () => {
  const h = harness();
  h.controller.start(100);
  assert.equal(h.scheduled(), 1);
  assert.deepEqual(h.progress, [0]);

  h.advance(25000);
  h.tick();
  assert.equal(h.progress.at(-1), 25);

  h.advance(75000);
  h.tick();
  assert.equal(h.progress.at(-1), 100);
  assert.equal(h.scheduled(), 0);
  assert.equal(h.controller.isRunning(), false);
  h.controller.resume();
  assert.equal(h.scheduled(), 0);
});

test('pause and resume retain only active playback time', () => {
  const h = harness();
  h.controller.start(100);
  h.advance(20000);
  h.controller.pause();
  assert.equal(h.scheduled(), 0);

  h.advance(30000);
  h.controller.resume();
  h.advance(10000);
  h.tick();
  assert.equal(h.progress.at(-1), 30);
});

test('a track received in paused state keeps its duration for a later resume', () => {
  const h = harness();
  h.controller.start(80, true);
  assert.equal(h.scheduled(), 0);

  h.controller.resume();
  h.advance(20000);
  h.tick();
  assert.equal(h.progress.at(-1), 25);
});

test('unknown duration stays idle and reset clears an active estimate', () => {
  const h = harness();
  h.controller.start(null);
  assert.equal(h.scheduled(), 0);
  assert.deepEqual(h.progress, [0]);

  h.controller.start(60);
  h.advance(15000);
  h.tick();
  assert.equal(h.progress.at(-1), 25);
  h.controller.reset();
  assert.equal(h.scheduled(), 0);
  assert.equal(h.progress.at(-1), 0);
});

test('AudioPage delegates progress timing and follows backend pause state', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/AudioPage.vue'), 'utf8');
  assert.match(page, /createPlaybackProgressController\(/);
  assert.match(page, /progressController\.start\(dur, !!bgmChannel\.value\?\.paused\)/);
  assert.match(page, /watch\(\(\) => bgmChannel\.value\?\.paused/);
  assert.match(page, /bgmChannel\.value\?\.playbackSession !== session/);
  assert.match(page, /bgmChannel\.value\?\.currentMediaId, bgmChannel\.value\?\.playbackSession/);
  assert.doesNotMatch(page, /let plTimer:/);
  assert.doesNotMatch(page, /plTimerElapsed/);
});
