const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dashboardPath = path.resolve(__dirname, '../public/park-ops/index.html');
const html = fs.readFileSync(dashboardPath, 'utf8');
const editorJs = fs.readFileSync(path.resolve(__dirname, '../public/park-ops/park-ops-editor.js'), 'utf8');
const editorCss = fs.readFileSync(path.resolve(__dirname, '../public/park-ops/park-ops-editor.css'), 'utf8');
const viewerJs = fs.readFileSync(path.resolve(__dirname, '../public/park-ops/park-ops-3d.js'), 'utf8');
const glbPath = path.resolve(__dirname, '../public/park-ops/park-aerial-relief.glb');
const adminLogin = fs.readFileSync(path.resolve(__dirname, '../src/pages/admin/AdminLogin.vue'), 'utf8');

test('park dashboard keeps the real aerial image and has no remote runtime assets', () => {
  assert.match(html, /url\('\.\/park-aerial\.jpg'\)/);
  assert.doesNotMatch(html, /<(script|link)[^>]+https?:\/\//i);
});

test('park dashboard ships a compact glTF 2.0 relief model and local-only viewer', () => {
  const glb = fs.readFileSync(glbPath);
  assert.equal(glb.subarray(0, 4).toString('ascii'), 'glTF');
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  assert.ok(glb.length < 1_000_000, `expected sub-1MB GLB, got ${glb.length} bytes`);
  const jsonLength = glb.readUInt32LE(12);
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
  const model = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8').trim());
  assert.equal(model.asset.version, '2.0');
  assert.equal(model.meshes[0].extras.kind, 'single-image-2.5d-relief');
  assert.equal(model.meshes[0].extras.vertices, 6528);
  assert.equal(model.meshes[0].extras.triangles, 12730);
  assert.equal(model.images[0].mimeType, 'image/jpeg');
  assert.match(html, /type="importmap"/);
  assert.match(html, /park-ops-3d\.js\?v=20260908-camera-hotfix/);
  assert.match(viewerJs, /\.\/park-aerial-relief\.glb/);
  assert.match(viewerJs, /static-fallback/);
  assert.match(viewerJs, /prefers-reduced-motion/);
  assert.match(viewerJs, /document\.hidden/);
  assert.match(viewerJs, /powerPreference: 'low-power'/);
  assert.match(viewerJs, /antialias: false/);
  assert.match(viewerJs, /renderer\.setPixelRatio\(1\)/);
  assert.doesNotMatch(viewerJs, /https?:\/\//);
  for (const runtimeAsset of [
    'vendor/three.module.min.js',
    'vendor/three.core.min.js',
    'vendor/loaders/GLTFLoader.js',
    'vendor/utils/BufferGeometryUtils.js',
    'vendor/utils/SkeletonUtils.js',
    'vendor/THREE-LICENSE.txt',
  ]) {
    assert.ok(fs.existsSync(path.resolve(__dirname, '../public/park-ops', runtimeAsset)), `missing local runtime asset ${runtimeAsset}`);
  }
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
  assert.match(html, /version:'2026-09-08-camera-hotfix'/);
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
  assert.doesNotMatch(html, /class="flow(?:\s|")/);
  assert.doesNotMatch(html, /flow-node|flowGradient|roadFlow|nodePulse/);
  assert.match(html, /\.phase\{[^}]*pointer-events:all/);
  assert.match(html, /body:before\{display:none\}/);
  assert.match(html, /\.cam:before,\.cam:after\{display:none\}/);
});

test('low-power mode removes ambient and card sweep loops and caps 3D work', () => {
  assert.match(html, /#ambient\{display:none\}/);
  assert.match(html, /document\.getElementById\('ambient'\)\.hidden=true/);
  assert.match(html, /\.kpi:before\{content:none;display:none\}/);
  assert.match(html, /\.phase\{animation:none/);
  assert.match(html, /\.cloud\{display:none;animation:none\}/);
  assert.doesNotMatch(html, /requestAnimationFrame\(drawAmbient\)/);
  assert.doesNotMatch(viewerJs, /requestAnimationFrame/);
  assert.match(viewerJs, /fpsCap: 8/);
  assert.match(viewerJs, /renderScale: 0\.82/);
  assert.match(viewerJs, /renderer\.setSize\(Math\.round\(width \* state\.renderScale\)/);
  assert.match(viewerJs, /mapPage\.classList\.contains\('active'\)/);
  assert.match(viewerJs, /document\.hidden/);
});

test('dashboard restores the usable forward camera and removes the incorrect image rotation controls', () => {
  assert.doesNotMatch(viewerJs, /id="parkPerspectiveToggle"/);
  assert.doesNotMatch(viewerJs, /id="parkReverseToggle"/);
  assert.match(viewerJs, /perspective: false/);
  assert.match(viewerJs, /rotation: 0/);
  assert.match(viewerJs, /classList\.remove\('view-perspective', 'view-reversed'\)/);
  assert.match(viewerJs, /document\.body\.classList\.contains\('park-editing'\)/);
  assert.match(html, /body\.park-editing \.map-scene\{[^}]*transform:none!important/);
  assert.match(html, /\.map-scene\{[^}]*inset:0[^}]*transform:none/);
  assert.doesNotMatch(html, /\.map\.view-perspective\.view-reversed/);
});

test('shared calibration editor supports phase vertices, buildings and text styles', () => {
  assert.match(html, /park-ops-editor\.css/);
  assert.match(html, /park-ops-editor\.js/);
  assert.match(editorJs, /system-branding\/park-ops/);
  assert.match(editorJs, /phase-handle/);
  assert.match(editorJs, /dblclick/);
  assert.match(editorJs, /contextmenu/);
  assert.match(editorJs, /function deletePhaseById/);
  assert.match(editorJs, /event\.target\.closest\('\.phase'\)/);
  assert.match(editorJs, /pe-building-company/);
  assert.match(editorJs, /pe-text-size/);
  assert.match(editorJs, /pe-text-color/);
  assert.match(editorCss, /park-text-selected/);
  assert.doesNotThrow(() => new Function(editorJs));
});

test('dashboard exposes a visible calibration entry without editing the URL by hand', () => {
  assert.match(html, /id="openCalibration"[^>]*>⚙ 布局校准/);
  assert.match(html, /PARK_OPEN_CALIBRATION/);
  assert.match(editorJs, /searchParams\.set\('edit', '1'\)/);
  assert.match(editorJs, /admin\/login\?redirect=/);
  assert.match(editorJs, /管理员登录后返回/);
  assert.match(editorJs, /response\.status === 401/);
  assert.match(editorJs, /localStorage\.getItem\('sc\.client\.token'\)/);
  assert.match(editorJs, /headers\['X-Client-Token'\]/);
  assert.match(editorJs, /\.\.\.authHeaders/);
  assert.match(html, /park-ops-editor\.js\?v=20260908-camera-hotfix/);
  assert.match(html, /park-ops-editor\.css\?v=20260908-camera-hotfix/);
  assert.match(adminLogin, /parkEditorTarget/);
  const systemBranding = fs.readFileSync(path.resolve(__dirname, '../src/pages/admin/SystemBrandingAdmin.vue'), 'utf8');
  assert.match(systemBranding, /park-ops\/index\.html\?edit=1&v=20260908-camera-hotfix/);
  assert.match(editorJs, /当前是本地文件预览，无法保存/);
  assert.match(adminLogin, /new URLSearchParams/);
  assert.match(adminLogin, /requested === '\/admin' \|\| requested\.startsWith\('\/admin\/'\)/);
  assert.match(editorCss, /park-editing #openCalibration\{display:none\}/);
});

test('page keyboard shortcuts do not intercept editor text input', () => {
  assert.match(html, /document\.body\.classList\.contains\('park-editing'\)/);
  assert.match(html, /target\.closest\('input,textarea,select,button,/);
  assert.match(html, /e\.defaultPrevented\|\|e\.isComposing/);
  assert.match(html, /if\(e\.key==='ArrowRight'\|\|e\.key===' '\)\{e\.preventDefault\(\);go\(idx\+1\)\}/);
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
