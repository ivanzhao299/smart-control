const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dashboardPath = path.resolve(__dirname, '../public/park-ops/index.html');
const html = fs.readFileSync(dashboardPath, 'utf8');
const editorJs = fs.readFileSync(path.resolve(__dirname, '../public/park-ops/park-ops-editor.js'), 'utf8');
const editorCss = fs.readFileSync(path.resolve(__dirname, '../public/park-ops/park-ops-editor.css'), 'utf8');

test('park dashboard keeps the real aerial image and has no remote runtime assets', () => {
  assert.match(html, /url\('\.\/park-aerial\.jpg'\)/);
  assert.doesNotMatch(html, /<(script|link)[^>]+https?:\/\//i);
});

test('park dashboard exposes phase, building and day-night interactions', () => {
  for (const phase of ['一期', '二期', '远期']) assert.match(html, new RegExp(phase));
  assert.doesNotMatch(html, /五期/);
  for (const building of ['01#', '12#']) assert.match(html, new RegExp(building.replace('#', '\\#')));
  assert.match(html, /data-mode="auto"/);
  assert.match(html, /data-mode="day"/);
  assert.match(html, /data-mode="night"/);
  assert.match(html, /sceneForTime/);
  assert.match(html, /const scene=sceneMode==='auto'\?sceneForTime\(d\):sceneMode/);
});

test('park dashboard labels simulated business data and publishes a version marker', () => {
  assert.match(html, /企业名称为演示占位/);
  assert.match(html, /分区、楼栋、企业及业务指标均为演示标注/);
  assert.match(html, /version:'2026-09-08-digital-twin'/);
  assert.match(html, /buildingCount:buildings\.length/);
});

test('embedded dashboard script parses', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'expected an embedded script');
  assert.doesNotThrow(() => new Function(script[1]));
});

test('dashboard fills the viewport by default and removes moving scan lines', () => {
  assert.match(html, /PARK_FIT_MODE\|\|'stretch'/);
  assert.match(editorJs, /fitMode: 'stretch'/);
  assert.doesNotMatch(html, /insertAdjacentHTML\('afterbegin','<i class="panel-scan/);
  assert.doesNotMatch(html, /lineTo\(q\.x/);
  assert.doesNotMatch(html, /@keyframes (scanY|camScan)/);
  assert.match(html, /body:before\{display:none\}/);
  assert.match(html, /\.cam:before,\.cam:after\{display:none\}/);
});

test('shared calibration editor supports phase vertices, buildings and text styles', () => {
  assert.match(html, /park-ops-editor\.css/);
  assert.match(html, /park-ops-editor\.js/);
  assert.match(editorJs, /system-branding\/park-ops/);
  assert.match(editorJs, /phase-handle/);
  assert.match(editorJs, /dblclick/);
  assert.match(editorJs, /contextmenu/);
  assert.match(editorJs, /pe-building-company/);
  assert.match(editorJs, /pe-text-size/);
  assert.match(editorJs, /pe-text-color/);
  assert.match(editorCss, /park-text-selected/);
  assert.doesNotThrow(() => new Function(editorJs));
});

test('dashboard exposes a visible calibration entry without editing the URL by hand', () => {
  assert.match(html, /id="openCalibration"[^>]*>⚙ 布局校准/);
  assert.match(html, /searchParams\.set\('edit','1'\)/);
  assert.match(editorCss, /park-editing #openCalibration\{display:none\}/);
});

test('calibration editor provides explicit create update delete controls', () => {
  for (const control of [
    'pe-phase-add', 'pe-phase-delete',
    'pe-point-add', 'pe-point-delete',
    'pe-building-add', 'pe-building-delete',
    'pe-custom-text-add', 'pe-custom-text-delete',
  ]) assert.match(editorJs, new RegExp(`id="${control}"`));
  assert.match(editorJs, /customTexts/);
  assert.match(editorJs, /draggingPhaseFlag/);
  assert.match(editorJs, /draggingCustomText/);
});
