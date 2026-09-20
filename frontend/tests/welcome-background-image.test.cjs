const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../src/features/welcome-background-image.ts'),
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
const { centeredCoverCrop, WELCOME_BACKGROUND_RESOLUTION } = moduleUnderTest.exports;

test('welcome background uses the native LED resolution', () => {
  assert.equal(WELCOME_BACKGROUND_RESOLUTION, '3612x1462');
});

test('1971x798 production upload is center-cropped without stretching', () => {
  const crop = centeredCoverCrop(1971, 798);
  assert.equal(crop.sx, 0);
  assert.equal(crop.sw, 1971);
  assert.ok(crop.sy > 0);
  assert.ok(crop.sh < 798);
  assert.ok(Math.abs(crop.sw / crop.sh - 3612 / 1462) < 1e-10);
});

test('wide and tall images crop on the correct axis', () => {
  const wide = centeredCoverCrop(4000, 1000);
  assert.ok(wide.sx > 0);
  assert.equal(wide.sy, 0);
  const tall = centeredCoverCrop(1000, 2000);
  assert.equal(tall.sx, 0);
  assert.ok(tall.sy > 0);
});
