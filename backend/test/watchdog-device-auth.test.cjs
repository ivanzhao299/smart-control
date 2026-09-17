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

test('deployment gate recovers the LED player only through the interactive watchdog', () => {
  const gate = fs.readFileSync(path.join(__dirname, '../../scripts/ensure-player-runtime.ps1'), 'utf8');
  const deploy = fs.readFileSync(path.join(__dirname, '../../scripts/deploy-from-ci.ps1'), 'utf8');
  const resume = fs.readFileSync(path.join(__dirname, '../../scripts/resume-gk9000-release.ps1'), 'utf8');

  assert.ok(gate.includes("$taskName = 'SmartControl-PlayerWatchdog'"));
  assert.ok(gate.includes("Principal.LogonType -ne 'Interactive'"));
  assert.ok(gate.includes("Principal.RunLevel -ne 'Highest'"));
  assert.ok(gate.includes('Enable-ScheduledTask -TaskName $taskName'));
  assert.ok(gate.includes('Start-ScheduledTask -TaskName $taskName'));
  assert.ok(gate.includes('/api/player-device/1/state'));
  assert.ok(gate.includes("'X-Player-Token'=$deviceToken"));
  assert.ok(gate.includes("throw 'LED player heartbeat is stale.'"));
  assert.ok(!gate.includes('start-players.ps1'));
  assert.ok(!gate.includes('Start-Process'));

  const gatePosition = deploy.indexOf("'scripts\\ensure-player-runtime.ps1'");
  const verifierPosition = deploy.indexOf("'scripts\\verify-deploy.js'");
  assert.ok(gatePosition > 0 && verifierPosition > gatePosition);
  assert.ok(deploy.includes('& $playerRuntimeGate -Apply'));
  assert.ok(deploy.includes('& $playerRuntimeGate 2>&1'));
  assert.ok(resume.includes("$task.Name -eq 'SmartControl-PlayerWatchdog' -or $task.Enabled"));
  assert.ok(resume.includes("Start-ScheduledTask -TaskName 'SmartControl-PlayerWatchdog'"));
});
test('fullscreen window handle cannot overwrite case-insensitive height parameter', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../scripts/start-players.ps1'), 'utf8');
  const section = source.slice(source.indexOf('function Force-ExactFullscreen'), source.indexOf('function Start-Slot'));
  assert.ok(!/\$h\s*=/i.test(section));
  assert.ok(section.includes('SetWindowPos($windowHandle, [IntPtr]::Zero, $X, $Y, $W, $H,'));
});
