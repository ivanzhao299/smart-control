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

test('four themes with the auto (car) dark theme and three switchable accents', () => {
  // theme.service declares exactly four selectable schemes; ocean/emerald retired (#107)
  assert.match(themeService, /ALL_THEMES: Theme\[\] = \['dark', 'light', 'sunset', 'auto'\]/);
  // auto is the second dark-mode theme; structure rules still key off the lightness mode
  assert.match(themeService, /t === 'dark' \|\| t === 'auto'/);
  // dark is the default :root; each non-default scheme owns a colour block in tokens
  for (const key of ['light', 'sunset', 'auto']) {
    assert.match(tokens, new RegExp(`\\[data-theme='${key}'\\]`));
  }
  assert.match(tokens, /\[data-theme-mode='light'\]/);
  assert.match(tokens, /\[data-theme-mode='dark'\]/);

  // three switchable accents (cyan default lives in the auto base block; orange/purple
  // override via a higher-specificity [data-theme='auto'][data-accent=...] block)
  assert.match(themeService, /ALL_ACCENTS: Accent\[\] = \['cyan', 'orange', 'purple'\]/);
  assert.match(themeService, /sc\.accent/);
  assert.match(themeService, /function applyAccent/);
  assert.match(tokens, /--v2-primary: #37b6ff/, 'cyan is the default accent in the auto base block');
  for (const key of ['orange', 'purple']) {
    assert.match(tokens, new RegExp(`\\[data-theme='auto'\\]\\[data-accent='${key}'\\]`));
  }

  // White-text buttons keep a dedicated fill token (default follows primary)
  assert.match(tokens, /--v2-primary-fill: var\(--v2-primary\)/);

  // auto must simulate glass without large-area blur (GPU constrained tablets);
  // strip CSS comments first so the rationale comment mentioning the property does not trip this
  const autoBlock = tokens
    .slice(tokens.indexOf("[data-theme='auto']"))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(autoBlock, /backdrop-filter/u, 'auto theme uses no backdrop-filter');
});
