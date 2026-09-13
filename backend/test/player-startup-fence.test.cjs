const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = name => fs.readFileSync(path.join(__dirname, '../../scripts', name), 'utf8');

test('kiosk startup checks release hold before any player shutdown, but permits explicit stop', () => {
  const source = script('start-players.ps1');
  const guard = source.indexOf("if (-not $Stop) {\n  $releaseRoot");
  const check = source.indexOf("'assert-release-not-held.ps1'", guard);
  const failure = source.indexOf('if (-not $?) { exit 1 }', check);
  assert.ok(guard > 0 && check > guard && failure > check);
  assert.ok(failure < source.indexOf('function Stop-Players'));
  assert.ok(source.includes('if ($Stop) { Stop-Players; exit 0 }'));
});

test('background music checks release hold before native initialization or log writes', () => {
  const source = script('bgm-player.ps1');
  const check = source.indexOf("'assert-release-not-held.ps1'");
  const failure = source.indexOf('if (-not $?) { exit 1 }', check);
  assert.ok(check > 0 && failure > check);
  assert.ok(failure < source.indexOf('Add-Type'));
  assert.ok(failure < source.indexOf('Add-Content'));
});

test('both native daemons use the shared path resolver without putting tokens in launch arguments', () => {
  for (const name of ['bgm-player.ps1', 'ppt-player.ps1']) {
    const source = script(name);
    assert.ok(source.includes("'resolve-player-token-file.ps1'"));
    assert.ok(!source.includes('$credentialFile = $env:SMART_CONTROL_PLAYER_TOKEN_FILE'));
    assert.ok(source.includes('[System.IO.File]::ReadAllText($credentialFile).Trim()'));
  }
});
