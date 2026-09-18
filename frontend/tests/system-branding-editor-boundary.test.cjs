const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '../src');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function serviceFixture() {
  const source = read('services/system-branding.service.ts');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls = [];
  const exports = {};
  vm.runInNewContext(js, {
    exports,
    require: name => {
      assert.equal(name, './http');
      return { api: { put: async (route, body) => { calls.push([route, body]); return { configRevision: 8 }; } } };
    },
    Number,
  });
  return { api: exports, calls };
}

test('strict system branding service sends the original revision only to editor routes', async () => {
  const f = serviceFixture();
  await f.api.saveSystemBrandingVersioned({ welcomeMediaId: 42 }, 7);
  await f.api.saveWelcomeConfigVersioned({ welcomeTitle: '欢迎' }, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    ['/system-branding/editor', { welcomeMediaId: 42, expectedRevision: 7 }],
    ['/system-branding/welcome/editor', { welcomeTitle: '欢迎', expectedRevision: 8 }],
  ]);
  for (const revision of [undefined, null, 0, -1, 1.5, '7']) {
    await assert.rejects(f.api.saveSystemBrandingVersioned({}, revision), /版本不可用/);
  }
  assert.equal(f.calls.length, 2);
});

test('the three remaining editors cannot write through legacy branding routes', () => {
  const player = read('components/PlayerConsole.vue');
  const media = read('pages/MediaPage.vue');
  const admin = read('pages/admin/SystemBrandingAdmin.vue');
  const store = read('stores/system-branding.ts');

  assert.match(player, /saveWelcomeConfigVersioned\(/);
  assert.doesNotMatch(player, /\bsaveWelcomeConfig\(/);
  assert.match(player, /welcomeNeedsReload\.value = true/);
  assert.match(player, /sameWelcomeDraft\(submitted, welcomeDraft\(\)\)/);
  assert.match(player, /captureConsoleAction\(\)/);
  assert.match(player, /loadWelcomeEditor\(true\)/);
  assert.match(player, /onIdentityChange/);
  assert.match(player, /stopWelcomeIdentityListener/);

  assert.match(media, /brandingStore\.loadEditorBaseline\(\)/);
  assert.match(media, /brandingStore\.saveVersioned\(/);
  assert.match(media, /captureIdentityGuard/);
  assert.match(media, /welcomeBindingBusy/);
  assert.match(media, /stopWelcomeBindingIdentityListener/);
  assert.doesNotMatch(media, /brandingStore\.save\(\{ welcomeMediaId:/);

  assert.match(admin, /brandingStore\.loadEditorBaseline\(\)/);
  assert.match(admin, /brandingStore\.saveVersioned\(submitted, revision\)/);
  assert.match(admin, /needsReload\.value = true/);
  assert.match(admin, /captureIdentityGuard/);
  assert.doesNotMatch(admin, /brandingStore\.save\(\{/);

  assert.match(store, /saveSystemBrandingVersioned/);
  assert.match(store, /loadEditorBaseline/);
  assert.match(store, /服务器未确认系统配置的新版本/);
  assert.match(store, /branding\.value\.configRevision/);
  assert.doesNotMatch(store, /logoUrl \? branding\.value\.logoUrl\.length/);
});

test('editor UI freezes individual writes while the confirmed baseline is unavailable', () => {
  const player = read('components/PlayerConsole.vue');
  const media = read('pages/MediaPage.vue');
  const admin = read('pages/admin/SystemBrandingAdmin.vue');
  assert.match(player, /:disabled="welcomeSaving \|\| welcomeNeedsReload"/);
  assert.match(player, /当前配置尚未核实，不能保存或覆盖/);
  assert.match(media, /:disabled="isWelcome\(m\) \|\| welcomeBindingBusy"/);
  assert.match(admin, /当前品牌配置尚未核实，保存已锁定/);
  assert.match(admin, /:disabled="submitting \|\| uploading \|\| needsReload"/);
});
