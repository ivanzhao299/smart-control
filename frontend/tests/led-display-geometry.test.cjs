const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('LED defaults to detected primary geometry and preserves explicit calibration overrides', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../scripts/start-players.ps1'), 'utf8');
  assert.match(source, /function Get-LedRect[\s\S]*Where-Object \{ \$_\.Primary \}/);
  assert.match(source, /if \(-not \$explicitLedRect\) \{ \$lr = Get-LedRect \}/);
  for (const option of ['Slot1X', 'Slot1Y', 'ScreenW', 'ScreenH']) {
    assert.ok(source.includes(`$PSBoundParameters.ContainsKey('${option}')`));
  }
  assert.match(source, /Start-Slot -N 1 -X \$lr.X -Y \$lr.Y -W \$lr.Width -H \$lr.Height/);
  assert.match(source, /Start-Slot -N 1 -X \$Slot1X -Y \$Slot1Y -W \$ScreenW -H \$ScreenH/);
  assert.doesNotMatch(source, /ChangeDisplaySettings|SetDisplayConfig/);
});
