const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dashboardPath = path.resolve(__dirname, '../public/park-ops/index.html');
const html = fs.readFileSync(dashboardPath, 'utf8');

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
