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
    'admin-scheduler', 'admin-energy', 'admin-auto-switch', 'admin-scene-executions', 'admin-test-center', 'admin-debug',
    'admin-video-binding', 'admin-lpr', 'admin-uat', 'admin-logs', 'admin-hardware', 'admin-zones-config',
    'admin-light-zones', 'admin-power-circuits', 'admin-audio-config', 'admin-change-password', 'admin-app-release',
    'admin-testflight', 'admin-drivers', 'admin-brands', 'admin-system-branding', 'admin-audit',
    'admin-users', 'admin-roles', 'admin-settings', 'admin-park-ops-metrics',
  ]);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(paths).size, paths.length);
  const MODULES = [
    'monitor', 'alerts', 'scenes', 'scheduler', 'energy', 'power-timing', 'devices', 'hardware',
    'zones', 'video', 'lpr', 'diagnostics', 'uat', 'metrics', 'branding', 'app-release', 'system',
  ];
  // 2026-10-16：自动开关/定时通断归入 power-timing（hardware 唯一保留写权限）。
  assert.equal(routes.find(route => route.name === 'admin-auto-switch').module, 'power-timing');
  // 非自助页必须归属一个已知分域；self 自助页不占模块。
  assert.ok(routes.every(route => (route.self ? route.module === undefined : MODULES.includes(route.module))));
  assert.ok(routes.every(route => typeof route.load === 'function'));
  const changePassword = routes.find(route => route.name === 'admin-change-password');
  assert.equal(changePassword.self, true);
  assert.equal(changePassword.module, undefined);
  assert.equal(routes.find(route => route.name === 'admin-app-release').module, 'app-release');
  assert.equal(routes.find(route => route.name === 'admin-system-branding').module, 'branding');
});

test('admin navigation groups and deep links resolve from the route manifest', () => {
  const groups = moduleExports.adminNavigationGroups;
  assert.deepEqual(Array.from(groups, group => group.section), [
    '总览', '场景与控制', '能源', '设备与空间', '诊断', '系统',
  ]);
  assert.deepEqual(Array.from(groups, group => (
    `${group.section}:${Array.from(group.items, item => `${item.name}:${item.label}`).join(',')}`
  )), [
    '总览:admin-monitor:运维监控,admin-alerts:报警中心,admin-park-ops-metrics:运营数据',
    '场景与控制:admin-scenes:场景管理,admin-scheduler:定时任务,admin-lpr:车牌道闸',
    '能源:admin-energy:能源台账,admin-auto-switch:自动开关',
    '设备与空间:admin-hardware:硬件清单,admin-devices:设备管理,admin-zones-config:分区配置,admin-video-binding:视频绑定',
    '诊断:admin-logs:日志中心,admin-test-center:测试 / 调试',
    '系统:admin-settings:系统设置,admin-users:用户管理,admin-roles:角色管理,admin-system-branding:系统品牌,admin-app-release:APP 版本,admin-testflight:iOS 测试',
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
  };
  // 系统品牌 / APP 版本已从系统设置合并页拆成独立顶级菜单，不再挂在 settings 下。
  assert.equal(moduleExports.adminMenuTargetName('admin-system-branding'), 'admin-system-branding');
  assert.equal(moduleExports.adminMenuTargetName('admin-app-release'), 'admin-app-release');
  // 修改密码为全员自助项。
  assert.equal(moduleExports.adminMenuTargetName('admin-change-password'), 'admin-change-password');
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
  // self 路由（修改密码）无 module，router 须做存在性收窄后再写 adminModule。
  assert.match(router, /adminModule: 'module' in route \? route\.module : undefined/);
  assert.match(layout, /adminNavigationGroups/);
  assert.match(layout, /adminMenuTargetName\(cur\)/);
  assert.match(layout, /idleAdminRouteNames/);
  assert.match(layout, /loadAdminRoute\(name\)/);
  assert.doesNotMatch(`${router}\n${layout}`, /import\('@\/pages\/admin\/(?:Monitor|Scenes|Devices|HardwareHub|ZonesConfig|LogsHub|SettingsHub)Admin\.vue'\)/);
});

test('idle prefetch names are manifest-backed and loadable', () => {
  // 第二十一轮：全菜单页预取（消除首次切页 chunk 延迟）。名单与 manifest 中
  // prefetchOnIdle 保持单一事实来源，避免改 manifest 后硬编码失配。
  // Array.from 先把 vm context 里的 manifest 转成主 realm 数组，避免跨 realm 原型失配。
  const expected = Array.from(moduleExports.adminRouteManifest)
    .filter(route => 'prefetchOnIdle' in route && route.prefetchOnIdle)
    .map(route => route.name);
  assert.deepEqual(Array.from(moduleExports.idleAdminRouteNames), expected);
  // 每个可见菜单页都应被预取（这是本轮"全菜单预取"的设计目标）。
  const visibleMenuRoutes = Array.from(moduleExports.adminRouteManifest)
    .filter(route => 'navigation' in route && route.navigation)
    .map(route => route.name);
  for (const name of visibleMenuRoutes) {
    assert.ok(expected.includes(name), `菜单页 ${name} 应开启 idle 预取`);
  }
  for (const name of moduleExports.idleAdminRouteNames) {
    assert.equal(typeof moduleExports.adminRouteManifest.find(route => route.name === name)?.load, 'function');
  }
  assert.equal(moduleExports.loadAdminRoute('missing'), undefined);
});
