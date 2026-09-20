const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../src/features/welcome-scheme-draft.ts'),
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
const { chooseWelcomeLogo, chooseWelcomeBackground, changeWelcomePresentation } = moduleUnderTest.exports;

const draft = () => ({
  welcomeTitle: '热烈欢迎',
  welcomeGuest: '各位嘉宾',
  welcomeTagline: '欢迎莅临',
  welcomeBgMediaId: 10,
  welcomeLogoMediaId: 20,
  presentation: {
    layout: 'ceremony', tone: 'light', overlay: 'soft', contentPosition: 'center', logoSize: 'medium',
  },
});

test('switching a logo or background creates a complete saveable draft without mutating the old one', () => {
  const original = draft();
  const logoChanged = chooseWelcomeLogo(original, 21);
  const backgroundChanged = chooseWelcomeBackground(logoChanged, null);
  assert.equal(original.welcomeLogoMediaId, 20);
  assert.equal(logoChanged.welcomeLogoMediaId, 21);
  assert.equal(backgroundChanged.welcomeBgMediaId, null);
  assert.equal(backgroundChanged.welcomeLogoMediaId, 21);
});

test('presentation changes keep content and asset bindings together in the same draft', () => {
  const changed = changeWelcomePresentation(draft(), 'layout', 'editorial');
  assert.equal(changed.presentation.layout, 'editorial');
  assert.equal(changed.presentation.tone, 'light');
  assert.equal(changed.welcomeLogoMediaId, 20);
  assert.equal(changed.welcomeTitle, '热烈欢迎');
});
