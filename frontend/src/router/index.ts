import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { trackRouteChange } from '@/services/rum.service';
import { useAdminAuthStore } from '@/stores/admin-auth';
import { useClientAuthStore } from '@/stores/client-auth';
import { usePermissionStore } from '@/stores/permission';
import { api } from '@/services/http';
import { isStalePwaAssetError, recoverFromStalePwa } from '@/services/pwa-recovery';
import { mainRouteManifest } from './main-route-manifest';
import { createAdminChildRoutes } from './admin-route-manifest';

const routes: RouteRecordRaw[] = [
  // 平板布局 (Sprint-05)
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: mainRouteManifest.map((route) => ({
      path: route.path,
      name: route.name,
      component: route.load,
    })),
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
    children: createAdminChildRoutes(),
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

// Client auth guard: 业主级别. 除特殊页外, 其他业主侧路由都要 client token.
// PWA / APP 启动后第一件事走这里 → 没 token 跳 /client-login.
//
// 注意: /admin/* 后台路径**不走**这个 guard — admin 有自己独立的 admin-auth.
// 业主 / 管理员两套鉴权是平行的, 不应该叠加. 老业主装着 PWA 但没 client token,
// 仍能去后台修复问题; client-auth 错配/服务器换地址不影响 admin 进入.
router.beforeEach(async (to) => {
  // 显式公开页: client-login (输密码 + 配地址), player (kiosk 全屏播放, 无 UI)
  if (to.meta?.clientPublic || to.name === 'player') return true;
  const client = useClientAuthStore();
  // Hydrate the saved administrator session on control pages too. Otherwise a
  // reload silently sends only the old read-only client token to device APIs.
  const admin = useAdminAuthStore();
  const adminAuthenticated = await admin.ensureChecked();
  if (typeof to.path === 'string' && to.path.startsWith('/admin')) return true;
  if (client.isAuthed && !adminAuthenticated) {
    // Old password-only sessions are valid but cannot identify a user. Migrate
    // them explicitly instead of silently restoring a read-only device session.
    try {
      const actor = await api.get<{ kind: string }>('/client-auth/me');
      if (actor.kind === 'legacy') {
        client.logout();
        return { name: 'client-login', query: { redirect: to.fullPath, reason: 'account-required' } };
      }
    } catch { /* Network errors must not erase a saved account. */ }
  }
  if (!client.isAuthed && !adminAuthenticated) {
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
  if (!to.meta?.clientPublic && to.name !== 'player') {
    // 权限默认是 viewer，服务端仍是最终授权边界。角色刷新不能阻塞页面挂载：
    // iOS 从后台恢复时网络请求可能延迟，等待它会让主壳存在而 router-view 为空。
    void usePermissionStore().refresh();
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

/**
 * 懒加载 chunk 拉取失败自愈 (2026-07-27)。
 *
 * 业主: "后台场景编辑里点「动作」没有反应"。点击本身没问题 (本地实测跳转正常),
 * 生产上的"没反应"是这条链: 平板上 Service Worker/浏览器缓存着**旧版** index.html
 * 或旧 precache → 新部署后带哈希的懒加载 chunk 文件名变了 → 点击触发的
 * dynamic import 404/失败 → vue-router 把整次导航静默 abort —— 界面上就是
 * "点了没反应", 控制台才有 Failed to fetch dynamically imported module。
 *
 * 自愈: 捕获 chunk 加载类错误, 整页跳到目标地址 (强制重新拉 index.html, SW 顺带
 * 检查更新), 30s 冷却防刷新循环。除此之外的路由错误照旧抛出, 不吞。
 */
router.onError((err, to) => {
  if (!isStalePwaAssetError(err)) return;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  void recoverFromStalePwa(base + (to?.fullPath ?? '/'));
});
