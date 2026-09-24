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
  welcomeVenue: '金湖展贸中心',
  welcomeVenueEn: 'JINHU EXPOSITION & TRADE CENTER',
  welcomeOrg1: '山东金湖集团',
  welcomeOrg2: '金湖科创产业园',
  welcomeBgMediaId: 10,
  welcomeLogoMediaId: 20,
  presentation: {
    layout: 'ceremony', tone: 'light', overlay: 'soft', contentPosition: 'center',
    logoSize: 'medium', titleEffect: 'blue',
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
  // editable venue/org text rides along unchanged when only the asset binding changes
  assert.equal(backgroundChanged.welcomeVenue, '金湖展贸中心');
  assert.equal(backgroundChanged.welcomeOrg2, '金湖科创产业园');
});

test('presentation changes keep content and asset bindings together in the same draft', () => {
  const changed = changeWelcomePresentation(draft(), 'layout', 'editorial');
  assert.equal(changed.presentation.layout, 'editorial');
  assert.equal(changed.presentation.tone, 'light');
  assert.equal(changed.welcomeLogoMediaId, 20);
  assert.equal(changed.welcomeTitle, '热烈欢迎');
});

test('titleEffect is a presentation dimension kept alongside other presentation keys', () => {
  const gold = changeWelcomePresentation(draft(), 'titleEffect', 'gold');
  assert.equal(gold.presentation.titleEffect, 'gold');
  // untouched presentation keys and display text survive
  assert.equal(gold.presentation.layout, 'ceremony');
  assert.equal(gold.welcomeVenueEn, 'JINHU EXPOSITION & TRADE CENTER');
});
