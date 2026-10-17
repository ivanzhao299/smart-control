import type { Component } from 'vue';
import type { UserRole } from '@/types/api';

export type MainNavigationSection = 'main' | 'tools';
export type MainPageLoader = () => Promise<{ default: Component }>;

export interface MainNavigationItem {
  name: string;
  label: string;
  section: MainNavigationSection;
}

interface MainRouteDefinition {
  path: string;
  name: string;
  load: MainPageLoader;
  /**
   * 允许进入该前台页面的角色白名单（admin 始终全通，无需列出）。
   * 2026-10-16 第二轮最小权限：operator 只保留大屏/投影仪播控、素材、首页场景、状态只读；
   * 设备实体控制页（灯光/音响/空调/电源/道闸/DALI 调试）仅 admin；
   * hardware/config 为后台角色，前台只给状态只读页。
   * viewer 只读账户可浏览只读页（写操作后端 403 + 按钮置灰）。
   */
  roles?: UserRole[];
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
    roles: ['admin', 'operator', 'viewer'],
    navigation: { label: '首页', section: 'main' },
  },
  {
    // 灯光设备控制：仅 admin（operator 不再开放，后端 lighting 写仅 admin）。
    path: 'lighting', name: 'lighting', load: () => import('@/pages/LightingPage.vue'),
    roles: ['admin', 'viewer'],
    navigation: { label: '灯光', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/light-zones'],
  },
  // DALI 管理与诊断是灯光页内的深链，不进入全局菜单；DALI 调试/控制仅 admin。
  { path: 'dali-lights', name: 'dali-lights', load: () => import('@/pages/DaliLightsPage.vue'), roles: ['admin'] },
  { path: 'dali-diagnose', name: 'dali-diagnose', load: () => import('@/pages/DaliDiagnosePage.vue'), roles: ['admin'] },
  {
    // LED 大屏播控：operator 保留。
    path: 'led', name: 'led', load: () => import('@/pages/LedPage.vue'),
    roles: ['admin', 'operator', 'viewer'],
    navigation: { label: 'LED 大屏', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/devices?category=led'],
  },
  // 投影仪独立于 LED，避免误操作到另一块显示设备；播控开放给 operator。
  {
    path: 'projector', name: 'projector', load: () => import('@/pages/ProjectorPage.vue'),
    roles: ['admin', 'operator', 'viewer'],
    navigation: { label: '投影仪', section: 'main' }, prefetchOnIdle: true,
  },
  {
    // 音响设备控制：仅 admin（全场静音事故源头，operator 不再开放）。
    path: 'audio', name: 'audio', load: () => import('@/pages/AudioPage.vue'),
    roles: ['admin', 'viewer'],
    navigation: { label: '音响', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/devices?category=audio-zone'],
  },
  {
    // 空调设备控制：仅 admin。
    path: 'hvac', name: 'hvac', load: () => import('@/pages/HvacPage.vue'),
    roles: ['admin', 'viewer'],
    navigation: { label: '空调', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/devices?category=hvac-zone'],
  },
  {
    // 电源回路手动控制：operator 开放单路通断（播放页 4 路物理开关 + 其他单路电源操作需求，
    // 2026-10-17 第四轮）；时序器批量/楼层/整馆通断与回路改名仍仅 admin（页面内单独 gate）。
    path: 'power', name: 'power', load: () => import('@/pages/PowerPage.vue'),
    roles: ['admin', 'operator', 'viewer'],
    navigation: { label: '电源', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/power-circuits'],
  },
  {
    // 媒体库：operator 保留上传素材 + 改文件名。
    path: 'media', name: 'media', load: () => import('@/pages/MediaPage.vue'),
    roles: ['admin', 'operator', 'viewer'],
    navigation: { label: '媒体', section: 'tools' }, prefetchOnIdle: true,
    prefetchApis: ['/media?pageSize=50'],
  },
  {
    // 状态只读：仅 admin（2026-10-17 第四轮收紧；hardware/config 登录直达后台，operator 更多抽屉不再列状态）。
    path: 'status', name: 'status', load: () => import('@/pages/StatusPage.vue'),
    roles: ['admin'],
    navigation: { label: '状态', section: 'tools' }, prefetchOnIdle: true,
    prefetchApis: ['/system/info'],
  },
  {
    // 道闸开关：仅 admin（后端 lpr gate 仅 admin）。
    path: 'barrier', name: 'barrier', load: () => import('@/pages/BarrierPage.vue'),
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

/** 按角色过滤后的前台导航项（MainLayout 底栏/侧栏用）。 */
export function mainNavigationItemsForRole(role: UserRole | undefined): readonly MainNavigationItem[] {
  return mainNavigationItems.filter((item) => canAccessMainRoute(item.name, role));
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
