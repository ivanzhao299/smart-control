const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = relative => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
const source = read('src/router/main-route-manifest.ts');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports = {};
vm.runInNewContext(compiled, { exports: moduleExports, require: () => ({}) });

test('main PWA manifest preserves every route and navigation entry exactly once', () => {
  const routes = moduleExports.mainRouteManifest;
  const navigation = moduleExports.mainNavigationItems;
  const routeNames = Array.from(routes, route => route.name);
  const routePaths = Array.from(routes, route => route.path);

  assert.deepEqual(routeNames, [
    'dashboard', 'lighting', 'dali-lights', 'dali-diagnose', 'led', 'led-program',
    'projector', 'audio', 'hvac', 'power', 'energy', 'media', 'status', 'barrier',
  ]);
  assert.deepEqual(routePaths, [
    '', 'lighting', 'dali-lights', 'dali-diagnose', 'led', 'led-program',
    'projector', 'audio', 'hvac', 'power', 'energy', 'media', 'status', 'barrier',
  ]);
  assert.equal(new Set(routeNames).size, routeNames.length);
  assert.equal(new Set(routePaths).size, routePaths.length);
  assert.deepEqual(Array.from(navigation, item => `${item.section}:${item.name}:${item.label}`), [
    'main:dashboard:首页', 'main:lighting:灯光', 'main:led:LED 大屏',
    'tools:led-program:楼顶广告屏',
    'main:projector:投影仪', 'main:audio:音响', 'main:hvac:空调',
    'main:power:电源',
    'tools:energy:水电', 'tools:media:媒体', 'tools:status:状态', 'tools:barrier:道闸',
  ]);
  assert.ok(navigation.every(item => routeNames.includes(item.name)));
});

test('every navigable non-dashboard page is covered by idle and pointer prefetch metadata', () => {
  const navigable = Array.from(moduleExports.mainNavigationItems, item => item.name).filter(name => name !== 'dashboard');
  assert.deepEqual(Array.from(moduleExports.idleMainRouteNames), navigable);
  for (const name of navigable) {
    assert.equal(typeof moduleExports.mainRouteManifest.find(route => route.name === name)?.load, 'function');
    assert.ok(Array.isArray(moduleExports.mainRoutePrefetchApis(name)));
  }
  assert.equal(moduleExports.loadMainRoute('missing'), undefined);
  assert.deepEqual([...moduleExports.mainRoutePrefetchApis('missing')], []);
});

test('operator main navigation stays limited to daily control entry points', () => {
  const permissions = new Set([
    'dashboard:view', 'lighting:view', 'led:view', 'projector:view',
    'audio:view', 'hvac:view', 'power:view', 'media:view',
  ]);
  const navigation = moduleExports.mainNavigationItemsForRoleByPerms('operator', permissions);
  assert.deepEqual(Array.from(navigation, item => item.name), [
    'dashboard', 'led', 'projector', 'power', 'media',
  ]);
});

test('router and layouts consume the manifest instead of maintaining page import lists', () => {
  const router = read('src/router/index.ts');
  const app = read('src/App.vue');
  const layout = read('src/layouts/MainLayout.vue');
  assert.match(router, /children: mainRouteManifest\.map/);
  assert.match(layout, /mainNavigationItems/);
  assert.match(layout, /idleMainRouteNames/);
  assert.match(layout, /loadMainRoute\(name\)/);
  assert.doesNotMatch(`${router}\n${app}\n${layout}`, /import\('@\/pages\/(?:Dashboard|Lighting|DaliLights|DaliDiagnose|Led|LedProgram|Projector|Audio|Hvac|Power|Energy|Media|Status)Page\.vue'\)/);
});

test('main PWA pages cannot be held blank by transition or permission refresh', () => {
  const router = read('src/router/index.ts');
  const layout = read('src/layouts/MainLayout.vue');
  const outlet = layout.slice(layout.indexOf('<router-view'), layout.indexOf('</router-view>'));

  // 页面切换允许过渡, 但必须是"显式 :duration + 非 out-in"的安全形态: 显式时长让
  // Vue 到点强制收尾、不依赖 transitionend (iOS WKWebView 后台恢复会丢 transitionend);
  // 禁用 mode="out-in" 是因为它在收尾丢失时会永久停在旧页已删、新页未挂的空档白屏。
  const transitionTag = outlet.match(/<transition\b[^>]*>/);
  assert.ok(transitionTag, 'route outlet must declare its <transition> explicitly');
  assert.match(transitionTag[0], /:duration="\d+"/);
  assert.doesNotMatch(transitionTag[0], /mode=["']out-in["']/);
  assert.match(outlet, /<keep-alive :max="6">/);
  assert.match(router, /void usePermissionStore\(\)\.refresh\(\)/);
  assert.doesNotMatch(router, /await usePermissionStore\(\)\.refresh\(\)/);
});
