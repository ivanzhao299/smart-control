const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const srcRoot = path.resolve(__dirname, '../src');
const tokens = fs.readFileSync(path.join(srcRoot, 'styles/design-tokens.css'), 'utf8');
const theme = fs.readFileSync(path.join(srcRoot, 'styles/theme.css'), 'utf8');
const themeService = fs.readFileSync(path.join(srcRoot, 'services/theme.service.ts'), 'utf8');

test('the design system keeps one clean visual foundation', () => {
  assert.match(tokens, /--v2-bg-0: #070d14/);
  assert.match(tokens, /--v2-bg-0: #f6f8fb/);
  assert.match(tokens, /body::before,\s*\nbody::after \{ content: none !important; \}/);

  for (const retired of ['.v2-glass', '.v2-num-glow', '.v2-btn-primary', 'v2-aurora-drift']) {
    assert.doesNotMatch(tokens, new RegExp(retired.replace('.', '\\.'), 'u'));
  }

  assert.doesNotMatch(theme, /\.el-table\s*\{/u, 'Element Plus belongs in design-tokens.css');
  assert.doesNotMatch(theme, /linear-gradient\(135deg/u, 'shared controls use solid fills');
});

test('light is the first-run theme while an explicit saved choice still wins', () => {
  assert.match(themeService, /readStored\(\) \?\? 'light'/);
  assert.match(themeService, /if \(v === 'light' \|\| v === 'dark'\) return v/);
  assert.match(themeService, /forceThemeWithoutPersist\(t: Theme\)/);
});
