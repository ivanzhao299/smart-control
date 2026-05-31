import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { trackRouteChange } from '@/services/rum.service';
import { useAdminAuthStore } from '@/stores/admin-auth';
import { useClientAuthStore } from '@/stores/client-auth';

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
      { path: 'power', name: 'power', component: () => import('@/pages/PowerPage.vue') },
      { path: 'media', name: 'media', component: () => import('@/pages/MediaPage.vue') },
      { path: 'status', name: 'status', component: () => import('@/pages/StatusPage.vue') },
    ],
  },
  // 客户端登录页 (业主级别访问门禁 + 服务器地址配置)
  {
    path: '/client-login',
    name: 'client-login',
    component: () => import('@/pages/ClientLogin.vue'),
    meta: { clientPublic: true, adminPublic: true },
  },
  // 后台登录页 (管理员级别, 独立布局, 不进 AdminLayout)
  {
    path: '/admin/login',
    name: 'admin-login',
    component: () => import('@/pages/admin/AdminLogin.vue'),
    meta: { adminPublic: true, clientRequired: true },
  },
  // Kiosk 播控页 — GK9000 上的 Chromium 全屏窗口加载这个 (?slot=1 / ?slot=2)
  // 没鉴权, 直接进, 不进 MainLayout (要纯黑全屏)
  {
    path: '/player',
    name: 'player',
    component: () => import('@/pages/PlayerPage.vue'),
  },
  // 后台管理布局 (Sprint-06) — 全部需要 admin token
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { adminRequired: true },
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
      { path: 'light-zones', name: 'admin-light-zones', component: () => import('@/pages/admin/LightZonesAdmin.vue') },
      { path: 'power-circuits', name: 'admin-power-circuits', component: () => import('@/pages/admin/PowerCircuitsAdmin.vue') },
      { path: 'app-release', name: 'admin-app-release', component: () => import('@/pages/admin/AppReleaseAdmin.vue') },
      { path: 'drivers', name: 'admin-drivers', component: () => import('@/pages/admin/DriversAdmin.vue') },
      { path: 'brands', name: 'admin-brands', component: () => import('@/pages/admin/BrandsAdmin.vue') },
      { path: 'system-branding', name: 'admin-system-branding', component: () => import('@/pages/admin/SystemBrandingAdmin.vue') },
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

// Client auth guard: 业主级别. 除 /client-login 和 player 这种特殊页, 其他都要 token.
// PWA / APP 启动后第一件事走这里 → 没 token 跳 /client-login.
router.beforeEach((to) => {
  // 显式公开页: client-login (输密码 + 配地址), player (kiosk 全屏播放, 无 UI)
  if (to.meta?.clientPublic || to.name === 'player') return true;
  const client = useClientAuthStore();
  if (!client.isAuthed) {
    return { name: 'client-login', query: { redirect: to.fullPath } };
  }
  return true;
});

// Admin auth guard: 进任何 meta.adminRequired 的路由前确保已登录
router.beforeEach(async (to) => {
  if (to.meta?.adminRequired) {
    const authStore = useAdminAuthStore();
    const ok = await authStore.ensureChecked();
    if (!ok) {
      return { name: 'admin-login', query: { redirect: to.fullPath } };
    }
  }
  return true;
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
