const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('watchdog reads scoped device state with protected credential, not user-only channel API', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../scripts/player-watchdog.ps1'), 'utf8');
  assert.ok(!source.includes('/api/playback/channels'));
  assert.ok(source.includes('resolve-player-token-file.ps1'));
  assert.ok(source.includes('/api/player-device/'));
  assert.ok(source.includes("'X-Player-Token'=$deviceToken"));
  assert.ok(source.includes('@(1, 2, 3)'));
  assert.ok(source.includes('$resp.data.slot -ne $slot'));
  assert.ok(source.includes('$deviceToken = $null'));
  assert.ok(!source.includes("Log ('backend unreachable, skip: ' + $_.Exception.Message)"));
});
test('fullscreen window handle cannot overwrite case-insensitive height parameter', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../scripts/start-players.ps1'), 'utf8');
  const section = source.slice(source.indexOf('function Force-ExactFullscreen'), source.indexOf('function Start-Slot'));
  assert.ok(!/\$h\s*=/i.test(section));
  assert.ok(section.includes('SetWindowPos($windowHandle, [IntPtr]::Zero, $X, $Y, $W, $H,'));
});
