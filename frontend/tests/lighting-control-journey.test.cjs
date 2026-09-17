const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../src/services/lighting-command-journey.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleBox = { exports: {} };
vm.runInNewContext(compiled, { module: moduleBox, exports: moduleBox.exports });
const { runLightingCommand } = moduleBox.exports;

function state(overrides = {}) {
  return {
    on: false,
    brightness: 80,
    confirmedOn: false,
    confirmedBrightness: 80,
    busy: false,
    error: null,
    ...overrides,
  };
}

test('accepted lighting command commits confirmed state only after the device responds', async () => {
  const zone = state();
  let finish;
  const pending = runLightingCommand(zone, { on: true, brightness: 80 }, () =>
    new Promise(resolve => { finish = resolve; }),
  );

  assert.equal(zone.on, true);
  assert.equal(zone.confirmedOn, false);
  assert.equal(zone.busy, true);
  finish({ ok: true, mock: false });

  const outcome = await pending;
  assert.equal(outcome.ok, true);
  assert.equal(zone.confirmedOn, true);
  assert.equal(zone.confirmedBrightness, 80);
  assert.equal(zone.busy, false);
});

test('failed brightness command restores power and brightness after slider preview', async () => {
  const zone = state({ on: true, confirmedOn: true, brightness: 30, confirmedBrightness: 30 });
  zone.brightness = 90;

  const outcome = await runLightingCommand(zone, { on: true, brightness: 90 }, async () => ({
    ok: false,
    error: 'gateway timeout',
  }));

  assert.equal(outcome.ok, false);
  assert.equal(zone.on, true);
  assert.equal(zone.brightness, 30);
  assert.equal(zone.confirmedBrightness, 30);
  assert.equal(zone.error, 'gateway timeout');
});

test('a second tap while the same zone is pending cannot race the first response', async () => {
  const zone = state();
  let finish;
  let calls = 0;
  const first = runLightingCommand(zone, { on: true, brightness: 80 }, () => {
    calls += 1;
    return new Promise(resolve => { finish = resolve; });
  });
  const second = await runLightingCommand(zone, { on: false, brightness: 80 }, async () => {
    calls += 1;
    return { ok: true };
  });

  assert.deepEqual(JSON.parse(JSON.stringify(second)), { accepted: false, ok: false });
  assert.equal(calls, 1);
  assert.equal(zone.on, true);
  finish({ ok: true });
  await first;
  assert.equal(zone.confirmedOn, true);
});

test('lighting page uses the journey boundary and locks a zone toggle during dispatch', () => {
  const page = fs.readFileSync(path.join(__dirname, '../src/pages/LightingPage.vue'), 'utf8');
  assert.match(page, /runLightingCommand\(z/);
  assert.match(page, /:disabled="z\.busy"/);
});
