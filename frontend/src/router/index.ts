import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { trackRouteChange } from '@/services/rum.service';
import { useAdminAuthStore } from '@/stores/admin-auth';
import { useClientAuthStore } from '@/stores/client-auth';
import { usePermissionStore } from '@/stores/permission';
import { api } from '@/services/http';
import { isStalePwaAssetError, recoverFromStalePwa } from '@/services/pwa-recovery';
import {
  mainRouteManifest,
  canAccessMainRouteByPerms,
  mainNavigationItemsForRoleByPerms,
} from './main-route-manifest';
import { adminRouteManifest } from './admin-route-manifest';
import { defaultAdminRouteByPerms, type AdminModule } from './admin-rbac';

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
    children: [
      {
        path: '',
        redirect: () => {
          const p = usePermissionStore();
          return { name: defaultAdminRouteByPerms(p.role, p.permissions) };
        },
      },
      ...adminRouteManifest.map((route) => ({
        path: route.path,
        name: route.name,
        component: route.load,
        props: 'props' in route ? route.props : undefined,
        // self 路由（如修改密码）无 module，仅要求后台登录、不做模块权限校验。
        meta: { adminRequired: true, adminModule: 'module' in route ? route.module : undefined },
      })),
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

// Admin auth guard: 进任何 meta.adminRequired 的路由前确保已登录, 并按模块分域拦截。
router.beforeEach(async (to) => {
  if (to.meta?.adminRequired) {
    const authStore = useAdminAuthStore();
    const ok = await authStore.ensureChecked();
    if (!ok) {
      return { name: 'admin-login', query: { redirect: to.fullPath } };
    }
    // 后台导航需要准确角色；role 默认是 'viewer'，用 loaded 判断是否已拉取。
    const permission = usePermissionStore();
    if (!permission.loaded) await permission.refresh();
    const module = to.meta?.adminModule as AdminModule | undefined;
    if (module && !permission.canAccessModule(module)) {
      const landing = defaultAdminRouteByPerms(permission.role, permission.permissions);
      // 连默认落地页都无权访问（角色未就绪或非后台角色），回后台登录页，
      // 避免反复重定向到同一个无权路由形成无限循环。
      if (landing === to.name) {
        return { name: 'admin-login', query: { redirect: to.fullPath } };
      }
      return { name: landing };
    }
  }
  if (!to.meta?.clientPublic && to.name !== 'player' && !to.meta?.adminRequired) {
    // 前台 PWA 页面角色 gate（2026-10-16 最小权限）：导航/深链/直接 URL 统一拦截。
    const permission = usePermissionStore();
    const targetName = typeof to.name === 'string' ? to.name : '';
    const landingFor = (): string | undefined =>
      mainNavigationItemsForRoleByPerms(permission.role, permission.permissions)[0]?.name;
    // 纯后台角色（hardware/config：前台无任何可见页）登录或访问任何前台页时，
    // 直达后台默认落地页（自动开关），不落到前台 status 也不弹回登录页（2026-10-17 第四轮）。
    const backendOnlyRedirect = (): string | undefined => (
      permission.isBackend &&
      mainNavigationItemsForRoleByPerms(permission.role, permission.permissions).length === 0
        ? defaultAdminRouteByPerms(permission.role, permission.permissions)
        : undefined
    );
    if (permission.loaded) {
      const backendLanding = backendOnlyRedirect();
      if (backendLanding) return { name: backendLanding };
      // 角色已就绪（SPA 内导航 / 刷新后）：同步拦截越权路由，落到该角色第一个前台页。
      if (targetName && !canAccessMainRouteByPerms(targetName, permission.role, permission.permissions)) {
        const landing = landingFor();
        if (!landing) return { name: 'client-login', query: { redirect: to.fullPath } };
        if (landing !== targetName) return { name: landing };
      }
    } else {
      // 冷启动 / 直接深链：角色尚未拉取，不能 await 阻塞页面挂载（iOS 后台恢复时网络
      // 延迟会让主壳存在而 router-view 空白）。fire-and-forget 拉角色，到位后再静默校正。
      // 注意：必须用本次导航目标 to.name 判定，不能读 currentRoute.name —— 冷启动时目标
      // 页是懒加载 chunk，/me 可能在 chunk 下载完、当前路由提交前就 resolve，那时
      // currentRoute.name 仍为空（实测根因）。首帧期间页面内只读 gate（viewer 默认最严）兜底。
      void usePermissionStore().refresh().then(() => {
        const backendLanding = backendOnlyRedirect();
        if (backendLanding) {
          void router.replace({ name: backendLanding });
          return;
        }
        if (targetName && !canAccessMainRouteByPerms(targetName, permission.role, permission.permissions)) {
          const landing = landingFor();
          if (!landing) {
            void router.replace({ name: 'client-login', query: { redirect: to.fullPath } });
          } else if (landing !== targetName) {
            void router.replace({ name: landing });
          }
        }
      }).catch(() => { /* 网络异常不擦除会话，页面内只读 gate 兜底。 */ });
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
