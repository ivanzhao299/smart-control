const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(ios, legacy = false) {
  let calls = 0;
  const JinhuShell = {
    ...(ios && !legacy ? { platform: 'ios' } : {}),
    bioInfoScoped: () => { calls++; return JSON.stringify({ available: true, saved: true }); },
    saveBioPasswordScoped: () => calls++, clearBioPasswordScoped: () => calls++, requestBioLoginScoped: () => calls++,
  };
  const window = { JinhuShell, ...(ios && legacy ? { webkit: { messageHandlers: { jinhuShell: {} } } } : {}) };
  const source = fs.readFileSync(path.join(__dirname, '../src/composables/useShellBio.ts'), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { window, exports });
  return { api: exports, calls: () => calls };
}
for (const legacy of [false, true]) test(`iOS ${legacy ? 'already-installed' : 'updated'} shell never invokes biometric APIs`, () => {
  const e = load(true, legacy);
  for (const scope of ['client', 'admin']) {
    assert.equal(e.api.shellBioRead(scope), null);
    e.api.shellBioSave(scope, 'synthetic-password'); e.api.shellBioClear(scope);
    let failed = false;
    e.api.shellBioLogin(scope, () => assert.fail('must not log in'), () => { failed = true; });
    assert.equal(failed, true);
  }
  assert.equal(e.calls(), 0);
});
test('Android biometric bridge remains unchanged', () => {
  const e = load(false);
  assert.equal(e.api.shellBioRead('client').saved, true);
  e.api.shellBioSave('client', 'synthetic-password');
  e.api.shellBioLogin('client', () => {}, () => assert.fail('Android bridge should remain supported'));
  assert.equal(e.calls(), 3);
});
test('native iOS removes setting, startup/resume prompts and persisted app-lock flag', () => {
  const root = path.join(__dirname, '../../ios-app/SmartControl');
  const content = fs.readFileSync(path.join(root, 'ContentView.swift'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'ConfigView.swift'), 'utf8');
  const prefs = fs.readFileSync(path.join(root, 'Prefs.swift'), 'utf8');
  const web = fs.readFileSync(path.join(root, 'WebView.swift'), 'utf8');
  assert.doesNotMatch(content + config + web, /BiometricAuth|LAContext|evaluatePolicy|startUnlockAuth|Prefs\.biometricLock/);
  assert.doesNotMatch(config, /面容 ID 解锁/);
  assert.match(content, /Prefs.removeLegacyBiometricLock\(\)/);
  assert.match(prefs, /removeObject\(forKey: keyBiometricLock\)/);
  assert.match(web, /available:false,saved:\{client:false,admin:false\}/);
  assert.doesNotMatch(web, /KeychainStore\.(password|hasPassword|set)/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'Info.plist'), 'utf8'), /NSFaceIDUsageDescription/);
});
