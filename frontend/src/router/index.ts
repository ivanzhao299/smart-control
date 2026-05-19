import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

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
      { path: 'users', name: 'admin-users', component: () => import('@/pages/admin/UsersAdmin.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('@/pages/admin/SettingsAdmin.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
