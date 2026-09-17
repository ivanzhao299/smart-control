import type { Component } from 'vue';
import type { RouteRecordRaw } from 'vue-router';

type AdminSection = '日常运行' | '设备与分区' | '日志与诊断' | '系统管理';
interface AdminRouteDefinition {
  path: string;
  name: string;
  load: () => Promise<{ default: Component }>;
  navigation?: { section: AdminSection; label: string; order: number };
  menuParent?: string;
  props?: boolean;
  prefetchOnIdle?: boolean;
}

/** One registry for protected routes, menus, deep-link highlighting and chunk prefetch. */
export const adminRouteManifest = [
  { path: 'monitor', name: 'admin-monitor', load: () => import('@/pages/admin/MonitorAdmin.vue'), navigation: { section: '日常运行', label: '运维监控', order: 1 }, prefetchOnIdle: true },
  { path: 'alerts', name: 'admin-alerts', load: () => import('@/pages/admin/AlertsAdmin.vue'), navigation: { section: '日常运行', label: '报警中心', order: 2 } },
  { path: 'devices', name: 'admin-devices', load: () => import('@/pages/admin/DevicesAdmin.vue'), navigation: { section: '设备与分区', label: '设备管理', order: 5 }, prefetchOnIdle: true },
  { path: 'scenes', name: 'admin-scenes', load: () => import('@/pages/admin/ScenesAdmin.vue'), navigation: { section: '日常运行', label: '场景管理', order: 3 }, prefetchOnIdle: true },
  { path: 'scenes/:id/actions', name: 'admin-scene-actions', load: () => import('@/pages/admin/SceneActionsAdmin.vue'), props: true, menuParent: 'admin-scenes' },
  { path: 'scheduler', name: 'admin-scheduler', load: () => import('@/pages/admin/SchedulerAdmin.vue'), navigation: { section: '日常运行', label: '定时任务', order: 4 } },
  { path: 'scene-executions', name: 'admin-scene-executions', load: () => import('@/pages/admin/SceneExecutionsAdmin.vue'), menuParent: 'admin-logs' },
  { path: 'test-center', name: 'admin-test-center', load: () => import('@/pages/admin/TestCenterAdmin.vue'), navigation: { section: '日志与诊断', label: '测试 / 调试', order: 10 } },
  { path: 'debug', name: 'admin-debug', load: () => import('@/pages/admin/TestCenterAdmin.vue'), menuParent: 'admin-test-center' },
  { path: 'video-binding', name: 'admin-video-binding', load: () => import('@/pages/admin/VideoBindingAdmin.vue'), navigation: { section: '设备与分区', label: '视频绑定', order: 8 } },
  { path: 'uat', name: 'admin-uat', load: () => import('@/pages/admin/UatAdmin.vue'), menuParent: 'admin-test-center' },
  { path: 'logs', name: 'admin-logs', load: () => import('@/pages/admin/LogsHubAdmin.vue'), navigation: { section: '日志与诊断', label: '日志中心', order: 9 }, prefetchOnIdle: true },
  { path: 'hardware', name: 'admin-hardware', load: () => import('@/pages/admin/HardwareHubAdmin.vue'), navigation: { section: '设备与分区', label: '硬件清单', order: 6 }, prefetchOnIdle: true },
  { path: 'zones-config', name: 'admin-zones-config', load: () => import('@/pages/admin/ZonesConfigAdmin.vue'), navigation: { section: '设备与分区', label: '分区配置', order: 7 }, prefetchOnIdle: true },
  { path: 'light-zones', name: 'admin-light-zones', load: () => import('@/pages/admin/LightZonesAdmin.vue'), menuParent: 'admin-zones-config' },
  { path: 'power-circuits', name: 'admin-power-circuits', load: () => import('@/pages/admin/PowerCircuitsAdmin.vue'), menuParent: 'admin-zones-config' },
  { path: 'audio-config', name: 'admin-audio-config', load: () => import('@/pages/admin/AudioConfigAdmin.vue'), menuParent: 'admin-zones-config' },
  { path: 'app-release', name: 'admin-app-release', load: () => import('@/pages/admin/AppReleaseAdmin.vue'), menuParent: 'admin-settings' },
  { path: 'drivers', name: 'admin-drivers', load: () => import('@/pages/admin/DriversAdmin.vue'), menuParent: 'admin-hardware' },
  { path: 'brands', name: 'admin-brands', load: () => import('@/pages/admin/BrandsAdmin.vue'), menuParent: 'admin-hardware' },
  { path: 'system-branding', name: 'admin-system-branding', load: () => import('@/pages/admin/SystemBrandingAdmin.vue'), menuParent: 'admin-settings' },
  { path: 'audit', name: 'admin-audit', load: () => import('@/pages/admin/AuditAdmin.vue'), menuParent: 'admin-logs' },
  { path: 'users', name: 'admin-users', load: () => import('@/pages/admin/UsersAdmin.vue'), navigation: { section: '系统管理', label: '用户管理', order: 12 } },
  { path: 'settings', name: 'admin-settings', load: () => import('@/pages/admin/SettingsHubAdmin.vue'), navigation: { section: '系统管理', label: '系统设置', order: 13 }, prefetchOnIdle: true },
  { path: 'park-ops-metrics', name: 'admin-park-ops-metrics', load: () => import('@/pages/admin/ParkOpsMetricsAdmin.vue'), navigation: { section: '系统管理', label: '运营数据', order: 11 } },
] as const satisfies readonly AdminRouteDefinition[];

export interface AdminNavigationGroup {
  section: AdminSection;
  items: Array<{ name: string; label: string }>;
}

export const adminNavigationGroups: readonly AdminNavigationGroup[] = (() => {
  const groups: AdminNavigationGroup[] = [];
  const entries: readonly AdminRouteDefinition[] = adminRouteManifest;
  for (const route of entries.filter((r) => r.navigation).sort((a, b) => a.navigation!.order - b.navigation!.order)) {
    const navigation = route.navigation!;
    let group = groups.find((g) => g.section === navigation.section);
    if (!group) {
      group = { section: navigation.section, items: [] };
      groups.push(group);
    }
    group.items.push({ name: route.name, label: navigation.label });
  }
  return groups;
})();

export function createAdminChildRoutes(): RouteRecordRaw[] {
  const entries: readonly AdminRouteDefinition[] = adminRouteManifest;
  return [
    { path: '', redirect: { name: 'admin-monitor' }, meta: { adminRequired: true } },
    ...entries.map((route) => ({
      path: route.path,
      name: route.name,
      component: route.load,
      ...(route.props ? { props: true } : {}),
      // The existing admin-auth guard is authoritative; do not wait on UI role refresh.
      meta: { adminRequired: true },
    })),
  ];
}

const adminRouteByName = new Map<string, AdminRouteDefinition>(adminRouteManifest.map((route) => [route.name, route]));

export function adminMenuName(name: string): string {
  return adminRouteByName.get(name)?.menuParent ?? name;
}

export function prefetchAdminRoutes(): void {
  for (const route of adminRouteManifest) {
    if ('prefetchOnIdle' in route && route.prefetchOnIdle) {
      // Prefetch is optional; failed chunks remain eligible for normal navigation/recovery.
      void route.load().catch(() => {});
    }
  }
}
