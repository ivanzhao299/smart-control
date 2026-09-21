const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/features/audio-duration-probe.ts'),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require, Promise, Number, Audio: undefined });
  return module.exports;
}

class FakeAudio {
  preload = '';
  src = '';
  duration = Number.NaN;
  _currentTime = 0;
  listeners = new Map();
  rejectSeek = false;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  set currentTime(value) {
    if (this.rejectSeek) throw new Error('seek rejected');
    this._currentTime = value;
  }

  get currentTime() { return this._currentTime ?? 0; }

  listenerCount() {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

function harness() {
  const audio = new FakeAudio();
  const timers = new Map();
  let nextTimer = 1;
  const { probeAudioDuration } = load();
  const probe = () => probeAudioDuration('/audio.mp3', {
    createAudio: () => audio,
    scheduleTimeout: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    cancelTimeout: (id) => { timers.delete(id); },
  });
  return {
    audio,
    timers,
    probe,
    timeout() { for (const callback of [...timers.values()]) callback(); },
  };
}

test('resolves finite metadata and releases the probe resources', async () => {
  const h = harness();
  const result = h.probe();
  assert.equal(h.audio.preload, 'metadata');
  assert.equal(h.audio.src, '/audio.mp3');
  h.audio.duration = 42.5;
  h.audio.emit('loadedmetadata');

  assert.equal(await result, 42.5);
  assert.equal(h.audio.src, '');
  assert.equal(h.audio.listenerCount(), 0);
  assert.equal(h.timers.size, 0);
});

test('keeps listening through non-finite VBR duration changes', async () => {
  const h = harness();
  const result = h.probe();
  h.audio.duration = Number.POSITIVE_INFINITY;
  h.audio.emit('loadedmetadata');
  assert.equal(h.audio.currentTime, 1e7);

  h.audio.emit('durationchange');
  assert.equal(h.audio.listenerCount(), 3);
  h.audio.duration = 128;
  h.audio.emit('durationchange');
  assert.equal(await result, 128);
  assert.equal(h.audio.listenerCount(), 0);
});

test('media error resolves null once and ignores later events', async () => {
  const h = harness();
  const result = h.probe();
  h.audio.emit('error');
  assert.equal(await result, null);
  h.audio.duration = 99;
  h.audio.emit('loadedmetadata');
  assert.equal(h.audio.listenerCount(), 0);
});

test('timeout remains a bounded fallback when a browser rejects the VBR seek', async () => {
  const h = harness();
  h.audio.rejectSeek = true;
  const result = h.probe();
  h.audio.duration = Number.POSITIVE_INFINITY;
  h.audio.emit('loadedmetadata');
  h.timeout();

  assert.equal(await result, null);
  assert.equal(h.audio.listenerCount(), 0);
});

test('AudioPage delegates browser duration probing to the shared boundary', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/AudioPage.vue'), 'utf8');
  assert.match(page, /probeAudioDuration\(absUrl\(`/);
  assert.doesNotMatch(page, /new Audio\(\)/);
  assert.doesNotMatch(page, /audio\.currentTime = 1e7/);
});
