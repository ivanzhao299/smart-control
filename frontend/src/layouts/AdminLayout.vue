<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Menu, X, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, ChevronDown, KeyRound } from 'lucide-vue-next';
import BrandLogo from '@/components/BrandLogo.vue';
import { useFullscreen } from '@/composables/useFullscreen';
import { useSystemStore } from '@/stores/system';
import { usePermissionStore } from '@/stores/permission';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { useAdminAuthStore } from '@/stores/admin-auth';
import { useClientAuthStore } from '@/stores/client-auth';
import { LogOut } from 'lucide-vue-next';
import { ElMessageBox } from 'element-plus';
import { adminNavIconFor } from '@/composables/useIcons';
import {
  adminMenuTargetName,
  adminNavigationGroups,
  canAccessAdminRouteByPerms,
  idleAdminRouteNames,
  loadAdminRoute,
  type AdminNavigationSection,
} from '@/router/admin-route-manifest';
import { ROLE_LABELS } from '@/router/admin-rbac';
import { mainNavigationItemsForRoleByPerms } from '@/router/main-route-manifest';

const route = useRoute();
const router = useRouter();
const sys = useSystemStore();
const perm = usePermissionStore();

/**
 * 是否有可返回的前台页。纯后台角色（config/hardware）前台无任何可见页面，
 * 点「返回设备控制」会被路由守卫立刻弹回后台，属无效按钮，直接隐藏（与
 * router/index.ts 的 backendOnlyRedirect 判定保持一致：前台导航项数为 0）。
 */
const canReturnToFront = computed(
  () => mainNavigationItemsForRoleByPerms(perm.role, perm.permissions).length > 0,
);
/** 角色显示名：以后端 /me 返回的中文名为准，回退内置标签，再回退 code。 */
const roleLabel = computed(
  () => perm.roleName
    || (ROLE_LABELS as Record<string, string>)[perm.role]
    || perm.role,
);
const brandingStore = useSystemBrandingStore();
const branding = computed(() => brandingStore.branding);
const authStore = useAdminAuthStore();

// 全屏切换 (后台不强制 autoEnter, 业主想全屏时手动点)
const fs = useFullscreen({ autoEnter: false });
const fsActive = fs.isActive;
const fsSupported = fs.isSupported;
function toggleFullscreen(): void { void fs.toggle(); }

// 按角色分域过滤侧栏菜单: 只保留当前角色可见的页面。
// self 自助页(修改密码)对所有后台角色可见; 其余按 module 分域; 整组为空时不渲染。
const groups = computed(() =>
  adminNavigationGroups
    .map((g) => ({
      section: g.section,
      items: g.items.filter((it) => canAccessAdminRouteByPerms(it.name, perm.role, perm.permissions)),
    }))
    .filter((g) => g.items.length > 0),
);
/** 扁平列表 — crumb / 查找用 */
const flatItems = computed(() => groups.value.flatMap((g) => g.items));

const timeLabel = computed(() => {
  const d = new Date(sys.now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

const currentName = computed(() => {
  const cur = route.name?.toString() ?? '';
  return adminMenuTargetName(cur);
});

/** 手机抽屉开关状态 (≤600px 才生效) */
const sidebarOpen = ref(false);
function toggleSidebar(): void { sidebarOpen.value = !sidebarOpen.value; }
function closeSidebar(): void { sidebarOpen.value = false; }
// 切换路由后自动收起抽屉 (业主在手机上点菜单 → 跳页面 → 抽屉关掉)
watch(() => route.name, () => { sidebarOpen.value = false; });

/** 桌面/平板: 左栏折叠成图标栏 (>600px 生效, 持久化到 localStorage) */
const COLLAPSE_KEY = 'sc.admin.sidebarCollapsed';
const collapsed = ref<boolean>(false);
try { collapsed.value = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { /* localStorage 不可用就默认展开 */ }
function toggleCollapse(): void {
  collapsed.value = !collapsed.value;
  try { localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0'); } catch { /* ignore */ }
}

// ============ 菜单分组展开 / 折叠（状态持久化，诊断/系统默认收起） ============
const SECTION_COLLAPSE_KEY = 'sc.admin.menuCollapsed';
/** 默认收起的分组（低频使用，减少常用视觉负担） */
const DEFAULT_COLLAPSED_SECTIONS: AdminNavigationSection[] = ['诊断', '系统'];
const collapsedSections = ref<Record<string, boolean>>({});

function persistSections(): void {
  const list = Object.entries(collapsedSections.value)
    .filter(([, v]) => v)
    .map(([k]) => k);
  try { localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function isSectionCollapsed(section: AdminNavigationSection): boolean {
  return !!collapsedSections.value[section];
}

function toggleSection(section: AdminNavigationSection): void {
  // 整体折叠成图标栏时，分组标题只作分隔线，不触发分组折叠
  if (collapsed.value) return;
  collapsedSections.value[section] = !collapsedSections.value[section];
  persistSections();
}

function initSections(): void {
  try {
    const saved = localStorage.getItem(SECTION_COLLAPSE_KEY);
    if (saved !== null) {
      const arr = JSON.parse(saved) as string[];
      for (const s of arr) collapsedSections.value[s] = true;
    } else {
      for (const s of DEFAULT_COLLAPSED_SECTIONS) collapsedSections.value[s] = true;
    }
  } catch {
    for (const s of DEFAULT_COLLAPSED_SECTIONS) collapsedSections.value[s] = true;
  }
}
initSections();

// 进了后台后, idle 时分批预取"当前角色可访问"的菜单页 chunk, 切页不等下载。
// 按角色过滤: 非 admin 不下载 users/roles 等进不去的 chunk; 分批(每批3)让出主线程,
// 避免一次性并发预取在弱网下抢占带宽。只在后台触发, 不拖累客户端平板。
onMounted(() => {
  const ric =
    (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ??
    ((cb: () => void) => window.setTimeout(cb, 1200));
  const names = idleAdminRouteNames.filter(
    (name) => canAccessAdminRouteByPerms(name, perm.role, perm.permissions),
  );
  const BATCH = 3;
  let cursor = 0;
  const step = (): void => {
    const batch = names.slice(cursor, cursor + BATCH);
    cursor += BATCH;
    for (const name of batch) {
      void loadAdminRoute(name)?.catch(() => undefined);
    }
    if (cursor < names.length) ric(step);
  };
  ric(step);
});

function go(name: string): void {
  router.push({ name });
  sidebarOpen.value = false;
}

function returnToControl(): void {
  void router.push({ name: 'dashboard' });
}

/** Only an explicit logout clears identity; returning to controls preserves it. */
async function exitToFront(): Promise<void> {
  try {
    await ElMessageBox.confirm('退出当前登录？再次操作需要重新登录。', '退出登录', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
    });
    // 关键顺序：先离开受保护页、等其卸载，再清 token。
    // 清 token 会经 invalidateIdentity() 改变 App.vue 的路由视图 key，
    // 强制重建当前路由视图。若先清 token 再跳转，受保护页会在"无 token、还没跳走"
    // 的窗口被重新挂载，以无登录态重发请求 → 401 → 弹"加载失败/登录已过期"。
    // client-login 是公开页（已登录也放行），先导航过去后再清 token，重建只落在
    // 不发受保护请求的登录页上，退出不再报错。带 logout=1：登录页此刻还能读到登录态，
    // 但不得把用户重定向回受控页（见 ClientLogin.onMounted）。
    await router.replace({ name: 'client-login', query: { logout: '1' } });
    await authStore.logout();
    useClientAuthStore().logout();
  } catch {
    // 取消, 不动
  }
}
</script>

<template>
  <div class="admin" :class="{ 'sidebar-open': sidebarOpen, collapsed }">
    <!-- 手机抽屉遮罩 -->
    <div class="sidebar-mask" @click="closeSidebar"></div>
    <aside class="side">
      <div class="brand">
        <BrandLogo :height="48" />
        <div class="brand-text">
          <div class="title">{{ branding.systemName }}</div>
          <div class="sub">后台管理 · {{ roleLabel }}</div>
        </div>
        <!-- 抽屉内关闭按钮: 抽屉打开后, header 的 hamburger/X 被 fixed 侧栏遮住,
             在抽屉内直接给一个可见的关闭入口 (仅抽屉模式显示) -->
        <button
          type="button"
          class="drawer-close"
          aria-label="关闭菜单"
          title="关闭菜单"
          @click="closeSidebar"
        >
          <X :size="20" :stroke-width="2" />
        </button>
      </div>
      <nav class="menu">
        <template v-for="g in groups" :key="g.section">
          <button
            type="button"
            class="menu-section"
            :class="{ 'is-collapsed': isSectionCollapsed(g.section) }"
            :title="collapsed ? g.section : undefined"
            @click="toggleSection(g.section)"
          >
            <span class="section-label">{{ g.section }}</span>
            <ChevronDown :size="14" :stroke-width="2.2" class="section-chev" />
          </button>
          <div
            class="section-items"
            :class="{ collapsed: isSectionCollapsed(g.section) }"
          >
            <button
              v-for="it in g.items"
              :key="it.name"
              type="button"
              class="menu-item"
              :class="{ 'is-active': currentName === it.name }"
              :title="collapsed ? it.label : undefined"
              @click="go(it.name)"
            >
              <span class="ico">
                <component :is="adminNavIconFor(it.name)" :size="18" :stroke-width="1.75" />
              </span>
              <span class="lbl">{{ it.label }}</span>
            </button>
          </div>
        </template>
      </nav>
      <div class="footer">
        <button v-if="canReturnToFront" type="button" class="back" @click="returnToControl">返回设备控制</button>
        <button type="button" class="back" @click="go('admin-change-password')">
          <KeyRound :size="16" :stroke-width="2" /> 修改密码
        </button>
        <button type="button" class="back" @click="exitToFront">
          <LogOut :size="16" :stroke-width="2" /> 退出登录
        </button>
      </div>
    </aside>

    <div class="main">
      <header class="top">
        <button class="hamburger" @click="toggleSidebar" :aria-label="sidebarOpen ? '关闭菜单' : '打开菜单'">
          <X v-if="sidebarOpen" :size="20" :stroke-width="2" />
          <Menu v-else :size="20" :stroke-width="2" />
        </button>
        <button
          class="collapse-btn"
          type="button"
          :title="collapsed ? '展开侧栏' : '收起侧栏'"
          :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
          @click="toggleCollapse"
        >
          <PanelLeftOpen v-if="collapsed" :size="18" :stroke-width="2" />
          <PanelLeftClose v-else :size="18" :stroke-width="2" />
        </button>
        <div class="crumb">{{ flatItems.find((i) => i.name === currentName)?.label ?? '后台管理' }}</div>
        <div class="meta">
          <span class="version">{{ sys.info?.sprint ?? '—' }} · v{{ sys.info?.version ?? '—' }}</span>
          <span class="v2-pill" :class="sys.info?.mockMode ? '' : 'idle'">
            <span class="v2-dot"></span>{{ sys.info?.mockMode ? 'MOCK 模式' : '真实模式' }}
          </span>
          <span class="v2-pill">{{ roleLabel }}</span>
          <button
            v-if="fsSupported"
            type="button"
            class="fs-btn"
            :title="fsActive ? '退出全屏' : '全屏'"
            @click="toggleFullscreen"
          >
            <Minimize2 v-if="fsActive" :size="16" :stroke-width="2" />
            <Maximize2 v-else :size="16" :stroke-width="2" />
          </button>
          <span class="clock">{{ timeLabel }}</span>
        </div>
      </header>
      <main class="content">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <!-- 页面缓存: 切回已访问的后台页瞬开 + 保留筛选/滚动状态.
                 活页(监控/报警)被缓存时其中心化轮询继续, 数据保持新鲜;
                 超出 max 的旧页 LRU 淘汰 → onUnmounted 退订, 有界不泄漏. -->
            <keep-alive :max="12">
              <component :is="Component" />
            </keep-alive>
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin {
  display: grid;
  grid-template-columns: 220px 1fr;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  color: var(--v2-text-1);
  overflow: hidden;
  /* 跟 MainLayout 一样漏了 top —— 手机上顶部状态栏会压住"设备管理"这行 header */
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  box-sizing: border-box;
  position: relative;
  transition: grid-template-columns 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
/* 手机抽屉遮罩 — 默认不显示, 手机抽屉打开时盖上 */
.sidebar-mask {
  display: none;
}
/* 顶部汉堡按钮 — 桌面隐藏, 手机才显示 */
.hamburger {
  display: none;
  width: 40px;
  height: 40px;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
  color: var(--v2-text-1);
  border-radius: 8px;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: all 0.18s ease;
}
.hamburger:hover {
  background: var(--v2-surf-1-hover);
  border-color: var(--v2-primary);
}
/* 折叠侧栏按钮 — 桌面/平板显示, 手机隐藏 (手机用 hamburger 抽屉) */
.collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  margin-right: 10px;
  flex-shrink: 0;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
  color: var(--v2-text-2);
  border-radius: 8px;
  cursor: pointer;
  padding: 0;
  transition: all 0.18s ease;
}
.collapse-btn:hover {
  background: var(--v2-surf-1-hover);
  border-color: var(--v2-primary);
  color: var(--v2-primary-hover);
}
.side {
  display: flex;
  flex-direction: column;
  /* 实色面板 (去掉 backdrop-filter 毛玻璃 — 滚动时每帧重算模糊是卡顿主因) */
  background: var(--v2-chrome-bg-solid);
  border-right: 1px solid var(--v2-border-soft);
  min-height: 0;
  /* 2026-10-16 修菜单不能滚动：明确裁剪边界，让内部 .menu 的 overflow-y:auto 生效 */
  height: 100%;
  overflow: hidden;
}
.brand {
  display: flex; align-items: center; gap: var(--v2-sp-3);
  padding: 11px 16px;
  border-bottom: 1px solid var(--v2-border-soft);
}
/* 品牌文字区可收缩: 长系统名单行省略, 不换行把侧栏头部撑高 */
.brand-text { min-width: 0; flex: 1; }
.title {
  font-weight: 600; font-size: 16px;
  color: var(--v2-text-1); letter-spacing: 0.5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sub {
  font-size: 13px; color: var(--v2-text-3);
  margin-top: 2px; letter-spacing: 1px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* 抽屉内嵌关闭按钮: 桌面/平板默认隐藏, 仅抽屉媒体查询里显示 */
.drawer-close {
  display: none;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--v2-text-2);
  cursor: pointer;
  transition: all 0.18s ease;
}
.drawer-close:hover {
  background: var(--v2-surf-1-hover);
  color: var(--v2-text-1);
}
.drawer-close:active {
  background: var(--v2-surf-1);
}

.menu {
  flex: 1; display: flex; flex-direction: column; gap: 1px;
  padding: 5px 8px; overflow-y: auto;
  /* 2026-10-16 修菜单不能滚动：flex 子项默认 min-height:auto 会被内容撑高，
     导致 overflow-y:auto 不触发、底部菜单被 .admin 裁掉。必须显式 min-height:0。 */
  min-height: 0;
  /* 后台是 PC/鼠标，恢复细滚动条，让管理员能看出菜单可上下滚动（#55 后菜单增多） */
  scrollbar-width: thin;
  scrollbar-color: var(--v2-border-strong, rgba(255,255,255,0.22)) transparent;
  overscroll-behavior: contain;
}
.menu::-webkit-scrollbar { width: 6px; }
.menu::-webkit-scrollbar-thumb {
  background: var(--v2-border-strong, rgba(255,255,255,0.22));
  border-radius: 3px;
}
.menu::-webkit-scrollbar-track { background: transparent; }
/* 分组小标题 — 可点击展开 / 收起 */
.menu-section {
  width: 100%;
  flex-shrink: 0;
  display: flex; align-items: center; gap: 6px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: var(--v2-text-3);
  background: transparent;
  border: none;
  padding: 7px 12px 3px;
  user-select: none;
  cursor: pointer;
  font-family: inherit;
  border-radius: var(--v2-r-sm);
  text-align: left;
  transition: color 0.18s ease;
}
.menu-section:hover { color: var(--v2-text-1); }
.menu-section:first-child { padding-top: 2px; }
.section-label { flex: 1; min-width: 0; }
.section-chev {
  color: var(--v2-text-3);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}
.menu-section.is-collapsed .section-chev { transform: rotate(-90deg); }

/* 分组菜单项容器 — 展开 / 收起动画 */
.section-items {
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: hidden;
  max-height: 700px;
  /* flex 子项不被压缩，保持自然高度，内容超出时由 .menu 滚动（2026-10-16） */
  flex-shrink: 0;
  transition: max-height 0.22s ease;
}
.section-items.collapsed { max-height: 0; }
.menu-item {
  position: relative;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: var(--v2-text-2);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.3px;
  border-radius: var(--v2-r-sm);
  cursor: pointer;
  text-align: left;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  font-family: inherit;
  transition: all 0.18s ease;
}
.menu-item:hover {
  background: var(--v2-surf-1-hover);
  color: var(--v2-text-1);
}
.menu-item.is-active {
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
}
.menu-item.is-active::before {
  content: '';
  position: absolute;
  left: -10px; top: 50%;
  transform: translateY(-50%);
  width: 3px; height: 24px;
  background: var(--v2-primary);
  border-radius: 0 3px 3px 0;
}
.menu-item .ico {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  flex-shrink: 0;
}
.menu-item .lbl { flex: 1; }

.footer {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--v2-border-soft);
  /* 2026-10-16 修菜单滚动：底部按钮固定不被压缩，滚动只发生在 .menu */
  flex-shrink: 0;
}
.back {
  width: 100%;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--v2-surf-1);
  color: var(--v2-text-2);
  border: 1px solid var(--v2-border-soft);
  padding: 7px 12px;
  border-radius: var(--v2-r-sm);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  transition: all 0.18s ease;
}
.back:hover {
  background: var(--v2-surf-1-hover);
  color: var(--v2-text-1);
}

.main { display: flex; flex-direction: column; overflow: hidden; }
.top {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 22px;
  background: var(--v2-chrome-bg-solid);
  border-bottom: 1px solid var(--v2-border-soft);
}
.crumb {
  font-size: 16px; font-weight: 600;
  color: var(--v2-text-1); letter-spacing: 0.5px;
}
.meta { display: flex; align-items: center; gap: var(--v2-sp-3); }
.version { font-size: 12px; color: var(--v2-text-3); }
.clock {
  font-family: "Inter", system-ui;
  font-variant-numeric: tabular-nums;
  font-size: 14px;
  color: var(--v2-text-1);
}
.fs-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
  color: var(--v2-text-2);
  border-radius: 8px;
  cursor: pointer;
  padding: 0;
  transition: all 0.18s ease;
}
.fs-btn:hover {
  background: var(--v2-surf-1-hover);
  border-color: var(--v2-primary);
  color: var(--v2-primary-hover);
}

.content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  /* 滚动条槽位恒定：不同页面高度不同，滚动条出现/消失不再改变内容宽度，消除横向抖动。 */
  scrollbar-gutter: stable;
  padding: var(--v2-sp-5);
  box-sizing: border-box;
  /* 纵向弹性：让页面根元素至少撑满一屏，空态/loading 不会把高度压低，减少纵向跳动。 */
  display: flex;
  flex-direction: column;
}
.content > * {
  flex: 1 0 auto;
  min-width: 0;
}
/* 不支持 scrollbar-gutter 的旧浏览器：始终显示纵向滚动条，同样保证宽度恒定。 */
@supports not (scrollbar-gutter: stable) {
  .content { overflow-y: scroll; }
}

/* A short fade keeps navigation calm and avoids content movement. */
.page-enter-from { opacity: 0; }
.page-leave-to { opacity: 0; }
.page-enter-active { transition: opacity 0.1s ease; }
.page-leave-active { transition: opacity 0.09s ease; }

/* ============ 折叠态: 侧栏收成 64px 图标栏 (仅 >600px, 手机不受影响) ============ */
@media (min-width: 601px) {
  .admin.collapsed { grid-template-columns: 64px 1fr; }
  /* 品牌区: 只留 logo 居中, 隐藏文字 */
  .collapsed .brand { justify-content: center; padding: 16px 8px; }
  .collapsed .brand-text { display: none; }
  /* 菜单: 图标居中, 隐藏文字 (hover 有 title 气泡提示) */
  .collapsed .menu { padding: var(--v2-sp-3) 8px; }
  /* 分组标题 → 细分隔线 (第一组上面不要线); 隐藏 label / chevron */
  .collapsed .menu-section {
    height: 1px; font-size: 0; padding: 0; overflow: hidden;
    margin: 8px 6px; background: var(--v2-border-soft); letter-spacing: 0;
  }
  .collapsed .menu-section:first-child { display: none; }
  .collapsed .section-label, .collapsed .section-chev { display: none; }
  /* 图标栏模式: 强制显示所有菜单项, 不受分组折叠影响 */
  .collapsed .section-items { max-height: none; }
  .collapsed .menu-item { justify-content: center; padding: 5px 0; }
  .collapsed .menu-item .lbl { display: none; }
  .collapsed .menu-item.is-active::before { left: -8px; height: 24px; }
  /* 底部按钮: 只留图标 */
  .collapsed .footer { padding: var(--v2-sp-3) 8px; }
  .collapsed .footer .back { gap: 0; font-size: 0; padding: 10px 0; }
}

/* ============ 平板竖屏 (≤900px): 侧栏缩窄 ============ */
@media (max-width: 900px) and (min-width: 601px) {
  .admin { grid-template-columns: 180px 1fr; }
  .menu-item { padding: 8px 10px; font-size: 13px; }
  .top { padding: 10px 16px; }
  .crumb { font-size: 14px; }
  .meta { gap: var(--v2-sp-2); }
  .version { display: none; }
}

/* ============ 手机 (≤600px 竖屏 / 601-900px 且 ≤500px 横屏): 侧栏变抽屉 ============
 * Sprint H2 2026-05-31: 业主可能用手机进后台
 * 模式: 默认隐藏 → 点汉堡按钮唤出 → 点 mask 或菜单项关闭
 * 第二十四轮: 手机横屏 (高 ≤500) 也走抽屉 — 否则 collapsed 残留会让
 * 侧栏只显示 64px 图标列、标题消失, 而展开按钮在矮 header 里不显眼。
 * 第二十五轮: 横屏条件改为不依赖宽度上限 (orientation:landscape + max-height:500),
 * 覆盖 iPhone 16 Pro Max 横屏 (956 宽, 原 max-width:900 漏覆盖 → 走 min-width:601
 * 把 brand 居中、标题隐藏, 旋转竖屏后 iOS 可能不重排)。
 */
@media (max-width: 600px), (orientation: landscape) and (max-height: 500px) {
  /* 手机横屏 collapsed 残留时, 用同等特异性把 grid 压回单列 (覆盖 .admin.collapsed 64px) */
  .admin,
  .admin.collapsed {
    grid-template-columns: 1fr;
  }
  .hamburger {
    display: inline-flex;
    margin-right: 12px;
  }
  /* 手机用抽屉, 不需要折叠按钮 */
  .collapse-btn {
    display: none;
  }
  /* 侧栏 → fixed 抽屉, 默认 translateX(-100%) 藏左边 */
  .side {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 280px;
    max-width: 80vw;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 8px 0 32px -8px rgba(0, 0, 0, 0.7);
    background: var(--v2-chrome-bg-solid);
    backdrop-filter: blur(5px);
    -webkit-backdrop-filter: blur(5px);
    padding-top: env(safe-area-inset-top);
  }
  .admin.sidebar-open .side {
    transform: translateX(0);
  }
  /* 抽屉模式: 无论 collapsed 状态如何, 无条件让 brand 左对齐、标题显示
     (双保险 — 防止横屏旋转后 iOS 布局视口/brand 状态卡住)。.admin .brand 特异性
     (0,2,0) 与 .collapsed .brand 同级, 但此媒体查询与 min-width:601 互斥。 */
  .admin .brand { justify-content: flex-start; padding: 16px 18px; gap: 12px; }
  .admin .brand-text { display: block; }
  /* 抽屉内嵌关闭按钮可见 */
  .admin .drawer-close { display: inline-flex; }
  /* 手机横屏 collapsed 残留: 撤销图标栏 (min-width:601 块) 的压缩, 让抽屉完整呈现。
     用 .admin.collapsed 前缀提高特异性, 覆盖原 collapsed 规则; 分组折叠仍由
     .section-items.collapsed 控制。 */
  .admin.collapsed .brand { justify-content: flex-start; padding: 16px 18px; }
  .admin.collapsed .brand-text { display: block; }
  .admin.collapsed .menu { gap: 3px; padding: 6px 10px; }
  .admin.collapsed .menu-section {
    height: auto; font-size: inherit; padding: 10px 12px 4px; overflow: visible;
    margin: 0; background: transparent; letter-spacing: normal;
  }
  .admin.collapsed .menu-section:first-child { display: block; padding-top: 4px; }
  .admin.collapsed .section-label,
  .admin.collapsed .section-chev { display: inline-flex; }
  .admin.collapsed .section-items { max-height: 700px; }
  .admin.collapsed .section-items.collapsed { max-height: 0; }
  .admin.collapsed .menu-item { justify-content: flex-start; padding: 10px 12px; font-size: 14px; }
  .admin.collapsed .menu-item .lbl { display: inline; }
  .admin.collapsed .menu-item.is-active::before { left: -10px; height: 24px; }
  .admin.collapsed .footer { padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); }
  .admin.collapsed .footer .back { gap: 8px; font-size: inherit; padding: 10px 0; }
  /* 手机抽屉行距 (2026-07-30 业主嫌窄放宽 → 07-31 复评"又太大, 超出手机整屏"):
     第三版取中 — 行高 ~38px (仍高于 36px 触摸底线), 13 项 + 4 分组 + 品牌 +
     底按钮合计 ~780px, 常见手机 (812px+) 一屏装下。只影响 ≤600px 抽屉。 */
  .menu { gap: 3px; padding: 6px 10px; }
  .menu-section { padding: 10px 12px 4px; }
  .menu-section:first-child { padding-top: 4px; }
  .menu-item { padding: 10px 12px; font-size: 14px; }
  .footer { padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); }
  .footer .back { padding: 10px 0; }
  /* 遮罩 — 抽屉打开时盖在 main 区上, 点击关闭 */
  .sidebar-mask {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    z-index: 99;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.22s ease;
  }
  .admin.sidebar-open .sidebar-mask {
    opacity: 1;
    pointer-events: auto;
  }

  /* 顶 header 紧凑 */
  .top {
    padding: 10px 14px;
    gap: 8px;
  }
  .crumb { font-size: 15px; }
  .meta { gap: var(--v2-sp-2); }
  .version { display: none; }
  .v2-pill { display: none; }
  /* 角色 select 收窄 */
  .meta :deep(.el-select) { width: 84px !important; }
  .clock { font-size: 13px; }

  /* 内容 padding 减小 */
  .content {
    padding: var(--v2-sp-3);
  }
}
</style>
