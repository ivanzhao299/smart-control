<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
// 2026-05-31:
// - 全屏按钮 + FullscreenPrompt 弹层已去掉 (用户嫌)
// - useFullscreen 保留, 静默模式: 用户首次任意点击/触摸/按键 → 自动请求
//   Fullscreen API, 平板浏览器一进就全屏, kiosk-like 体验
// - PWA standalone 启动也仍然全屏 (manifest display: fullscreen 接管)
// - AlertBanner 已移除, 告警走后台 /admin/alerts
// - 场景反馈走顶部 inline toast
import { Maximize2, Minimize2, MoreHorizontal } from 'lucide-vue-next';
import ErrorBoundary from '@/components/ErrorBoundary.vue';
import ServerSettingsDialog from '@/components/ServerSettingsDialog.vue';
import { useFullscreen } from '@/composables/useFullscreen';
import { navIconFor } from '@/composables/useIcons';
import { setConnectivityListener } from '@/services/http';
import { useConnectionStore } from '@/stores/connection';
import { useSystemStore } from '@/stores/system';
import { useSceneStore } from '@/stores/scene';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { useToastStore } from '@/stores/toast';

const route = useRoute();
const router = useRouter();
const sys = useSystemStore();
const sceneStore = useSceneStore();
const brandingStore = useSystemBrandingStore();
const branding = computed(() => brandingStore.branding);
const toast = useToastStore();
const toastMsg = computed(() => toast.current);
const conn = useConnectionStore();

/**
 * 2026-05-31 性能优化: 应用 mount 后 idle 预取常用页 chunk.
 * 业主进入首页 800ms 后浏览器空闲, 偷偷把灯光/LED/音响/空调/电源/媒体/状态
 * 6 个常用页 chunk 都下载下来. 之后切菜单是"打开缓存", 不再有 300ms 黑屏.
 * 不阻塞首屏渲染, 失败也无所谓 (路由懒加载兜底).
 */
function prefetchMainPages(): void {
  const tasks = [
    () => import('@/pages/LightingPage.vue'),
    () => import('@/pages/LedPage.vue'),
    () => import('@/pages/AudioPage.vue'),
    () => import('@/pages/HvacPage.vue'),
    () => import('@/pages/PowerPage.vue'),
    () => import('@/pages/MediaPage.vue'),
    () => import('@/pages/StatusPage.vue'),
  ];
  const runNext = () => {
    const t = tasks.shift();
    if (!t) return;
    t().catch(() => { /* 失败无所谓 */ }).finally(() => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
      if (typeof ric === 'function') ric(runNext);
      else setTimeout(runNext, 400);
    });
  };
  // 800ms 后启动, 给首屏渲染让路
  setTimeout(runNext, 800);
}

/**
 * 数据层预热: chunk 下完了但页面进去仍要拉 API 一遭, 是用户感知卡顿的真凶.
 * 这里在 idle 时偷偷把各子系统的 list API 也拉一遍, 走 workbox NetworkFirst
 * cache (60s). 之后切菜单, 拉 API 命中 cache 即时返回, 不再 200-400ms 网络等待.
 */
async function prefetchData(): Promise<void> {
  // 关键 list API, 放进 cache. 用裸 fetch + GET, 不经业务 service (失败也无所谓)
  const apis = [
    '/control/api/light-zones',
    '/control/api/power-circuits',
    '/control/api/devices?pageSize=200',
    '/control/api/scenes?pageSize=200',
    '/control/api/system/info',
  ];
  for (const url of apis) {
    fetch(url).catch(() => { /* 失败无所谓 */ });
    await new Promise<void>((r) => setTimeout(r, 80));
  }
}

onMounted(() => {
  prefetchMainPages();
  setTimeout(() => { void prefetchData(); }, 1200);
  // 连通性监听: 每个 API 请求结束都报告到 connection store
  setConnectivityListener(conn.report);
});
onUnmounted(() => {
  setConnectivityListener(null);
});

/**
 * 服务器地址设置弹窗 — 两个入口:
 *   1. API 连续失败 (服务器 IP 变了/断网) → 自动弹出, 每次断线只弹一次,
 *      业主关掉后不再骚扰, 恢复在线后重新武装
 */
const showServerSettings = ref(false);
const serverSettingsReason = ref<string | undefined>(undefined);
let autoOpenedThisEpisode = false;
watch(() => conn.online, (online) => {
  if (!online && !autoOpenedThisEpisode && !showServerSettings.value) {
    autoOpenedThisEpisode = true;
    serverSettingsReason.value = '无法连接服务器 — 请确认服务器地址, 或从下方历史列表选择';
    showServerSettings.value = true;
  }
  if (online) autoOpenedThisEpisode = false;
});

/** hover/touch 时立刻 prefetch 对应路由 chunk — 比 click 早 ~200ms */
const ROUTE_PREFETCH: Record<string, () => Promise<unknown>> = {
  dashboard: () => import('@/pages/DashboardPage.vue'),
  lighting: () => import('@/pages/LightingPage.vue'),
  led: () => import('@/pages/LedPage.vue'),
  projector: () => import('@/pages/ProjectorPage.vue'),
  audio: () => import('@/pages/AudioPage.vue'),
  hvac: () => import('@/pages/HvacPage.vue'),
  power: () => import('@/pages/PowerPage.vue'),
  media: () => import('@/pages/MediaPage.vue'),
  status: () => import('@/pages/StatusPage.vue'),
  'admin-devices': () => import('@/layouts/AdminLayout.vue'),
};
const prefetched = new Set<string>();
/** hover/touch 时同时 prefetch chunk + 数据 — 等 click 时两者都已 ready */
const NAV_API_PREFETCH: Record<string, string[]> = {
  lighting: ['/control/api/light-zones'],
  power: ['/control/api/power-circuits'],
  hvac: ['/control/api/devices?category=hvac-zone'],
  led: ['/control/api/devices?category=led'],
  audio: ['/control/api/devices?category=audio-zone'],
  media: ['/control/api/media?pageSize=50'],
  status: ['/control/api/system/info'],
};
function prefetchRoute(name: string): void {
  if (prefetched.has(name)) return;
  const fn = ROUTE_PREFETCH[name];
  if (!fn) return;
  prefetched.add(name);
  fn().catch(() => { prefetched.delete(name); });
  // 同时 prefetch 该页用到的 API
  const apis = NAV_API_PREFETCH[name];
  if (apis) {
    for (const url of apis) fetch(url).catch(() => {});
  }
}

// Auto-enter 全屏: 用户首次 click/touch/keydown 后自动 request fullscreen.
// 同时暴露 toggle/isActive 给顶栏全屏按钮 (业主反馈要手动按钮).
// 已在 PWA standalone 模式时跳过 autoEnter (浏览器本身已经全屏).
const fs = useFullscreen({ autoEnter: true });
const fsActive = fs.isActive;
const fsSupported = fs.isSupported;
function toggleFullscreen(): void { void fs.toggle(); }

// v2 侧导航 - 只 icon (跟 mockup 一致), title 给 hover tooltip
const navItems: Array<{ name: string; label: string; section?: 'main' | 'tools' }> = [
  { name: 'dashboard', label: '首页', section: 'main' },
  { name: 'lighting', label: '灯光', section: 'main' },
  { name: 'led', label: 'LED 大屏', section: 'main' },
  { name: 'projector', label: '投影仪', section: 'main' },
  { name: 'audio', label: '音响', section: 'main' },
  { name: 'hvac', label: '空调', section: 'main' },
  { name: 'power', label: '电源', section: 'main' },
  { name: 'media', label: '媒体', section: 'tools' },
  { name: 'status', label: '状态', section: 'tools' },
  { name: 'admin-devices', label: '后台', section: 'tools' },
];
const mainNavs = navItems.filter((n) => n.section === 'main');
const toolNavs = navItems.filter((n) => n.section === 'tools');

/**
 * 手机竖屏: 底栏只放 main (6 个) + 一个「更多」, tools 收进抽屉。
 *
 * 2026-07-17 业主: "横屏、竖屏模式下, 功能图标分布要科学美观"。
 * 实测 390×844 (iPhone 14) 底栏塞 9 个: **每个只有 42px 宽**, 低于 Apple HIG 的
 * 44pt / Material 的 48dp 触摸下限 —— 手指点不准, 这是可量化的不合格, 不是审美问题。
 * 390 / 44 ≈ 8.8, 最多容 8 个。收起 3 个 tools 后是 6+1=7 个槽 -> 每个 55px, 达标。
 * 这也是 iOS 标准做法 (标签栏最多 5 个, 其余进 More)。
 * 平板/主控机 (>600px) 是侧栏, 空间够, 9 个全列, 不受影响。
 */
const moreOpen = ref(false);
function goFromMore(name: string): void {
  moreOpen.value = false;
  go(name);
}
/** 当前页在「更多」里时, 让「更多」按钮也高亮 —— 否则点进去后底栏没有任何选中态 */
const moreActive = computed(() => toolNavs.some((n) => n.name === route.name));

function go(name: string): void {
  if (route.name !== name) router.push({ name });
}

// 首页保留全局顶栏 (品牌+时钟氛围); 功能页隐藏它, 主区上移多出 56px 给功能区
const showHeader = computed(() => route.name === 'dashboard');

// ===== Header 数据 =====
const dateLabel = computed(() => {
  const d = new Date(sys.now);
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 周${days[d.getDay()]}`;
});
const clockHM = computed(() => {
  const d = new Date(sys.now);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
});
const clockSec = computed(() => String(new Date(sys.now).getSeconds()).padStart(2, '0'));

const activeScene = computed(() => {
  const code = sceneStore.activeSceneCode;
  if (!code) return '无运行';
  return sceneStore.scenes.find((s) => s.code === code)?.name ?? code;
});

const wsPillCls = computed(() => {
  if (sys.wsState === 'open') return '';
  if (sys.wsState === 'connecting') return 'warn';
  return 'danger';
});
const wsPillText = computed(() => {
  if (sys.wsState === 'open') return '网络在线';
  if (sys.wsState === 'connecting') return '连接中';
  return '网络离线';
});

// 告警状态已经移到 header 中段的 AlertBanner 内联条 (有告警时才显示)

const mockTag = computed(() => sys.info?.mockMode ?? false);
</script>

<template>
  <div class="v2-shell" :class="{ lean: !showHeader }">

    <!-- 侧导航 (80px, 顶部品牌 logo + icon/文字 nav, 不滚) -->
    <aside class="v2-nav">
      <!-- 品牌 logo: 占侧栏顶部, header 不再重复显示. 文字 / 图片由 SystemBranding 配置 -->
      <button class="v2-nav-brand" :title="branding.systemName" @click="go('dashboard')">
        <div class="v2-logo">
          <img v-if="branding.logoUrl" :src="branding.logoUrl" :alt="branding.logoText" />
          <template v-else>{{ branding.logoText }}</template>
        </div>
      </button>
      <!-- nav 列表: flex-grow 占满剩余高度, items 之间 space-around 自动均布
           性能: pointerenter (hover/touch start) 触发 chunk 预取, 等手指离开
           按钮命中已下载缓存, 切页 100ms 内完成 -->
      <nav class="v2-nav-list">
        <button
          v-for="item in mainNavs"
          :key="item.name"
          class="v2-nav-item"
          :class="{ 'is-active': route.name === item.name }"
          :title="item.label"
          @click="go(item.name)"
          @pointerenter="prefetchRoute(item.name)"
        >
          <component :is="navIconFor(item.name)" :size="22" :stroke-width="1.8" />
          <span class="v2-nav-label">{{ item.label }}</span>
        </button>
        <div class="v2-nav-divider"></div>
        <!-- 平板/主控机 (侧栏): tools 直接全列, 空间够 -->
        <button
          v-for="item in toolNavs"
          :key="item.name"
          class="v2-nav-item v2-nav-tool"
          :class="{ 'is-active': route.name === item.name }"
          :title="item.label"
          @click="go(item.name)"
          @pointerenter="prefetchRoute(item.name)"
        >
          <component :is="navIconFor(item.name)" :size="22" :stroke-width="1.8" />
          <span class="v2-nav-label">{{ item.label }}</span>
        </button>
        <!-- 手机竖屏 (底栏): tools 收进「更多」, 保证每个触摸目标 >=44pt。
             实测 390px 塞 9 个每个只有 42px, 低于 Apple HIG 下限; 6+1 个则是 55px。 -->
        <button
          class="v2-nav-item v2-nav-more"
          :class="{ 'is-active': moreActive }"
          title="更多"
          @click="moreOpen = true"
        >
          <MoreHorizontal :size="22" :stroke-width="1.8" />
          <span class="v2-nav-label">更多</span>
        </button>
      </nav>

      <!-- 2026-07-17 业主: "那个网络按钮就是个沙币设计, 连不上网就进不了界面,
           看不到这个按钮, 把它直接删掉"。
           他是对的, 而且代码坐实了: 上面那个 watch(conn.online) 在**离线时会自动弹出**
           服务器设置框 —— 这个按钮唯一的用途 (连不上时改地址) 本来就被覆盖了;
           而能看见它的时候恰恰是在线、根本不需要它的时候。纯占位。
           真要手动改地址: 退出登录回 ClientLogin 页即可 (那里就是填服务器地址的)。 -->
    </aside>

    <!-- 「更多」抽屉 (仅手机竖屏底栏用). 从底部升起, 遵循 iOS sheet 习惯;
         点遮罩或选完即关。安全区兜底, 否则 iPhone 底部横条会压住最后一项。 -->
    <!-- 刻意不做入场动画 (纯 v-if, 无 transition / 无 CSS animation).
         2026-07-17: 一开始用了 <transition>, 测出"关闭后节点删不掉、留下 opacity:0 的
         全屏遮罩吞掉所有点击"。后来做对照实验才发现: **是测试环境的动画时钟冻结**
         (随便造一个动画, 500ms 后 currentTime 仍是 0) —— transition 靠 transitionend
         收尾, 动画永不结束, 节点自然删不掉。真机上它本来是好的, 那是个假 bug。
         但结论没变: 任何依赖动画时钟的方案, 一旦某个环境节流动画就会把面板卡成隐形,
         而我在这个环境里**无法验证**动画。收益是 160ms 淡入, 风险是整个面板看不见 ——
         不值。纯 v-if 立刻出现, 不可能坏, 手机上也完全可接受。 -->
    <div v-if="moreOpen" class="v2-more-mask" @click="moreOpen = false">
        <div class="v2-more-sheet" @click.stop>
          <div class="v2-more-grip"></div>
          <div class="v2-more-grid">
            <button
              v-for="item in toolNavs"
              :key="item.name"
              class="v2-more-item"
              :class="{ 'is-active': route.name === item.name }"
              @click="goFromMore(item.name)"
            >
              <component :is="navIconFor(item.name)" :size="26" :stroke-width="1.8" />
              <span>{{ item.label }}</span>
            </button>
          </div>
        </div>
    </div>

    <!-- 顶 Header (56px) - 仅首页显示 (功能页隐藏, 主区上移给功能区让空间); 集成 inline toast -->
    <header v-if="showHeader" class="v2-header">
      <div class="v2-brand">
        <div class="v2-brand-title">{{ branding.systemName }}</div>
        <div class="v2-brand-sub">{{ dateLabel }}</div>
      </div>

      <!-- inline toast — 5s 自动消失, 纯文字无框, 不挡左右两端 -->
      <div class="v2-header-spacer">
        <transition name="toast-fade">
          <div
            v-if="toastMsg"
            class="v2-inline-toast"
            :class="`is-${toastMsg.type}`"
            @click="toast.clear()"
            :title="'点击关闭'"
          >{{ toastMsg.text }}</div>
        </transition>
      </div>

      <div class="v2-header-right">
        <span class="v2-pill" :class="{ idle: activeScene === '无运行' }">
          <span class="v2-dot"></span>
          {{ activeScene }}
        </span>
        <!-- 网络状态 pill: 已连接时隐藏 (无消息就是好消息), 只在 connecting/离线时弹出红黄提示
             业主反馈 2026-05-31: 正常连接时这个图标没必要常驻, 还挤时钟 -->
        <span v-if="sys.wsState !== 'open'" class="v2-pill" :class="wsPillCls">
          <span class="v2-dot"></span>{{ wsPillText }}
        </span>
        <span v-if="mockTag" class="v2-pill" style="background: rgba(59,130,246,.12); color: var(--v2-info); border-color: rgba(59,130,246,.3)">
          MOCK
        </span>
        <div class="v2-clock v2-inter">
          {{ clockHM }}<span class="sec">:{{ clockSec }}</span>
        </div>
        <!-- 全屏切换按钮 (业主反馈 2026-06-13 要手动按钮). 不支持 Fullscreen API 就不显示 -->
        <button
          v-if="fsSupported"
          class="v2-fs-btn"
          :title="fsActive ? '退出全屏' : '进入全屏'"
          @click="toggleFullscreen"
        >
          <Minimize2 v-if="fsActive" :size="18" :stroke-width="2" />
          <Maximize2 v-else :size="18" :stroke-width="2" />
        </button>
      </div>
    </header>

    <!-- 主区 -->
    <main class="v2-main">
      <router-view v-slot="{ Component }">
        <!-- 崩溃自恢复: ErrorBoundary 包住所有页面, 单页报错降级不白屏整机 -->
        <ErrorBoundary>
          <!-- PERFORMANCE_AUDIT P1-#7: max 6 → 10 覆盖 8 项主菜单 +
               admin 入口缓冲, 切页 100% 命中缓存 (60-100ms vs 重 mount 200-400ms) -->
          <keep-alive :max="10">
            <component :is="Component" />
          </keep-alive>
        </ErrorBoundary>
      </router-view>
    </main>

    <!-- 全屏 prompt 已去掉. 场景执行结果走顶部 inline toast. -->

    <!-- 服务器地址设置弹窗: API 连不上自动弹 / 侧导航网络按钮手动开 -->
    <ServerSettingsDialog v-model="showServerSettings" :reason="serverSettingsReason" />
  </div>
</template>

<style scoped>
.v2-shell {
  display: grid;
  grid-template-columns: 80px 1fr;
  grid-template-rows: 56px 1fr;
  grid-template-areas:
    "nav header"
    "nav main";
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  /* 2026-07-17: 原来只让了 bottom/left/right, **唯独漏了 top** —— 手机上内容会钻到
     状态栏(时间/信号/刘海)底下。viewport-fit=cover 要求四边都让, 漏一边压一边。 */
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  box-sizing: border-box;
  overflow: hidden;
}
/* 功能页 (非首页): 隐藏全局顶栏, 主区上移占满, 多出 56px 给功能区 */
.v2-shell.lean {
  grid-template-rows: 1fr;
  grid-template-areas: "nav main";
}

/* ============ 侧导航 (顶 brand + icon/文字 nav, 项 flex-grow 充满屏幕高度) ============ */
.v2-nav {
  grid-area: nav;
  /* 跨满 grid 所有行: 有 header 时跨 header+main, 无 header 时只 main — 靠 grid-template-areas 的 nav 区域自动撑, 不写死 grid-row */
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 6px 10px;
  border-right: 1px solid var(--v2-border-soft);
  background: rgba(10, 14, 26, 0.5);
  overflow: hidden;
}
/* 项容器 — flex-grow 占满 brand 之下的所有剩余高度
   高度够: 按钮均分撑满, 居中分布
   高度不够 (手机横屏 ~360px viewport): 按 min-height 44 自然撑出, overflow-y: auto 可滚
   注: justify-content: safe center 在 overflow 时退化成 flex-start, 不再裁切两端 */
.v2-nav-list {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: safe center;
  gap: 4px;
  padding: 4px 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* 隐藏滚动条 — 视觉干净, 手指/滚轮仍能滚 */
  scrollbar-width: none;
}
.v2-nav-list::-webkit-scrollbar { display: none; }

/* 品牌 logo 块: 占侧栏顶部, 在 nav item 之上, 视觉上接管 header 56px 高 */
.v2-nav-brand {
  width: 64px;
  height: 56px;
  display: grid;
  place-items: center;
  cursor: pointer;
  border: none;
  background: transparent;
  padding: 0;
  margin-bottom: 8px;
  position: relative;
  flex-shrink: 0;
  transition: transform 0.18s ease;
}
.v2-nav-brand::after {
  /* 跟主 header 底部 border 对齐, 视觉连成一线 */
  content: '';
  position: absolute;
  left: -6px;
  right: -6px;
  bottom: -6px;
  height: 1px;
  background: var(--v2-border-soft);
}
.v2-nav-brand:hover { transform: scale(1.04); }
.v2-nav-brand .v2-logo {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--v2-primary) 0%, var(--v2-info) 100%);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 18px;
  color: white;
  letter-spacing: 0;
  box-shadow: 0 4px 14px -4px rgba(6, 182, 212, 0.6);
  overflow: hidden;
}
.v2-nav-brand .v2-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* nav 按钮 — 宽固定 64, 高度弹性 (44-64), 默认透明无框, hover/active 才显 */
.v2-nav-item {
  width: 64px;
  flex: 1 1 0;
  max-height: 64px;
  min-height: 44px;
  border-radius: var(--v2-r-md);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--v2-text-3);
  cursor: pointer;
  transition: all 0.18s ease;
  position: relative;
  background: transparent;
  border: none;
  padding: 4px 0;
  font-family: inherit;
}
.v2-nav-item:hover {
  background: var(--v2-surf-1-hover);
  color: var(--v2-text-1);
}
.v2-nav-item:hover svg {
  filter: drop-shadow(0 0 6px var(--v2-primary));
}
.v2-nav-item.is-active {
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.20) 0%, rgba(0, 229, 255, 0.04) 100%);
  color: var(--v2-primary-hover);
  box-shadow: inset 0 1px 0 rgba(0, 229, 255, 0.4);
}
.v2-nav-item.is-active svg {
  filter: drop-shadow(0 0 10px var(--v2-primary));
}
/* 选中项左边一条电光青光柱 — v3 蔚来车机标志 */
.v2-nav-item.is-active::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 30px;
  background: linear-gradient(180deg, transparent, var(--v2-primary) 30%, var(--v2-primary-hover) 50%, var(--v2-primary) 70%, transparent);
  border-radius: 0 4px 4px 0;
  box-shadow: 0 0 12px var(--v2-primary), 0 0 24px var(--v2-primary-soft);
}
.v2-nav-label {
  font-size: 11px;
  letter-spacing: 0.5px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.v2-nav-divider {
  width: 36px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--v2-border-strong), transparent);
  margin: 2px 0;
  flex-shrink: 0;
}

/* 侧栏底部固定的服务器设置入口 — 不参与 nav-list 均分, 始终贴底 */
@keyframes server-offline-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* ============ Header ============ */
.v2-header {
  grid-area: header;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--v2-sp-5);
  border-bottom: 1px solid var(--v2-border-soft);
  background: rgba(10, 14, 26, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.v2-brand {
  /* logo 已挪到侧栏, 这里就是纵向 title + sub 块 */
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
/* .v2-logo 留着, 现在只被 .v2-nav-brand .v2-logo 用 (已覆盖尺寸) */
.v2-logo {
  border-radius: var(--v2-r-sm);
  background: linear-gradient(135deg, var(--v2-primary) 0%, var(--v2-info) 100%);
  display: grid;
  place-items: center;
  font-weight: 700;
  color: white;
  letter-spacing: 0;
}
.v2-brand-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--v2-text-1);
  text-shadow: 0 0 12px rgba(0, 229, 255, 0.35);
}
.v2-brand-sub {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-2);
  margin-top: 3px;
  letter-spacing: 0.6px;
}
/* 顶 header 中段 — 容纳 inline toast (没有时空着) */
.v2-header-spacer {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--v2-sp-4);
  overflow: hidden;
}

/* inline toast — 纯文字, 无框, 各 type 一种色, 单行截断 */
.v2-inline-toast {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.3px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  line-height: 1.4;
}
.v2-inline-toast.is-error {
  color: #FCA5A5;
  text-shadow: 0 0 8px rgba(255, 71, 87, 0.55);
}
.v2-inline-toast.is-warning {
  color: #FCD34D;
  text-shadow: 0 0 8px rgba(255, 184, 0, 0.55);
}
.v2-inline-toast.is-success {
  color: #6EE7B7;
  text-shadow: 0 0 8px rgba(0, 231, 138, 0.55);
}
.v2-inline-toast.is-info {
  color: #BFD7FF;
  text-shadow: 0 0 8px rgba(91, 143, 255, 0.45);
}

/* 渐显 / 渐隐 */
.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
}
.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.v2-header-right {
  display: flex;
  align-items: center;
  gap: var(--v2-sp-3);
  flex-shrink: 0;
}
/* 全屏切换按钮 */
.v2-fs-btn {
  width: 36px; height: 36px; flex-shrink: 0;
  display: grid; place-items: center;
  border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2); cursor: pointer;
  transition: all 0.18s ease;
}
.v2-fs-btn:hover {
  background: var(--v2-surf-1-hover); color: var(--v2-primary-hover);
  border-color: rgba(0, 229, 255, 0.4);
}
.v2-fs-btn:active { transform: scale(0.94); }
/* 顶栏时钟 — Tesla / NIO 中控感: JetBrains Mono + tabular-nums + cyan glow + 冒号闪烁 */
.v2-clock {
  font-size: 22px;
  font-weight: 600;
  color: var(--v2-text-1);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 2px;
  text-shadow: var(--v2-text-glow-primary);
  /* 冒号 (在 22:38) 用 animation 闪烁, 实现"心跳秒" 效果 */
  position: relative;
}
.v2-clock::first-letter {
  /* 数字稍微更高 */
}
.v2-clock .sec {
  font-size: 13px;
  color: var(--v2-primary);
  margin-left: 5px;
  letter-spacing: 1px;
  text-shadow: 0 0 8px var(--v2-primary);
  font-weight: 500;
  animation: v3-sec-pulse 1s ease-in-out infinite;
}
@keyframes v3-sec-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
/* .v2-fs-btn 已删 — 全屏按钮 2026-05-31 去掉 */

/* ============ 主区 ============ */
.v2-main {
  grid-area: main;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
  min-height: 0;
}

/* ============ 窄屏适配 ============ */
@media (max-width: 900px) {
  .v2-shell { grid-template-columns: 72px 1fr; }
  .v2-nav-item { width: 60px; min-height: 46px; }
  .v2-nav-label { font-size: 10px; }
  .v2-brand-title { font-size: 13px; }
  .v2-brand-sub { font-size: 10px; }
  .v2-header { padding: 0 var(--v2-sp-3); }
  .v2-header-right { gap: var(--v2-sp-2); }
  .v2-header-alert { margin: 0 var(--v2-sp-2); max-width: 360px; }
}
@media (max-width: 720px) {
  .v2-pill { display: none; }
  .v2-pill.danger { display: inline-flex; }
  .v2-header-alert { max-width: 220px; }
}
/* 矮屏 (<700px): 字标变小, 间距压缩, 仍然装下 */
@media (max-height: 700px) {
  .v2-nav { padding: 6px 4px; }
  .v2-nav-item { min-height: 44px; gap: 2px; padding: 4px 2px; }
  .v2-nav-label { font-size: 10px; }
}

/* ============ 手机竖屏 (≤600px) — 侧栏变底栏 ============
 * Sprint H 2026-05-31: 业主可能用手机操作.
 * 布局: header 48px + main 1fr + bottom-nav 56px
 * 侧栏内部 nav-list 旋成横排, 跟原生 iOS / Android tabbar 一样
 */
/* 「更多」按钮只在手机竖屏底栏出现; 侧栏形态 (平板/主控机) 隐藏 —— 那儿 tools 是全列的 */
.v2-nav-more { display: none; }

/* ===== 「更多」抽屉 ===== */
.v2-more-mask {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(0, 0, 0, .5);
  display: flex; align-items: flex-end;
}
.v2-more-sheet {
  width: 100%;
  background: var(--v2-surface, #141c28);
  border-top: 1px solid var(--v2-border, #26344a);
  border-radius: 18px 18px 0 0;
  /* 封顶 34px, 理由跟 .v2-nav 那处一致 (Chrome for iOS 的 env() 汇报值不可信) */
  padding: 10px 14px calc(14px + min(env(safe-area-inset-bottom), 34px));
}
.v2-more-grip {
  width: 40px; height: 4px; margin: 2px auto 12px;
  border-radius: 3px; background: #46566e;
}
.v2-more-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.v2-more-item {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 16px 6px;            /* 触摸目标做足, 不再是 42px 的小格子 */
  min-height: 84px;
  border-radius: 12px; cursor: pointer;
  background: var(--v2-surface-2, #1b2534);
  border: 1px solid var(--v2-border, #26344a);
  color: var(--v2-text-dim, #8fa3bd); font-size: 13px;
}
.v2-more-item.is-active { color: var(--v2-primary); border-color: var(--v2-primary); }

@media (max-width: 600px) {
  /* 手机竖屏: tools 收进「更多」, 底栏只剩 main(6) + 更多 = 7 个槽 -> 每个 55px, 达标 */
  .v2-nav-tool { display: none; }
  .v2-nav-more { display: flex; }

  .v2-shell {
    grid-template-columns: 1fr;
    /* nav 行不能写死 60px —— .v2-nav 实际高度是 60px + safe-area-inset-bottom (iOS 底部
       home indicator), 写死会把多出来的 safe-area 那截挤没, 底栏背景填不满到屏幕真正
       底边, 露出一条没样式的空白 (业主: "手机页面下方还有不少空间")。改 auto 让行高
       跟着 .v2-nav 自己算出来的高度走。 */
    grid-template-rows: 48px 1fr auto;
    grid-template-areas:
      'header'
      'main'
      'nav';
    /* 防底栏被键盘抬起遮挡 */
    height: 100vh;
    height: 100dvh;
    /* 真因找到了: 桌面版 .v2-shell 本来就有 padding-bottom: env(safe-area-inset-bottom)
       (给桌面/平板没有独立底栏时兜底安全区), 手机这里 .v2-nav 自己又用 height 单独
       算了一遍 safe-area —— 同一份安全区被算了两次: 一次是 shell 的 padding 把
       grid 内容区往上挤, 一次是 nav 自己再撑高, 两截叠在一起, 底栏下面露出比正常
       宽一倍还多的空白 (业主反馈: "下面留的距离也太大了, 微信留的距离是刚好的")。
       手机上 nav 是最后一行, 它自己的高度已经包含了安全区, shell 就不需要再单独
       留了, 归零。 */
    padding-bottom: 0;
  }
  /* 手机竖屏功能页: 同样去掉顶 header, 只剩 main + 底栏 */
  .v2-shell.lean {
    grid-template-rows: 1fr auto;
    grid-template-areas:
      'main'
      'nav';
  }

  /* 侧栏 → 底栏 */
  .v2-nav {
    grid-area: nav;
    grid-row: auto;
    flex-direction: row;
    align-items: stretch;
    padding: 4px 4px;
    border-top: 1px solid var(--v2-border-soft);
    border-right: none;
    background: rgba(10, 14, 26, 0.92);
    backdrop-filter: blur(8px);
    /* safe area 底部 (iOS home indicator) —— 封顶 34px, 不是随便挑的整数: 所有
       Face ID 机型 (iPhone X 到最新款) 的 Home 指示条手势区都固定是 34pt, 不随
       屏幕尺寸变 (这是 Apple HIG 写死的常量, 不是"最大约 34px 左右")。微信这类
       原生 app 用的就是这个精确值。
       2026-07-18 两轮迭代:
       第一轮封顶 40px, 图标行还是 60px —— 业主反馈跟微信比留白还是多一截。
       缩图标行到 49px (贴 iOS tabbar 标准高度) 后依然多一截, 说明问题不在图标行,
       在安全区这个数字本身: 40px 封顶只是防止"读到离谱大值", 没有把它锁到 WeChat
       真正用的 34px —— 如果 Chrome for iOS 汇报的 env() 落在 34-40px 之间(它是
       套壳 WebKit, 安全区计算跟 Safari 原生历史上就对不上), 40px 封顶完全不生效,
       比原生 app 多出来的几像素就是业主看到的那截。改封顶 34px 直接锁死这个数字。 */
    padding-bottom: max(4px, min(env(safe-area-inset-bottom), 34px));
    height: calc(49px + min(env(safe-area-inset-bottom), 34px));
  }

  /* logo 块挪走 — 手机底栏没空间 */
  .v2-nav-brand,
  .v2-nav-divider {
    display: none;
  }

  /* nav 项变水平 */
  .v2-nav-list {
    flex-direction: row;
    padding: 0;
    gap: 0;
    justify-content: space-around;
    width: 100%;
  }
  .v2-nav-item {
    width: auto;
    flex: 1 1 0;
    max-height: none;
    min-height: 0;
    height: 100%;
    border-radius: 8px;
    padding: 4px 2px;
    gap: 2px;
  }
  .v2-nav-item .lucide,
  .v2-nav-item svg { width: 22px !important; height: 22px !important; }
  .v2-nav-label {
    font-size: 10px;
    letter-spacing: 0;
  }

  /* 选中态光柱 — 从左边竖条挪到上沿横条 */
  .v2-nav-item.is-active::before {
    left: 50%;
    top: -4px;
    bottom: auto;
    transform: translateX(-50%);
    width: 32px;
    height: 4px;
    background: linear-gradient(90deg,
      transparent,
      var(--v2-primary) 30%,
      var(--v2-primary-hover) 50%,
      var(--v2-primary) 70%,
      transparent);
    border-radius: 4px 4px 0 0;
    box-shadow: 0 -2px 12px var(--v2-primary), 0 -2px 24px var(--v2-primary-soft);
  }

  /* header 极简: 只剩品牌 + 时钟 */
  .v2-header { padding: 0 12px; height: 48px; }
  .v2-brand-title { font-size: 14px; letter-spacing: 0.4px; }
  .v2-brand-sub { display: none; }
  .v2-header-spacer { display: none; }
  .v2-header-alert { display: none; }
  .v2-header-right .v2-pill { display: none; }
  .v2-clock {
    font-size: 16px;
    letter-spacing: 1px;
  }
  .v2-clock .sec { font-size: 11px; }

  /* main 减 padding */
  .v2-main {
    /* 避免主区被底栏挡 — grid 行布局已经预留, 这里不用 padding-bottom */
  }
}
</style>
