import type { Component } from 'vue';
import type { AdminModule } from './admin-rbac';

export type AdminNavigationSection = '日常运行' | '设备与分区' | '日志与诊断' | '系统管理';
export type AdminPageLoader = () => Promise<{ default: Component }>;

export interface AdminNavigationItem {
  name: string;
  label: string;
  section: AdminNavigationSection;
  order: number;
}

interface AdminRouteDefinition {
  path: string;
  name: string;
  load: AdminPageLoader;
  /** 该页归属的后台分域；菜单可见性与路由守卫按角色对此分域判定。 */
  module: AdminModule;
  props?: boolean;
  navigation?: Omit<AdminNavigationItem, 'name'>;
  menuParent?: string;
  prefetchOnIdle?: boolean;
}

const sectionOrder: readonly AdminNavigationSection[] = [
  '日常运行',
  '设备与分区',
  '日志与诊断',
  '系统管理',
];

/**
 * 后台页面的唯一清单。
 *
 * 路由注册、逐路由权限、侧栏分组、深链高亮和空闲预取都从这里生成。新增后台页时
 * 只改这一处，避免出现菜单存在但路由缺失、深链高亮错误或预取清单遗漏。
 *
 * module 决定哪个角色可见：admin 全通；hardware 见设备与分区/日志；config 见日常运行。
 */
export const adminRouteManifest = [
  {
    path: 'monitor', name: 'admin-monitor', load: () => import('@/pages/admin/MonitorAdmin.vue'),
    module: 'monitor', navigation: { label: '运维监控', section: '日常运行', order: 0 }, prefetchOnIdle: true,
  },
  {
    path: 'alerts', name: 'admin-alerts', load: () => import('@/pages/admin/AlertsAdmin.vue'),
    module: 'alerts', navigation: { label: '报警中心', section: '日常运行', order: 1 },
  },
  {
    path: 'devices', name: 'admin-devices', load: () => import('@/pages/admin/DevicesAdmin.vue'),
    module: 'devices', navigation: { label: '设备管理', section: '设备与分区', order: 0 }, prefetchOnIdle: true,
  },
  {
    path: 'scenes', name: 'admin-scenes', load: () => import('@/pages/admin/ScenesAdmin.vue'),
    module: 'scenes', navigation: { label: '场景管理', section: '日常运行', order: 2 }, prefetchOnIdle: true,
  },
  {
    path: 'scenes/:id/actions', name: 'admin-scene-actions', load: () => import('@/pages/admin/SceneActionsAdmin.vue'),
    module: 'scenes', props: true, menuParent: 'admin-scenes',
  },
  {
    path: 'scheduler', name: 'admin-scheduler', load: () => import('@/pages/admin/SchedulerAdmin.vue'),
    module: 'scheduler', navigation: { label: '定时任务', section: '日常运行', order: 3 },
  },
  {
    path: 'energy', name: 'admin-energy', load: () => import('@/pages/admin/EnergyAdmin.vue'),
    module: 'energy', navigation: { label: '能源管理', section: '日常运行', order: 4 }, prefetchOnIdle: true,
  },
  {
    path: 'auto-switch', name: 'admin-auto-switch', load: () => import('@/pages/admin/AutoSwitchAdmin.vue'),
    module: 'energy', navigation: { label: '自动开关', section: '日常运行', order: 5 },
  },
  {
    path: 'scene-executions', name: 'admin-scene-executions', load: () => import('@/pages/admin/SceneExecutionsAdmin.vue'),
    module: 'diagnostics', menuParent: 'admin-logs',
  },
  {
    path: 'test-center', name: 'admin-test-center', load: () => import('@/pages/admin/TestCenterAdmin.vue'),
    module: 'uat', navigation: { label: '测试 / 调试', section: '日志与诊断', order: 1 },
  },
  {
    path: 'debug', name: 'admin-debug', load: () => import('@/pages/admin/TestCenterAdmin.vue'),
    module: 'uat', menuParent: 'admin-test-center',
  },
  {
    path: 'video-binding', name: 'admin-video-binding', load: () => import('@/pages/admin/VideoBindingAdmin.vue'),
    module: 'video', navigation: { label: '视频绑定', section: '设备与分区', order: 3 },
  },
  {
    path: 'lpr', name: 'admin-lpr', load: () => import('@/pages/admin/LprAdmin.vue'),
    module: 'lpr', navigation: { label: '车牌道闸', section: '设备与分区', order: 4 }, prefetchOnIdle: true,
  },
  {
    path: 'uat', name: 'admin-uat', load: () => import('@/pages/admin/UatAdmin.vue'),
    module: 'uat', menuParent: 'admin-test-center',
  },
  {
    path: 'logs', name: 'admin-logs', load: () => import('@/pages/admin/LogsHubAdmin.vue'),
    module: 'diagnostics', navigation: { label: '日志中心', section: '日志与诊断', order: 0 }, prefetchOnIdle: true,
  },
  {
    path: 'hardware', name: 'admin-hardware', load: () => import('@/pages/admin/HardwareHubAdmin.vue'),
    module: 'hardware', navigation: { label: '硬件清单', section: '设备与分区', order: 1 }, prefetchOnIdle: true,
  },
  {
    path: 'zones-config', name: 'admin-zones-config', load: () => import('@/pages/admin/ZonesConfigAdmin.vue'),
    module: 'zones', navigation: { label: '分区配置', section: '设备与分区', order: 2 }, prefetchOnIdle: true,
  },
  {
    path: 'light-zones', name: 'admin-light-zones', load: () => import('@/pages/admin/LightZonesAdmin.vue'),
    module: 'zones', menuParent: 'admin-zones-config',
  },
  {
    path: 'power-circuits', name: 'admin-power-circuits', load: () => import('@/pages/admin/PowerCircuitsAdmin.vue'),
    module: 'zones', menuParent: 'admin-zones-config',
  },
  {
    path: 'audio-config', name: 'admin-audio-config', load: () => import('@/pages/admin/AudioConfigAdmin.vue'),
    module: 'zones', menuParent: 'admin-zones-config',
  },
  {
    path: 'app-release', name: 'admin-app-release', load: () => import('@/pages/admin/AppReleaseAdmin.vue'),
    module: 'system', menuParent: 'admin-settings',
  },
  {
    path: 'testflight', name: 'admin-testflight', load: () => import('@/pages/admin/TestFlightAdmin.vue'),
    module: 'system', navigation: { label: 'iOS 测试', section: '系统管理', order: 2 },
  },
  {
    path: 'drivers', name: 'admin-drivers', load: () => import('@/pages/admin/DriversAdmin.vue'),
    module: 'hardware', menuParent: 'admin-hardware',
  },
  {
    path: 'brands', name: 'admin-brands', load: () => import('@/pages/admin/BrandsAdmin.vue'),
    module: 'hardware', menuParent: 'admin-hardware',
  },
  {
    path: 'system-branding', name: 'admin-system-branding', load: () => import('@/pages/admin/SystemBrandingAdmin.vue'),
    module: 'branding', menuParent: 'admin-settings',
  },
  {
    path: 'audit', name: 'admin-audit', load: () => import('@/pages/admin/AuditAdmin.vue'),
    module: 'system', menuParent: 'admin-logs',
  },
  {
    path: 'users', name: 'admin-users', load: () => import('@/pages/admin/UsersAdmin.vue'),
    module: 'system', navigation: { label: '用户管理', section: '系统管理', order: 1 },
  },
  {
    path: 'settings', name: 'admin-settings', load: () => import('@/pages/admin/SettingsHubAdmin.vue'),
    module: 'system', navigation: { label: '系统设置', section: '系统管理', order: 3 }, prefetchOnIdle: true,
  },
  {
    path: 'park-ops-metrics', name: 'admin-park-ops-metrics', load: () => import('@/pages/admin/ParkOpsMetricsAdmin.vue'),
    module: 'metrics', navigation: { label: '运营数据', section: '日常运行', order: 6 },
  },
] as const satisfies readonly AdminRouteDefinition[];

export const adminNavigationItems: readonly AdminNavigationItem[] = adminRouteManifest.flatMap((route) => (
  'navigation' in route
    ? [{
      name: route.name,
      label: route.navigation.label,
      section: route.navigation.section,
      order: route.navigation.order,
    }]
    : []
));

export const adminNavigationGroups: ReadonlyArray<{
  section: AdminNavigationSection;
  items: readonly AdminNavigationItem[];
}> = sectionOrder.map((section) => ({
  section,
  items: adminNavigationItems
    .filter((item) => item.section === section)
    .sort((left, right) => left.order - right.order),
}));

export const idleAdminRouteNames: readonly string[] = adminRouteManifest
  .filter((route) => 'prefetchOnIdle' in route && route.prefetchOnIdle)
  .map((route) => route.name);

const adminRouteByName = new Map<string, AdminRouteDefinition>(
  adminRouteManifest.map((route) => [route.name, route]),
);

export function loadAdminRoute(name: string): Promise<{ default: Component }> | undefined {
  return adminRouteByName.get(name)?.load();
}

export function adminMenuTargetName(name: string): string {
  return adminRouteByName.get(name)?.menuParent ?? name;
}

export function adminModuleOfRoute(name: string): AdminModule | undefined {
  return adminRouteByName.get(name)?.module;
}
