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
    'dashboard', 'lighting', 'dali-lights', 'dali-diagnose', 'led',
    'projector', 'audio', 'hvac', 'power', 'media', 'status',
  ]);
  assert.deepEqual(routePaths, [
    '', 'lighting', 'dali-lights', 'dali-diagnose', 'led',
    'projector', 'audio', 'hvac', 'power', 'media', 'status',
  ]);
  assert.equal(new Set(routeNames).size, routeNames.length);
  assert.equal(new Set(routePaths).size, routePaths.length);
  assert.deepEqual(Array.from(navigation, item => `${item.section}:${item.name}:${item.label}`), [
    'main:dashboard:首页', 'main:lighting:灯光', 'main:led:LED 大屏',
    'main:projector:投影仪', 'main:audio:音响', 'main:hvac:空调',
    'main:power:电源', 'tools:media:媒体', 'tools:status:状态',
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

test('router and layouts consume the manifest instead of maintaining page import lists', () => {
  const router = read('src/router/index.ts');
  const app = read('src/App.vue');
  const layout = read('src/layouts/MainLayout.vue');
  assert.match(router, /children: mainRouteManifest\.map/);
  assert.match(layout, /mainNavigationItems/);
  assert.match(layout, /idleMainRouteNames/);
  assert.match(layout, /loadMainRoute\(name\)/);
  assert.doesNotMatch(`${router}\n${app}\n${layout}`, /import\('@\/pages\/(?:Dashboard|Lighting|DaliLights|DaliDiagnose|Led|Projector|Audio|Hvac|Power|Media|Status)Page\.vue'\)/);
});
