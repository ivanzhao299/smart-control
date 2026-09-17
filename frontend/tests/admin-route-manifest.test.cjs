const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vueRouter = require('vue-router');

const read = file => fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8');
function load(source, requireModule) {
  const exports = {};
  const compiled = ts.transpileModule(source.replaceAll('import.meta.env.BASE_URL', "'/control/'"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require: requireModule, performance });
  return exports;
}
const component = { default: { render: () => null } };
const manifest = load(read('router/admin-route-manifest.ts'), () => component);
const paths = ['monitor', 'alerts', 'devices', 'scenes', 'scenes/:id/actions', 'scheduler',
  'scene-executions', 'test-center', 'debug', 'video-binding', 'uat', 'logs', 'hardware',
  'zones-config', 'light-zones', 'power-circuits', 'audio-config', 'app-release', 'drivers',
  'brands', 'system-branding', 'audit', 'users', 'settings', 'park-ops-metrics'];

test('admin registry preserves all 25 routes and every route explicitly requires administrator authentication', () => {
  const records = manifest.createAdminChildRoutes();
  assert.deepEqual(Array.from(manifest.adminRouteManifest, r => r.path), paths);
  assert.equal(new Set(records.map(r => r.path)).size, 26);
  assert.equal(new Set(manifest.adminRouteManifest.map(r => r.name)).size, 25);
  assert.equal(records[0].redirect.name, 'admin-monitor');
  assert.ok(records.every(r => r.meta.adminRequired === true));
  assert.equal(records.find(r => r.name === 'admin-scene-actions').props, true);
  for (const route of manifest.adminRouteManifest) {
    assert.equal(route.name, `admin-${route.path === 'scenes/:id/actions' ? 'scene-actions' : route.path}`);
  }
});

test('all 13 navigation labels keep their existing section and order', () => {
  const groups = manifest.adminNavigationGroups;
  assert.deepEqual(Array.from(groups, g => g.section), ['日常运行', '设备与分区', '日志与诊断', '系统管理']);
  assert.deepEqual(Array.from(groups.flatMap(g => g.items), i => `${i.name}:${i.label}`), [
    'admin-monitor:运维监控', 'admin-alerts:报警中心', 'admin-scenes:场景管理', 'admin-scheduler:定时任务',
    'admin-devices:设备管理', 'admin-hardware:硬件清单', 'admin-zones-config:分区配置', 'admin-video-binding:视频绑定',
    'admin-logs:日志中心', 'admin-test-center:测试 / 调试', 'admin-park-ops-metrics:运营数据',
    'admin-users:用户管理', 'admin-settings:系统设置',
  ]);
});

test('all 12 hidden deep links resolve to an existing menu parent without exposing duplicate entries', () => {
  const aliases = {
    'admin-scene-actions': 'admin-scenes', 'admin-debug': 'admin-test-center', 'admin-uat': 'admin-test-center',
    'admin-scene-executions': 'admin-logs', 'admin-audit': 'admin-logs', 'admin-drivers': 'admin-hardware',
    'admin-brands': 'admin-hardware', 'admin-light-zones': 'admin-zones-config',
    'admin-power-circuits': 'admin-zones-config', 'admin-audio-config': 'admin-zones-config',
    'admin-system-branding': 'admin-settings', 'admin-app-release': 'admin-settings',
  };
  const menu = manifest.adminNavigationGroups.flatMap(g => g.items).map(i => i.name);
  for (const [child, parent] of Object.entries(aliases)) {
    assert.equal(manifest.adminMenuName(child), parent);
    assert.ok(menu.includes(parent));
    assert.ok(!menu.includes(child));
  }
  assert.equal(manifest.adminMenuName('admin-monitor'), 'admin-monitor');
  assert.equal(manifest.adminMenuName('unknown'), 'unknown');
});

test('idle prefetch uses exactly the existing seven page loaders and tolerates optional download failure', async () => {
  const loaded = [];
  const registry = load(read('router/admin-route-manifest.ts'), name => {
    loaded.push(name);
    throw new Error('offline');
  });
  registry.prefetchAdminRoutes();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(loaded.sort(), ['MonitorAdmin', 'ScenesAdmin', 'DevicesAdmin', 'HardwareHubAdmin',
    'ZonesConfigAdmin', 'LogsHubAdmin', 'SettingsHubAdmin'].map(name => `@/pages/admin/${name}.vue`).sort());
});

function appRouter(authenticated, clientAuthenticated = false) {
  let roleRefreshes = 0;
  const registry = load(read('router/admin-route-manifest.ts'), () => component);
  const exports = load(read('router/index.ts'), name => {
    if (name === 'vue-router') return { ...vueRouter, createWebHistory: () => vueRouter.createMemoryHistory('/control/') };
    if (name === './admin-route-manifest') return registry;
    if (name === './main-route-manifest') return { mainRouteManifest: [{ path: '', name: 'dashboard', load: async () => component }] };
    if (name === '@/stores/admin-auth') return { useAdminAuthStore: () => ({ ensureChecked: async () => authenticated }) };
    if (name === '@/stores/client-auth') return { useClientAuthStore: () => ({ isAuthed: clientAuthenticated }) };
    if (name === '@/stores/permission') return { usePermissionStore: () => ({ refresh: () => { roleRefreshes++; return new Promise(() => {}); } }) };
    if (name === '@/services/http') return { api: { get: async () => ({ kind: 'user' }) } };
    if (name === '@/services/rum.service') return { trackRouteChange: () => {} };
    if (name === '@/services/pwa-recovery') return { isStalePwaAssetError: () => false };
    if (name.endsWith('.vue')) return component;
    throw new Error(`Unexpected import: ${name}`);
  });
  return { router: exports.router, roleRefreshes: () => roleRefreshes };
}

test('actual router guards reject anonymous and client-only access to every admin deep link', async () => {
  for (const clientAuthenticated of [false, true]) {
    const { router } = appRouter(false, clientAuthenticated);
    for (const path of paths) {
      const target = `/admin/${path.replace(':id', '42')}?source=test`;
      await router.push(target);
      assert.equal(router.currentRoute.value.name, 'admin-login');
      assert.equal(router.currentRoute.value.query.redirect, target);
    }
  }
});

test('actual router admits administrators without client login or awaiting UI permissions and preserves scene params', async () => {
  const app = appRouter(true);
  await app.router.push('/admin');
  assert.equal(app.router.currentRoute.value.name, 'admin-monitor');
  for (const path of paths) {
    await app.router.push(`/admin/${path.replace(':id', '42')}`);
    assert.equal(app.router.currentRoute.value.meta.adminRequired, true);
    assert.notEqual(app.router.currentRoute.value.name, 'admin-login');
    if (path.includes(':id')) assert.equal(app.router.currentRoute.value.params.id, '42');
  }
  assert.ok(app.roleRefreshes() >= 25);
});

test('router and admin layout consume the registry instead of maintaining duplicate lists', () => {
  const router = read('router/index.ts');
  const layout = read('layouts/AdminLayout.vue');
  assert.match(router, /children: createAdminChildRoutes\(\)/);
  assert.match(layout, /const groups = adminNavigationGroups/);
  assert.match(layout, /adminMenuName\(cur\)/);
  assert.match(layout, /prefetchAdminRoutes\(\)/);
  assert.doesNotMatch(layout, /MENU_ALIAS|import\('@\/pages\/admin\//);
  assert.doesNotMatch(router, /import\('@\/pages\/admin\/(?!AdminLogin)/);
});
