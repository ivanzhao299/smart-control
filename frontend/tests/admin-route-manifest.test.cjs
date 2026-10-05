const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = relative => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
const source = read('src/router/admin-route-manifest.ts');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports = {};
vm.runInNewContext(compiled, { exports: moduleExports, require: () => ({}) });

test('admin manifest preserves every route exactly once with explicit access metadata', () => {
  const routes = moduleExports.adminRouteManifest;
  const names = Array.from(routes, route => route.name);
  const paths = Array.from(routes, route => route.path);

  assert.deepEqual(names, [
    'admin-monitor', 'admin-alerts', 'admin-devices', 'admin-scenes', 'admin-scene-actions',
    'admin-scheduler', 'admin-energy', 'admin-scene-executions', 'admin-test-center', 'admin-debug',
    'admin-video-binding', 'admin-uat', 'admin-logs', 'admin-hardware', 'admin-zones-config',
    'admin-light-zones', 'admin-power-circuits', 'admin-audio-config', 'admin-app-release',
    'admin-testflight', 'admin-drivers', 'admin-brands', 'admin-system-branding', 'admin-audit',
    'admin-users', 'admin-settings', 'admin-park-ops-metrics',
  ]);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(routes.every(route => route.access === 'admin'));
  assert.ok(routes.every(route => typeof route.load === 'function'));
});

test('admin navigation groups and deep links resolve from the route manifest', () => {
  const groups = moduleExports.adminNavigationGroups;
  assert.deepEqual(Array.from(groups, group => group.section), [
    '日常运行', '设备与分区', '日志与诊断', '系统管理',
  ]);
  assert.deepEqual(Array.from(groups, group => (
    `${group.section}:${Array.from(group.items, item => `${item.name}:${item.label}`).join(',')}`
  )), [
    '日常运行:admin-monitor:运维监控,admin-alerts:报警中心,admin-scenes:场景管理,admin-scheduler:定时任务,admin-energy:能源管理',
    '设备与分区:admin-devices:设备管理,admin-hardware:硬件清单,admin-zones-config:分区配置,admin-video-binding:视频绑定',
    '日志与诊断:admin-logs:日志中心,admin-test-center:测试 / 调试',
    '系统管理:admin-park-ops-metrics:运营数据,admin-users:用户管理,admin-testflight:iOS 测试,admin-settings:系统设置',
  ]);

  const aliases = {
    'admin-scene-actions': 'admin-scenes',
    'admin-debug': 'admin-test-center',
    'admin-uat': 'admin-test-center',
    'admin-scene-executions': 'admin-logs',
    'admin-audit': 'admin-logs',
    'admin-drivers': 'admin-hardware',
    'admin-brands': 'admin-hardware',
    'admin-light-zones': 'admin-zones-config',
    'admin-power-circuits': 'admin-zones-config',
    'admin-audio-config': 'admin-zones-config',
    'admin-system-branding': 'admin-settings',
    'admin-app-release': 'admin-settings',
  };
  for (const [route, target] of Object.entries(aliases)) {
    assert.equal(moduleExports.adminMenuTargetName(route), target);
  }
  assert.equal(moduleExports.adminMenuTargetName('admin-monitor'), 'admin-monitor');
  assert.equal(moduleExports.adminMenuTargetName('missing'), 'missing');
});

test('router and layout consume admin route metadata without duplicate page lists', () => {
  const router = read('src/router/index.ts');
  const layout = read('src/layouts/AdminLayout.vue');

  assert.match(router, /\.\.\.adminRouteManifest\.map/);
  assert.match(router, /adminRequired: route\.access === 'admin'/);
  assert.match(layout, /adminNavigationGroups/);
  assert.match(layout, /adminMenuTargetName\(cur\)/);
  assert.match(layout, /idleAdminRouteNames/);
  assert.match(layout, /loadAdminRoute\(name\)/);
  assert.doesNotMatch(`${router}\n${layout}`, /import\('@\/pages\/admin\/(?:Monitor|Scenes|Devices|HardwareHub|ZonesConfig|LogsHub|SettingsHub)Admin\.vue'\)/);
});

test('idle prefetch names are manifest-backed and loadable', () => {
  assert.deepEqual(Array.from(moduleExports.idleAdminRouteNames), [
    'admin-monitor', 'admin-devices', 'admin-scenes', 'admin-energy', 'admin-logs',
    'admin-hardware', 'admin-zones-config', 'admin-settings',
  ]);
  for (const name of moduleExports.idleAdminRouteNames) {
    assert.equal(typeof moduleExports.adminRouteManifest.find(route => route.name === name)?.load, 'function');
  }
  assert.equal(moduleExports.loadAdminRoute('missing'), undefined);
});
