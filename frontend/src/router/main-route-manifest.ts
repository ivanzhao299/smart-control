import type { Component } from 'vue';

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
    path: '', name: 'dashboard', load: () => import('@/pages/DashboardPage.vue'),
    navigation: { label: '首页', section: 'main' },
  },
  {
    path: 'lighting', name: 'lighting', load: () => import('@/pages/LightingPage.vue'),
    navigation: { label: '灯光', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/light-zones'],
  },
  // DALI 管理与诊断是灯光页内的深链，不进入全局菜单。
  { path: 'dali-lights', name: 'dali-lights', load: () => import('@/pages/DaliLightsPage.vue') },
  { path: 'dali-diagnose', name: 'dali-diagnose', load: () => import('@/pages/DaliDiagnosePage.vue') },
  {
    path: 'led', name: 'led', load: () => import('@/pages/LedPage.vue'),
    navigation: { label: 'LED 大屏', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/devices?category=led'],
  },
  // 投影仪独立于 LED，避免误操作到另一块显示设备。
  {
    path: 'projector', name: 'projector', load: () => import('@/pages/ProjectorPage.vue'),
    navigation: { label: '投影仪', section: 'main' }, prefetchOnIdle: true,
  },
  {
    path: 'audio', name: 'audio', load: () => import('@/pages/AudioPage.vue'),
    navigation: { label: '音响', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/devices?category=audio-zone'],
  },
  {
    path: 'hvac', name: 'hvac', load: () => import('@/pages/HvacPage.vue'),
    navigation: { label: '空调', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/devices?category=hvac-zone'],
  },
  {
    path: 'power', name: 'power', load: () => import('@/pages/PowerPage.vue'),
    navigation: { label: '电源', section: 'main' }, prefetchOnIdle: true,
    prefetchApis: ['/power-circuits'],
  },
  {
    path: 'media', name: 'media', load: () => import('@/pages/MediaPage.vue'),
    navigation: { label: '媒体', section: 'tools' }, prefetchOnIdle: true,
    prefetchApis: ['/media?pageSize=50'],
  },
  {
    path: 'status', name: 'status', load: () => import('@/pages/StatusPage.vue'),
    navigation: { label: '状态', section: 'tools' }, prefetchOnIdle: true,
    prefetchApis: ['/system/info'],
  },
] as const satisfies readonly MainRouteDefinition[];

export const mainNavigationItems: readonly MainNavigationItem[] = mainRouteManifest.flatMap((route) => (
  'navigation' in route
    ? [{ name: route.name, label: route.navigation.label, section: route.navigation.section }]
    : []
));

export const idleMainRouteNames: readonly string[] = mainRouteManifest
  .filter((route) => 'prefetchOnIdle' in route && route.prefetchOnIdle)
  .map((route) => route.name);

const mainRouteByName = new Map<string, MainRouteDefinition>(
  mainRouteManifest.map((route) => [route.name, route]),
);

export function loadMainRoute(name: string): Promise<{ default: Component }> | undefined {
  return mainRouteByName.get(name)?.load();
}

export function mainRoutePrefetchApis(name: string): readonly string[] {
  return mainRouteByName.get(name)?.prefetchApis ?? [];
}
