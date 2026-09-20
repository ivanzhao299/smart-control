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

test('authored LED pages and editable backgrounds use the native 3612x1462 canvas', () => {
  const welcome = fs.readFileSync(path.join(__dirname, '../public/welcome/index.html'), 'utf8');
  const parkCss = fs.readFileSync(path.join(__dirname, '../public/park-ops/css/style.css'), 'utf8');
  const parkJs = fs.readFileSync(path.join(__dirname, '../public/park-ops/js/app.js'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/PlayerConsole.vue'), 'utf8');

  assert.match(welcome, /html, body \{ width: 3612px; height: 1462px/);
  assert.match(welcome, /const LED_WIDTH = 3612;\s*const LED_HEIGHT = 1462;/);
  assert.match(welcome, /object-fit: none/);
  assert.doesNotMatch(welcome, /style\.zoom|function fitViewport/);
  assert.match(parkCss, /#app\{[^}]*width:3612px;height:1462px/);
  assert.match(parkJs, /const BASE_W=3612,BASE_H=1462/);
  assert.match(editor, /const LED_CANVAS_RESOLUTION = '3612x1462'/);
  assert.match(editor, /resolution\?\.toLowerCase\(\) === LED_CANVAS_RESOLUTION/);
  assert.match(editor, /normalizeWelcomeBackground\(file\)/);
});
