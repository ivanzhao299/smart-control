const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const publisherSource = fs.readFileSync(
  path.join(__dirname, '../src/services/welcome-photo-publisher.ts'),
  'utf8',
);
const publisherJs = ts.transpileModule(publisherSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleBox = { exports: {} };
vm.runInNewContext(publisherJs, { module: moduleBox, exports: moduleBox.exports });
const { publishWelcomePhoto } = moduleBox.exports;

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      readCurrentMediaId: async () => { calls.push(['read']); return 41; },
      uploadLedPhoto: async file => { calls.push(['upload', file]); return { id: 42 }; },
      bindWelcomePhoto: async id => { calls.push(['bind', id]); },
      showWelcomePage: async () => { calls.push(['show']); },
      removeMedia: async id => { calls.push(['remove', id]); },
      ...overrides,
    },
  };
}

test('photo publishing binds the new data-disk asset before switching the screen and retiring the old one', async () => {
  const led = { name: 'welcome-led.jpg' };
  const deps = dependencies();

  const result = await publishWelcomePhoto(led, deps.value);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { mediaId: 42, previousMediaId: 41 });
  assert.deepEqual(deps.calls, [
    ['read'], ['upload', led], ['bind', 42], ['show'], ['remove', 41],
  ]);
});

test('a failed welcome binding cleans only the new upload and preserves the currently displayed photo', async () => {
  const deps = dependencies({
    bindWelcomePhoto: async id => {
      deps.calls.push(['bind', id]);
      throw new Error('binding rejected');
    },
  });

  await assert.rejects(() => publishWelcomePhoto({ name: 'new.jpg' }, deps.value), /binding rejected/);

  assert.deepEqual(deps.calls.map(call => call[0]), ['read', 'upload', 'bind', 'remove']);
  assert.equal(deps.calls.at(-1)[1], 42);
  assert.equal(deps.calls.some(call => call[0] === 'remove' && call[1] === 41), false);
  assert.equal(deps.calls.some(call => call[0] === 'show'), false);
});

test('screen switching or old-file cleanup failure cannot roll back a confirmed new binding', async () => {
  const deps = dependencies({
    showWelcomePage: async () => { deps.calls.push(['show']); throw new Error('screen offline'); },
    removeMedia: async id => { deps.calls.push(['remove', id]); throw new Error('cleanup deferred'); },
  });

  const result = await publishWelcomePhoto({ name: 'new.jpg' }, deps.value);

  assert.equal(result.mediaId, 42);
  assert.deepEqual(deps.calls.map(call => call[0]), ['read', 'upload', 'bind', 'show', 'remove']);
});

test('iPhone camera journey stays on getUserMedia and directs HTTP installs to the canonical HTTPS PWA', () => {
  const camera = fs.readFileSync(
    path.join(__dirname, '../src/components/WelcomeCameraModal.vue'),
    'utf8',
  );
  const photoFlow = fs.readFileSync(
    path.join(__dirname, '../src/composables/useWelcomePhoto.ts'),
    'utf8',
  );
  const cameraTemplate = camera.match(/<template>([\s\S]*?)<\/template>/)[1];

  assert.match(camera, /https:\/\/park\.cnjinhu\.com\/control\//);
  assert.match(camera, /window\.isSecureContext/);
  assert.match(camera, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(camera, /打开安全版并拍照/);
  assert.match(camera, /首次使用需重新登录并重新添加到主屏幕/);
  assert.doesNotMatch(cameraTemplate, /<input[^>]+capture/i);
  assert.match(photoFlow, /fd\.append\('remark', 'welcome-photo'\)/);
  assert.match(photoFlow, /publishWelcomePhoto\(led/);
});
