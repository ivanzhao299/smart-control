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
      assertActive: () => {},
      readCurrent: async () => { calls.push(['read']); return { mediaId: 41, revision: 7 }; },
      uploadLedPhoto: async file => { calls.push(['upload', file]); return { id: 42 }; },
      bindWelcomePhoto: async (id, revision) => { calls.push(['bind', id, revision]); return { mediaId: id, revision: revision + 1 }; },
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

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { mediaId: 42, previousMediaId: 41, shown: true, revision: 8 });
  assert.deepEqual(deps.calls, [
    ['read'], ['upload', led], ['bind', 42, 7], ['show'], ['remove', 41],
  ]);
});

test('unconfirmed binding reads back once and preserves both files without retry or screen operation', async () => {
  const deps = dependencies({
    bindWelcomePhoto: async id => {
      deps.calls.push(['bind', id]);
      throw new Error('binding rejected');
    },
  });

  await assert.rejects(() => publishWelcomePhoto({ name: 'new.jpg' }, deps.value), error =>
    error.name === 'WelcomePhotoBindingUnconfirmedError' && error.mediaId === 42);

  assert.deepEqual(deps.calls.map(call => call[0]), ['read', 'upload', 'bind', 'read']);
});

test('screen switching or old-file cleanup failure cannot roll back a confirmed new binding', async () => {
  const deps = dependencies({
    showWelcomePage: async () => { deps.calls.push(['show']); throw new Error('screen offline'); },
    removeMedia: async id => { deps.calls.push(['remove', id]); throw new Error('cleanup deferred'); },
  });

  const result = await publishWelcomePhoto({ name: 'new.jpg' }, deps.value);

  assert.equal(result.mediaId, 42);
  assert.equal(result.shown, false);
  assert.deepEqual(deps.calls.map(call => call[0]), ['read', 'upload', 'bind', 'show', 'remove']);
});

test('failed reads and missing/invalid revisions prevent upload entirely', async () => {
  for (const revision of [null, undefined, 0, -1, 1.5, NaN, '7']) {
    const deps = dependencies({ readCurrent: async () => ({ mediaId: 41, revision }) });
    await assert.rejects(publishWelcomePhoto({}, deps.value), /版本不可用/);
    assert.deepEqual(deps.calls, []);
  }
  const deps = dependencies({ readCurrent: async () => { throw Error('offline'); } });
  await assert.rejects(publishWelcomePhoto({}, deps.value), /offline/);
  assert.deepEqual(deps.calls, []);
});

test('a lost bind receipt is recovered only by a confirmed current binding', async () => {
  let reads = 0;
  const deps = dependencies({
    readCurrent: async () => {
      deps.calls.push(['read']);
      return ++reads === 1 ? { mediaId: 41, revision: 7 } : { mediaId: 42, revision: 8 };
    },
    bindWelcomePhoto: async (id, revision) => {
      deps.calls.push(['bind', id, revision]); throw Error('lost response');
    },
  });
  const result = await publishWelcomePhoto({}, deps.value);
  assert.equal(result.mediaId, 42);
  assert.deepEqual(deps.calls.map(c => c[0]), ['read', 'upload', 'bind', 'read', 'show', 'remove']);
  assert.deepEqual(deps.calls.find(c => c[0] === 'bind'), ['bind', 42, 7]);
});

test('failed or stale verification never triggers cleanup, retries, or a false success', async () => {
  for (const proof of [null, { mediaId: 42, revision: 6 }, { mediaId: 42, revision: 7 }, { mediaId: 99, revision: 9 }, { mediaId: 42 }]) {
    let reads = 0;
    const deps = dependencies({
      readCurrent: async () => {
        if (++reads === 1) return { mediaId: 41, revision: 7 };
        if (!proof) throw Error('offline');
        return proof;
      },
      bindWelcomePhoto: async () => { deps.calls.push(['bind']); throw Error('lost'); },
    });
    await assert.rejects(publishWelcomePhoto({}, deps.value), { name: 'WelcomePhotoBindingUnconfirmedError' });
    assert.deepEqual(deps.calls.map(c => c[0]), ['upload', 'bind']);
    assert.equal(reads, 2);
  }
});

test('the strict welcome service forwards the frozen revision without a fresh read or fallback route', async () => {
  const calls = [];
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/services/system-branding.service.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require: name => {
      assert.equal(name, './http');
      return { api: {
        get: async () => { throw Error('unexpected baseline refresh'); },
        put: async (route, payload) => { calls.push([route, payload]); return { configRevision: 8 }; },
      } };
    },
  });
  const result = await exports.saveWelcomeConfigVersioned({ welcomePhotoMediaId: 42 }, 7);
  assert.equal(result.configRevision, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['/system-branding/welcome/editor', { welcomePhotoMediaId: 42, expectedRevision: 7 }],
  ]);
  for (const revision of [undefined, null, 0, -1, 1.5, '7']) {
    await assert.rejects(exports.saveWelcomeConfigVersioned({}, revision), /版本不可用/);
  }
  assert.equal(calls.length, 1);
});

test('identity change at each awaited boundary stops all subsequent side effects', async () => {
  for (const boundary of ['readCurrent', 'uploadLedPhoto', 'bindWelcomePhoto', 'showWelcomePage', 'removeMedia']) {
    let active = true;
    const deps = dependencies({ assertActive: () => { if (!active) throw Error('identity changed'); } });
    const original = deps.value[boundary];
    deps.value[boundary] = async (...args) => { const result = await original(...args); active = false; return result; };
    await assert.rejects(publishWelcomePhoto({}, deps.value), /identity changed/);
    const stages = ['read', 'upload', 'bind', 'show', 'remove'];
    const index = ['readCurrent', 'uploadLedPhoto', 'bindWelcomePhoto', 'showWelcomePage', 'removeMedia'].indexOf(boundary);
    assert.deepEqual(deps.calls.map(c => c[0]), stages.slice(0, index + 1));
  }
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
