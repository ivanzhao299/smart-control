const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/features/audio-view-model.ts'),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require });
  return module.exports;
}

function loadBackendAudioProtocol() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../backend/src/adapters/audio/ekx808-protocol.ts'),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require, Buffer });
  return module.exports;
}

const model = load();
const backendProtocol = loadBackendAudioProtocol();

function channel(id, name, channelNumber, patch = {}) {
  return { id, name, channel: channelNumber, volume: 50, muted: false, ...patch };
}

const channels = [
  channel('audio_out1', 'LED大屏·左', 0, { volume: 40 }),
  channel('audio_out2', 'LED大屏·右', 1, { volume: 60 }),
  channel('audio_out3', '未配对·右', 2, { muted: true }),
  channel('audio_out4', '发布厅', 3, { volume: 80 }),
];

test('stereo projection links complete pairs and keeps an unpaired right channel visible', () => {
  const partners = model.buildStereoPartnerIds(channels);
  assert.equal(JSON.stringify(partners), JSON.stringify({
    audio_out1: 'audio_out2',
    audio_out2: 'audio_out1',
  }));
  assert.equal(
    model.filterVisibleAudioChannels(channels, partners).map((item) => item.id).join(','),
    'audio_out1,audio_out3,audio_out4',
  );
});

test('stereo labels, addresses and rows preserve the existing card contract', () => {
  const partners = model.buildStereoPartnerIds(channels);
  assert.equal(model.isStereoLeftChannel(channels[0], partners), true);
  assert.equal(model.audioChannelDisplayName(channels[0], partners), 'LED大屏');
  assert.equal(model.audioChannelDisplayAddress(channels[0], channels, partners), 'AUDIO_OUT1+2');
  assert.equal(model.stereoChannelRows(channels[0], channels, partners).map((item) => item.id).join(','), 'audio_out1,audio_out2');
  assert.equal(model.stereoLeftChannelId(channels[1], partners), 'audio_out1');
  assert.equal(model.audioChannelDisplayName(channels[3], partners), '发布厅');
});

test('gain conversion retains EKX endpoints, fold point and monotonic round trip', () => {
  assert.equal(model.percentToGainDb(0), -60);
  assert.equal(model.percentToGainDb(25), -35);
  assert.equal(model.percentToGainDb(50), -10);
  assert.equal(model.percentToGainDb(75), 1);
  assert.equal(model.percentToGainDb(100), 12);
  for (let percent = 0; percent <= 100; percent += 5) {
    assert.equal(model.gainDbToPercent(model.percentToGainDb(percent)), percent);
  }
});

test('frontend gain conversion stays identical to the backend EKX command curve', () => {
  for (let percent = -10; percent <= 110; percent += 1) {
    assert.equal(model.percentToGainDb(percent), backendProtocol.percentToDb(percent));
  }
});

test('gain labels expose unknown readings without inventing a value', () => {
  assert.equal(model.formatGainDb(undefined), '—');
  assert.equal(model.formatGainDb(null), '—');
  assert.equal(model.formatGainDb(-10), '-10.0 dB');
  assert.equal(model.formatGainDb(1.25), '+1.3 dB');
});

test('fader geometry clamps and snaps to the existing five-percent step', () => {
  const track = { bottom: 300, height: 200 };
  assert.equal(model.faderPercentFromY(track, 300), 0);
  assert.equal(model.faderPercentFromY(track, 247), 25);
  assert.equal(model.faderPercentFromY(track, 200), 50);
  assert.equal(model.faderPercentFromY(track, 80), 100);
  assert.equal(model.faderPercentFromY({ bottom: 300, height: 0 }, 100), 0);
});

test('overview counts projected channels and ignores muted outputs in the average', () => {
  const partners = model.buildStereoPartnerIds(channels);
  const visible = model.filterVisibleAudioChannels(channels, partners);
  assert.equal(JSON.stringify(model.summarizeAudioOutputs(visible, true)), JSON.stringify({
    total: 3,
    active: 2,
    avgVol: 60,
    playing: 1,
  }));
  assert.equal(model.summarizeAudioOutputs(visible.map((item) => ({ ...item, muted: true })), false).avgVol, 0);
});

test('duration formatting keeps the playlist display convention', () => {
  assert.equal(model.formatAudioDuration(null), '');
  assert.equal(model.formatAudioDuration(0), '');
  assert.equal(model.formatAudioDuration(65), '1:05');
});

test('AudioPage consumes the shared model instead of duplicating pure projections', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/AudioPage.vue'), 'utf8');
  assert.match(page, /from '@\/features\/audio-view-model'/);
  assert.match(page, /buildStereoPartnerIds\(channels\.value\)/);
  assert.match(page, /summarizeAudioOutputs\(/);
  assert.doesNotMatch(page, /function pctToDbUi\(/);
  assert.doesNotMatch(page, /function dbToPctUi\(/);
  assert.doesNotMatch(page, /const byName = new Map\(channels\.value/);
});
