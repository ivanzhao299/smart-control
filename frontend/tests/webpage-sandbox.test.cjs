const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSandboxPolicy() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/services/webpage-sandbox.ts'),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, URL });
  return exports.webpageSandbox;
}

test('only the bundled same-origin park dashboard can retain its origin', () => {
  const sandbox = loadSandboxPolicy();
  const player = 'http://localhost:5173/control/player?slot=1';
  assert.equal(
    sandbox('http://localhost:5173/control/park-ops/index.html', player),
    'allow-scripts allow-forms allow-same-origin',
  );
  assert.equal(
    sandbox('/control/park-ops/index.html?scene=night', player),
    'allow-scripts allow-forms allow-same-origin',
  );
  assert.equal(
    sandbox('https://example.com/park-ops/index.html', player),
    'allow-scripts allow-forms',
  );
  assert.equal(
    sandbox('http://localhost:5173/control/custom/index.html', player),
    'allow-scripts allow-forms',
  );
  assert.equal(sandbox('not a valid absolute URL', player), 'allow-scripts allow-forms');
});

test('PlayerPage applies the computed policy and the dashboard retries commands blocked by animation', () => {
  const player = fs.readFileSync(path.resolve(__dirname, '../src/pages/PlayerPage.vue'), 'utf8');
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../public/park-ops/js/app.js'), 'utf8');
  assert.match(player, /:sandbox="currentWebpageSandbox"/);
  assert.doesNotMatch(player, /sandbox="allow-scripts allow-forms"/);
  assert.match(dashboard, /go\(page\); if\(idx === page\) lastPage = page/);
  assert.doesNotMatch(dashboard, /lastPage = page; go\(page\)/);
});
