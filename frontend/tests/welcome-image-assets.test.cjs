const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../src/features/welcome-image-assets.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleUnderTest,
  exports: moduleUnderTest.exports,
  require,
});
const { classifyWelcomeImageAssets, addWelcomeImageAsset } = moduleUnderTest.exports;

const asset = (id, remark, resolution = '3612x1462') => ({
  id,
  remark,
  resolution,
  originalName: `${id}.png`,
  thumbUrl: null,
  fileUrl: `/media/${id}`,
  source: 'upload',
});

test('welcome image libraries never mix newly uploaded backgrounds into logos', () => {
  const libraries = classifyWelcomeImageAssets(
    [asset(1, '欢迎页底图'), asset(2, '欢迎页 Logo', '800x300'), asset(3, null)],
    [{ welcomeBgMediaId: null, welcomeLogoMediaId: null }],
  );
  assert.deepEqual(Array.from(libraries.backgrounds, item => item.id), [1]);
  assert.deepEqual(Array.from(libraries.logos, item => item.id), [2]);

  const withBackground = addWelcomeImageAsset(libraries, 'background', asset(4, '欢迎页底图'));
  assert.deepEqual(Array.from(withBackground.backgrounds, item => item.id), [4, 1]);
  assert.deepEqual(Array.from(withBackground.logos, item => item.id), [2]);
});

test('legacy images remain visible only in the field that already references them', () => {
  const libraries = classifyWelcomeImageAssets(
    [asset(7, null), asset(8, null, '800x300')],
    [{ welcomeBgMediaId: 7, welcomeLogoMediaId: 8 }],
  );
  assert.deepEqual(Array.from(libraries.backgrounds, item => item.id), [7]);
  assert.deepEqual(Array.from(libraries.logos, item => item.id), [8]);
});
