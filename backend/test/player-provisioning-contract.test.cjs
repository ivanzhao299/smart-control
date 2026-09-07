const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../scripts/provision-player-credentials.ps1'), 'utf8');
test('initial provisioning gates all mutations behind explicit apply and stopped-writer verification', () => {
  const apply = source.indexOf('if (-not $Apply)');
  const stopped = source.indexOf("'assert-gk9000-writers-stopped.ps1'");
  const create = source.indexOf('[IO.Directory]::CreateDirectory');
  assert.ok(apply > 0 && stopped > apply && create > stopped);
  for (const mutation of ['[IO.File]::WriteAllText', '[IO.File]::WriteAllBytes', '[Environment]::SetEnvironmentVariable']) {
    assert.ok(source.indexOf(mutation) > create);
  }
});
test('directory protection precedes secrets and exact environment backup precedes replacement', () => {
  assert.ok(source.indexOf('$actualAcl.AreAccessRulesProtected') < source.indexOf('$rng.GetBytes'));
  assert.ok(source.indexOf("'backend.env.before'") < source.indexOf('[IO.File]::WriteAllText($envPath'));
  assert.ok(source.includes('initial provisioning refuses overwrite'));
  assert.ok(source.includes('Existing device configuration requires'));
});
test('provisioning never prints a token and defines separate display identities', () => {
  assert.ok(!/Write-(?:Output|Host|Verbose|Debug)[^\n]*\$(?:token|random|bytes|existing)\b/.test(source));
  assert.ok(source.includes("id='gk9000-led';slots=@(1)"));
  assert.ok(source.includes("id='gk9000-projector';slots=@(2)"));
  assert.ok(source.includes("id='gk9000-native';slots=@(1,2,3)"));
});
