import type { Component } from 'vue';
import type { UserRole } from '@/types/api';

export type MainNavigationSection = 'main' | 'tools';
export type MainPageLoader = () => Promise<{ default: Component }>;

export interface MainNavigationItem {
  name: string;
  label: string;
  section: MainNavigationSection;
}

/** 内置角色（动态 RBAC 前的 5 个写死角色）。 */
const BUILTIN_MAIN_ROLES: readonly string[] = [
  'admin',
  'hardware',
  'config',
  'operator',
  'viewer',
];

interface MainRouteDefinition {
  path: string;
  name: string;
  load: MainPageLoader;
  /**
   * 允许进入该前台页面的角色白名单（admin 始终全通，无需列出）。
   * 2026-10-16 第二轮最小权限：operator 只保留大屏/投影仪播控、素材、首页场景、状态只读；
   * 设备实体控制页（灯光/音响/空调/道闸/DALI 调试）仅 admin；
   * hardware/config 为后台角色，前台仅给电源页（落地页，配自动开关 + 按域手动），其余前台页不可见；
   * viewer 只读账户可浏览只读页（写操作后端 403 + 按钮置灰）。
   */
  roles?: UserRole[];
  /**
   * 动态自定义角色进入该前台页所需的原子权限点（拥有即可见）。
   * 内置 5 角色仍走 roles 白名单；管理员新建角色（如物业）按此权限点放行。
   */
  permission?: string;
  navigation?: Omit<MainNavigationItem, 'name'>;
  prefetchOnIdle?: boolean;
  prefetchApis?: readonly string[];
}

/**
 * 业主侧 PWA 页面唯一清单。
 *
 * 路由注册、菜单、空闲预取和指针预取都从这里生成。新增页面时只改这一处，避免
 * 页面已经有菜单却没有路由，或路由 chunk 在部署后没有被预取而出现黑屏。
 */
export const mainRouteManifest = [
  {
    // 首页场景磁贴：operator 保留的播控入口（场景执行后端 admin/operator）。
    path: '', name: 'dashboard', load: () => import('@/pages/DashboardPage.vue'),
    permission: 'dashboard:view',
    roles: ['admin', 'operator', 'viewer'],
    navigation: { label: '首页', section: 'main' },
  },
  {
    // 灯光设备控制：仅 admin（operator 不再开放，后端 lighting 写仅 admin）。
    path: 'lighting', name: 'lighting', load: () => import('@/pages/LightingPage.vue'),
    permission: 'lighting:view',
    roles: ['admin', 'viewer'],
    navigation: { label: '灯光', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/light-zones'],
  },
  // DALI 管理与诊断是灯光页内的深链，不进入全局菜单；DALI 调试/控制仅 admin。
  { path: 'dali-lights', name: 'dali-lights', load: () => import('@/pages/DaliLightsPage.vue'), permission: 'dali:control', roles: ['admin'] },
  { path: 'dali-diagnose', name: 'dali-diagnose', load: () => import('@/pages/DaliDiagnosePage.vue'), permission: 'dali:diagnose', roles: ['admin'] },
  {
    // LED 大屏播控：operator 保留。
    path: 'led', name: 'led', load: () => import('@/pages/LedPage.vue'),
    permission: 'led:view',
    roles: ['admin', 'operator', 'viewer'],
    navigation: { label: 'LED 大屏', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/devices?category=led'],
  },
  // 投影仪独立于 LED，避免误操作到另一块显示设备；播控开放给 operator。
  {
    path: 'projector', name: 'projector', load: () => import('@/pages/ProjectorPage.vue'),
    permission: 'projector:view',
    roles: ['admin', 'operator', 'viewer'],
    navigation: { label: '投影仪', section: 'main' }, prefetchOnIdle: true,
  },
  {
    // 音响设备控制：仅 admin（全场静音事故源头，operator 不再开放）。
    path: 'audio', name: 'audio', load: () => import('@/pages/AudioPage.vue'),
    permission: 'audio:view',
    roles: ['admin', 'viewer'],
    navigation: { label: '音响', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/devices?category=audio-zone'],
  },
  {
    // 空调设备控制：仅 admin。
    path: 'hvac', name: 'hvac', load: () => import('@/pages/HvacPage.vue'),
    permission: 'hvac:view',
    roles: ['admin', 'viewer'],
    navigation: { label: '空调', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/devices?category=hvac-zone'],
  },
  {
    // 电源回路手动控制：operator 开放单路通断（播放页 4 路物理开关 + 其他单路电源操作需求，
    // 2026-10-17 第四轮）；时序器批量/楼层/整馆通断与回路改名仍仅 admin（页面内单独 gate）。
    // hardware/config 第六轮起落地前台电源页：前台时钟入口可配自动开关，单路手动按域由后端
    // 强制（hardware 全域、config 仅园区），他们不再被守卫强制跳后台；前台仅见电源这一页。
    path: 'power', name: 'power', load: () => import('@/pages/PowerPage.vue'),
    permission: 'power:view',
    roles: ['admin', 'operator', 'hardware', 'config', 'viewer'],
    navigation: { label: '电源', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/power-circuits'],
  },
  {
    // 水电管理平台（前台 PWA，P4 从后台搬来）：admin 全通；物业（自定义角色）按
    // energy:view 权限点放行，可见总览/逐表明细/缴费/欠费/控制记录、可导出 Excel。
    // 不写 roles 白名单 -> 内置非 admin 角色（operator/viewer/hardware/config）不可见；
    // 召测 energy:readout 物业无（页面内按钮自动隐藏）。园区台账（变压器/楼栋配置）
    // 保留在后台 /admin/energy，由 energy:ledger 控制。
    path: 'energy', name: 'energy', load: () => import('@/pages/EnergyPage.vue'),
    permission: 'energy:view',
    // 2026-10-19 第二十四轮：水电从主底栏收进「更多」(section tools)。admin 手机底栏原 main 8 项
    // 塞满（每个 <44pt 触摸下限），水电移入更多抽屉；桌面侧栏随之列于分隔线之后。
    navigation: { label: '水电', section: 'tools' }, prefetchOnIdle: true,
    prefetchApis: ['/em123/overview', '/em123/tree?type=E'],
  },
  {
    // 媒体库：operator 保留上传素材 + 改文件名。
    path: 'media', name: 'media', load: () => import('@/pages/MediaPage.vue'),
    permission: 'media:view',
    roles: ['admin', 'operator', 'viewer'],
    navigation: { label: '媒体', section: 'tools' }, prefetchOnIdle: true,
    prefetchApis: ['/media?pageSize=50'],
  },
  {
    // 状态只读：仅 admin（2026-10-17 第四轮收紧；hardware/config 登录直达后台，operator 更多抽屉不再列状态）。
    path: 'status', name: 'status', load: () => import('@/pages/StatusPage.vue'),
    permission: 'status:view',
    roles: ['admin'],
    navigation: { label: '状态', section: 'tools' }, prefetchOnIdle: true,
    prefetchApis: ['/system/info'],
  },
  {
    // 道闸开关：仅 admin（后端 lpr gate 仅 admin）。
    path: 'barrier', name: 'barrier', load: () => import('@/pages/BarrierPage.vue'),
    permission: 'barrier:view',
    roles: ['admin', 'viewer'],
    navigation: { label: '道闸', section: 'tools' }, prefetchOnIdle: true,
    prefetchApis: ['/lpr/recent', '/lpr/devices'],
  },
] as const satisfies readonly MainRouteDefinition[];

export const mainNavigationItems: readonly MainNavigationItem[] = mainRouteManifest.flatMap((route) => (
  'navigation' in route
    ? [{ name: route.name, label: route.navigation.label, section: route.navigation.section }]
    : []
));

const mainRouteByName = new Map<string, MainRouteDefinition>(
  mainRouteManifest.map((route) => [route.name, route]),
);

// 操作员主导航固定为日常播控入口。即使动态权限误授了其他 view 权限，
// 也不能把灯光/音响/空调等管理页重新塞回操作员底栏；媒体仍保留在「更多」中。
const OPERATOR_MAIN_NAV = new Set(['dashboard', 'led', 'projector', 'power']);

/**
 * 某前台角色能否进入该前台路由（admin 全通；未声明 roles 的路由默认仅 admin，白名单制）。
 * 用于导航过滤与前台路由守卫（深链/直接 URL 同样拦截）。
 */
export function canAccessMainRoute(name: string, role: UserRole | undefined): boolean {
  if (role === 'admin') return true;
  const route = mainRouteByName.get(name);
  if (!route) return false;
  if (!route.roles || route.roles.length === 0) return false;
  return !!role && route.roles.includes(role);
}

/**
 * 动态 RBAC 版前台路由可见性：
 * - admin 全通；
 * - 其余角色（内置/自定义）统一按路由声明的 permission 权限点判定，
 *   与后端 /me 下发的 permissions 一致：管理员增/减权限点即时生效。
 */
export function canAccessMainRouteByPerms(
  name: string,
  role: string | undefined,
  perms: ReadonlySet<string>,
): boolean {
  if (role === 'admin') return true;
  const route = mainRouteByName.get(name);
  if (!route) return false;
  if (
    role === 'operator' &&
    route.navigation?.section === 'main' &&
    !OPERATOR_MAIN_NAV.has(name)
  ) {
    return false;
  }
  if (route.permission) return perms.has(route.permission);
  // 未声明权限点的路由：回退 roles 白名单（理论上无，仅兜底）。
  if (role && BUILTIN_MAIN_ROLES.includes(role)) {
    return !!route.roles && route.roles.includes(role as UserRole);
  }
  return false;
}

/** 按角色过滤后的前台导航项（MainLayout 底栏/侧栏用）。 */
export function mainNavigationItemsForRole(role: UserRole | undefined): readonly MainNavigationItem[] {
  return mainNavigationItems.filter((item) => canAccessMainRoute(item.name, role));
}

/** 动态 RBAC 版前台导航项（内置角色走白名单，自定义角色走权限点）。 */
export function mainNavigationItemsForRoleByPerms(
  role: string | undefined,
  perms: ReadonlySet<string>,
): readonly MainNavigationItem[] {
  return mainNavigationItems.filter((item) => canAccessMainRouteByPerms(item.name, role, perms));
}

export const idleMainRouteNames: readonly string[] = mainRouteManifest
  .filter((route) => 'prefetchOnIdle' in route && route.prefetchOnIdle)
  .map((route) => route.name);

export function loadMainRoute(name: string): Promise<{ default: Component }> | undefined {
  return mainRouteByName.get(name)?.load();
}

export function mainRoutePrefetchApis(name: string): readonly string[] {
  return mainRouteByName.get(name)?.prefetchApis ?? [];
}
