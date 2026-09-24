const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const script = name => fs.readFileSync(path.resolve(__dirname, '../../scripts', name), 'utf8');

test('startup and recovery share dedicated profile paths and never touch personal browser caches', () => {
  const startup = script('start-players.ps1'), profile = script('player-profile-path.ps1');
  assert.match(startup, /\$dataDir = Get-PlayerProfilePath -Slot \$N/);
  assert.match(startup, /Clear-PlayerProfileCache -Slot \$n/);
  assert.doesNotMatch(startup, /Microsoft\\Edge\\User Data/);
  assert.match(startup, /still running; refusing cache cleanup/);
  assert.match(profile, /Remove-Item -LiteralPath \$target -Recurse -Force -ErrorAction Stop/);
  assert.match(profile, /ReparsePoint/);
  assert.equal([...profile].some(c => c.charCodeAt(0) > 127), false, 'Windows PowerShell 5.1 script must remain ASCII');
});

test('Windows cache fixture preserves credentials, personal profile and unrelated slots', {skip: process.platform !== 'win32'}, () => {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'fixtures/player-cache.ps1')], {stdio: 'pipe'});
});
