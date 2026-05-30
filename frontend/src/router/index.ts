import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { trackRouteChange } from '@/services/rum.service';

const routes: RouteRecordRaw[] = [
  // 平板布局 (Sprint-05)
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', name: 'dashboard', component: () => import('@/pages/DashboardPage.vue') },
      { path: 'lighting', name: 'lighting', component: () => import('@/pages/LightingPage.vue') },
      { path: 'led', name: 'led', component: () => import('@/pages/LedPage.vue') },
      { path: 'audio', name: 'audio', component: () => import('@/pages/AudioPage.vue') },
      { path: 'hvac', name: 'hvac', component: () => import('@/pages/HvacPage.vue') },
      { path: 'media', name: 'media', component: () => import('@/pages/MediaPage.vue') },
      { path: 'status', name: 'status', component: () => import('@/pages/StatusPage.vue') },
    ],
  },
  // 后台管理布局 (Sprint-06)
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    children: [
      { path: '', redirect: { name: 'admin-monitor' } },
      { path: 'monitor', name: 'admin-monitor', component: () => import('@/pages/admin/MonitorAdmin.vue') },
      { path: 'alerts', name: 'admin-alerts', component: () => import('@/pages/admin/AlertsAdmin.vue') },
      { path: 'devices', name: 'admin-devices', component: () => import('@/pages/admin/DevicesAdmin.vue') },
      { path: 'scenes', name: 'admin-scenes', component: () => import('@/pages/admin/ScenesAdmin.vue') },
      { path: 'scenes/:id/actions', name: 'admin-scene-actions', component: () => import('@/pages/admin/SceneActionsAdmin.vue'), props: true },
      { path: 'scheduler', name: 'admin-scheduler', component: () => import('@/pages/admin/SchedulerAdmin.vue') },
      { path: 'scene-executions', name: 'admin-scene-executions', component: () => import('@/pages/admin/SceneExecutionsAdmin.vue') },
      { path: 'test-center', name: 'admin-test-center', component: () => import('@/pages/admin/TestCenterAdmin.vue') },
      // Sprint-06 spec 命名别名: /admin/debug → TestCenterAdmin (含单设备测试 + Ping + 端口 + rawResponse)
      { path: 'debug', name: 'admin-debug', component: () => import('@/pages/admin/TestCenterAdmin.vue') },
      { path: 'uat', name: 'admin-uat', component: () => import('@/pages/admin/UatAdmin.vue') },
      { path: 'logs', name: 'admin-logs', component: () => import('@/pages/admin/LogsAdmin.vue') },
      { path: 'hardware', name: 'admin-hardware', component: () => import('@/pages/admin/HardwareAdmin.vue') },
      { path: 'drivers', name: 'admin-drivers', component: () => import('@/pages/admin/DriversAdmin.vue') },
      { path: 'brands', name: 'admin-brands', component: () => import('@/pages/admin/BrandsAdmin.vue') },
      { path: 'audit', name: 'admin-audit', component: () => import('@/pages/admin/AuditAdmin.vue') },
      { path: 'users', name: 'admin-users', component: () => import('@/pages/admin/UsersAdmin.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('@/pages/admin/SettingsAdmin.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  // 用 HTML5 history mode → 干净 URL (/control/status 而不是 /control/#/status)
  // nginx + Vite preview 都已经配 SPA fallback (try_files → index.html), 不会 404.
  // BASE_URL 来自 vite.config 的 base 配置 (生产是 /control/, dev 是 /)
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

// PERFORMANCE_AUDIT P3-#20: 路由切换耗时埋点
let routeStartMs = 0;
let routeFromName = '';
router.beforeEach((_to, from) => {
  routeStartMs = performance.now();
  routeFromName = String(from.name ?? '');
  // 没显式 return → 继续导航
});
router.afterEach((to) => {
  if (routeStartMs > 0) {
    trackRouteChange(routeFromName, String(to.name ?? ''), Math.round(performance.now() - routeStartMs));
    routeStartMs = 0;
  }
});
