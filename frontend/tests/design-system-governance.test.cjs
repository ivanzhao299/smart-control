const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const srcRoot = path.resolve(__dirname, '../src');
const tokens = fs.readFileSync(path.join(srcRoot, 'styles/design-tokens.css'), 'utf8');
const theme = fs.readFileSync(path.join(srcRoot, 'styles/theme.css'), 'utf8');
const themeService = fs.readFileSync(path.join(srcRoot, 'services/theme.service.ts'), 'utf8');

test('the design system keeps one clean visual foundation', () => {
  assert.match(tokens, /--v2-bg-0: #0a0b0e/);
  assert.match(tokens, /--v2-bg-0: #f4f6f9/);
  assert.match(tokens, /body::before,\s*\nbody::after \{ content: none !important; \}/);

  for (const retired of ['.v2-glass', '.v2-num-glow', '.v2-btn-primary', 'v2-aurora-drift']) {
    assert.doesNotMatch(tokens, new RegExp(retired.replace('.', '\\.'), 'u'));
  }

  assert.doesNotMatch(theme, /\.el-table\s*\{/u, 'Element Plus belongs in design-tokens.css');
  assert.doesNotMatch(theme, /linear-gradient\(135deg/u, 'shared controls use solid fills');
});

test('dark is the first-run theme while an explicit saved choice still wins', () => {
  assert.match(themeService, /readStored\(\) \?\? 'dark'/);
  assert.match(themeService, /\(ALL_THEMES as string\[\]\)\.includes\(v\)/);
  assert.match(themeService, /forceThemeWithoutPersist\(t: Theme\)/);
});

test('five theme schemes exist and white-text fill is separated from brand colour', () => {
  // theme.service declares all five schemes (dark/light + ocean/sunset/emerald)
  for (const key of ['dark', 'light', 'ocean', 'sunset', 'emerald']) {
    assert.match(themeService, new RegExp(`'${key}'`));
  }
  // dark is the default :root; each light scheme owns a colour block
  for (const key of ['light', 'ocean', 'sunset', 'emerald']) {
    assert.match(tokens, new RegExp(`\\[data-theme='${key}'\\]`));
  }
  // White-text buttons use a dedicated fill token (default follows primary; orange/green
  // schemes darken it to 700/800 for WCAG AA) while icons/links keep the vivid 600.
  assert.match(tokens, /--v2-primary-fill: var\(--v2-primary\)/);
  // Brand-colour-independent structure rules follow the lightness mode
  assert.match(tokens, /\[data-theme-mode='light'\]/);
  assert.match(tokens, /\[data-theme-mode='dark'\]/);
});
