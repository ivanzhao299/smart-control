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
import { Activity, Maximize2, Minimize2, MoreHorizontal, Sun, Moon } from 'lucide-vue-next';
import { theme, toggleTheme } from '@/services/theme.service';
import ErrorBoundary from '@/components/ErrorBoundary.vue';
import ServerSettingsDialog from '@/components/ServerSettingsDialog.vue';
import { useFullscreen } from '@/composables/useFullscreen';
import { navIconFor } from '@/composables/useIcons';
import { getApiBaseURL, setConnectivityListener } from '@/services/http';
import { useConnectionStore } from '@/stores/connection';
import { useSystemStore } from '@/stores/system';
import { useSceneStore } from '@/stores/scene';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { useToastStore } from '@/stores/toast';
import {
  idleMainRouteNames,
  loadMainRoute,
  mainNavigationItems,
  mainRoutePrefetchApis,
} from '@/router/main-route-manifest';

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
 * 业主进入首页 800ms 后浏览器空闲, 按路由清单依次下载所有非首页可见页 chunk.
 * 之后切菜单是"打开缓存", 不再有 300ms 黑屏；新增页面不会再漏配预取项.
 * 不阻塞首屏渲染, 失败也无所谓 (路由懒加载兜底).
 */
function prefetchMainPages(): void {
  const tasks = idleMainRouteNames.map((name) => () => loadMainRoute(name));
  const runNext = () => {
    const t = tasks.shift();
    if (!t) return;
    t()?.catch(() => { /* 失败无所谓 */ }).finally(() => {
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

/**
 * iOS 橡皮筋锁死 (2026-07-25 业主: "向下滑动时顶部还是橡皮筋随动")。
 * CSS overscroll-behavior 对 iOS 的**内部滚动容器**支持不全, 只能 JS 拦:
 * 在 .v2-main 上, 已到顶还往下拉 / 已到底还往上推 → 直接吃掉手势。
 * 中间的正常滚动不拦 (passive:false 只在边界分支 preventDefault)。
 */
let mainEl: HTMLElement | null = null;
let touchStartY = 0;
let touchStartX = 0;
function onMainTouchStart(e: TouchEvent): void {
  touchStartY = e.touches[0].clientY;
  touchStartX = e.touches[0].clientX;
}
/** 触点到 .v2-main 之间有没有自己能滚的容器 (BGM 列表/矩阵横滑/空调网格…) */
function hasInnerScrollable(target: EventTarget | null, horizontal: boolean): boolean {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== mainEl) {
    const cs = getComputedStyle(el);
    if (!horizontal && (cs.overflowY === 'auto' || cs.overflowY === 'scroll')
        && el.scrollHeight > el.clientHeight + 1) return true;
    if (horizontal && (cs.overflowX === 'auto' || cs.overflowX === 'scroll')
        && el.scrollWidth > el.clientWidth + 1) return true;
    el = el.parentElement;
  }
  return false;
}
function onMainTouchMove(e: TouchEvent): void {
  if (!mainEl) return;
  const dy = e.touches[0].clientY - touchStartY;
  const dx = e.touches[0].clientX - touchStartX;
  // 2026-07-25 二次修正 (业主: "BGM 列表不能上下拖、矩阵不能左右拖"):
  // 初版把所有边界手势都吃掉, 连内部滚动容器一起锁死。放行规则:
  //  1) 横向手势一律放行 (矩阵/推子/横滑 tab 都靠它)
  //  2) 触点在自己能滚的内部容器里 → 放行, 滚动由它消化
  //  3) 只有滚动责任真落在 .v2-main 且已到边 → 吃掉 (这才是橡皮筋)
  if (Math.abs(dx) > Math.abs(dy)) return;
  if (hasInnerScrollable(e.target, false)) return;
  const atTop = mainEl.scrollTop <= 0;
  const atBottom = mainEl.scrollTop + mainEl.clientHeight >= mainEl.scrollHeight - 1;
  if ((atTop && dy > 0) || (atBottom && dy < 0)) e.preventDefault();
}

onMounted(() => {
  mainEl = document.querySelector('.v2-main');
  if (mainEl) {
    mainEl.addEventListener('touchstart', onMainTouchStart, { passive: true });
    mainEl.addEventListener('touchmove', onMainTouchMove, { passive: false });
  }
  prefetchMainPages();
  setTimeout(() => { void prefetchData(); }, 1200);
  // 连通性监听: 每个 API 请求结束都报告到 connection store
  setConnectivityListener(conn.report);
  // iOS 回前台快速探活 (2026-07-27, 见 onVisibleRecheck 注释)
  document.addEventListener('visibilitychange', onVisibleRecheck);
});
onUnmounted(() => {
  if (mainEl) {
    mainEl.removeEventListener('touchstart', onMainTouchStart);
    mainEl.removeEventListener('touchmove', onMainTouchMove);
  }
  setConnectivityListener(null);
  document.removeEventListener('visibilitychange', onVisibleRecheck);
});

/**
 * 服务器地址设置弹窗 — 两个入口:
 *   1. API 连续失败 (服务器 IP 变了/断网) → 自动弹出, 每次断线只弹一次,
 *      业主关掉后不再骚扰, 恢复在线后重新武装
 */
const showServerSettings = ref(false);
const serverSettingsReason = ref<string | undefined>(undefined);
let autoOpenedThisEpisode = false;
// A5 (2026-07-25): "已重连"胶囊闪现 1.6s
const justReconnected = ref(false);
let reconnT: number | undefined;
watch(() => conn.online, (ok, was) => {
  if (ok && was === false) {
    justReconnected.value = true;
    window.clearTimeout(reconnT);
    reconnT = window.setTimeout(() => { justReconnected.value = false; }, 1600);
  }
});

// 2026-07-27 加固 (业主: "PWA 频繁被踢回服务器设置页"): 掉线不再立刻弹弹窗 ——
// iPhone 息屏/切后台回来 Wi-Fi 重连的几秒里必然有请求失败, 立刻弹就是"被踢感"。
// 改为 8 秒后复核: 仍然离线才弹 (真换了服务器地址/真断网的场景不受影响,
// 顶部离线胶囊在这 8 秒里已经给了即时反馈)。
let offlineRecheckT: number | undefined;
watch(() => conn.online, (online) => {
  if (!online && !autoOpenedThisEpisode && !showServerSettings.value) {
    window.clearTimeout(offlineRecheckT);
    offlineRecheckT = window.setTimeout(() => {
      if (!conn.online && !autoOpenedThisEpisode && !showServerSettings.value) {
        autoOpenedThisEpisode = true;
        serverSettingsReason.value = '无法连接服务器 — 请确认服务器地址, 或从下方历史列表选择';
        showServerSettings.value = true;
      }
    }, 8000);
  }
  if (online) {
    window.clearTimeout(offlineRecheckT);
    autoOpenedThisEpisode = false;
  }
});

// iOS 回前台快速探活: PWA 被系统挂起后回来, 轮询要等下一 tick (最长 5s) 才知道
// 网络已恢复, 离线胶囊/弹窗判定会多挂几秒。回前台立刻打一枪公开健康端点,
// 成功即刻清零失败计数, 状态秒级归位。
function onVisibleRecheck(): void {
  if (document.hidden) return;
  // 用配置的 API base (可能跨端口 5173→3200), 相对路径在生产会打错源
  fetch(`${getApiBaseURL()}/system/health`, { cache: 'no-store' })
    .then((r) => { if (r.ok) conn.report(true); })
    .catch(() => { /* 失败交给正常判定链 */ });
}

/** hover/touch 时立刻 prefetch 对应路由 chunk — 比 click 早 ~200ms */
const prefetched = new Set<string>();
function prefetchRoute(name: string): void {
  if (prefetched.has(name)) return;
  const pending = name === 'admin-devices'
    ? import('@/layouts/AdminLayout.vue')
    : loadMainRoute(name);
  if (!pending) return;
  prefetched.add(name);
  pending.catch(() => { prefetched.delete(name); });
  // 同时 prefetch 该页用到的 API
  for (const url of mainRoutePrefetchApis(name)) fetch(url).catch(() => {});
}

// Auto-enter 全屏: 用户首次 click/touch/keydown 后自动 request fullscreen.
// 同时暴露 toggle/isActive 给顶栏全屏按钮 (业主反馈要手动按钮).
// 已在 PWA standalone 模式时跳过 autoEnter (浏览器本身已经全屏).
const fs = useFullscreen({ autoEnter: true });
const fsActive = fs.isActive;
const fsSupported = fs.isSupported;
function toggleFullscreen(): void { void fs.toggle(); }

// v2 侧导航 - 只 icon (跟 mockup 一致), title 给 hover tooltip
const navItems = [
  ...mainNavigationItems,
  { name: 'admin-devices', label: '后台', section: 'tools' as const },
];
const mainNavs = navItems.filter((n) => n.section === 'main');
const toolNavs = navItems.filter((n) => n.section === 'tools');
/**
 * 2026-07-27 业主: "平板打开页面时侧边栏按钮图标放不开, 去掉状态按钮、状态放到其他位置"。
 * 侧栏 (平板/主控机) 不再列「状态」—— 入口挪到首页顶栏右侧的心电图标按钮 (go('status'))。
 * 手机底栏的「更多」抽屉保留全量 toolNavs, 状态仍在里面。
 */
const sideToolNavs = toolNavs.filter((n) => n.name !== 'status');

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

/**
 * 「更多」抽屉图标专属色 (2026-07-27 业主: "色彩层次不够鲜明, 灰不拉几")。
 * 取 v3 体系色: 媒体=琥珀 / 状态=翠绿 / 后台=电光蓝 / 主题=晨紫。
 * 芯片 = 同色 14% tinted 底 + 全饱和描边图标, 深浅主题都吃得住。
 */
const MORE_CHIP_COLORS: Record<string, string> = {
  media: '#E0A030',
  status: '#3FBF87',
  'admin-devices': '#4C9AFF',
  theme: '#9D8BFF',
};
function moreChipStyle(name: string): Record<string, string> {
  const c = MORE_CHIP_COLORS[name] ?? '#4C9AFF';
  return {
    color: c,
    background: `color-mix(in srgb, ${c} 14%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 35%, transparent)`,
  };
}

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
        <div class="v2-logo" :class="{ 'has-img': branding.logoUrl }">
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
          v-for="item in sideToolNavs"
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
        <!-- 主题切换: 深色(展厅暗环境, 默认) ↔ 浅色。图标显示"切过去会变成什么" -->
        <button
          class="v2-nav-item v2-nav-tool"
          :title="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
          @click="toggleTheme()"
        >
          <component :is="theme === 'dark' ? Sun : Moon" :size="22" :stroke-width="1.8" />
          <span class="v2-nav-label">{{ theme === 'dark' ? '浅色' : '深色' }}</span>
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
            <!-- 2026-07-27 业主: "更多里的图标色彩层次不够鲜明, 灰不拉几" ——
                 每个入口给专属色相的图标芯片 (tinted 底 + 同色描边图标), 文字提亮 -->
            <button
              v-for="item in toolNavs"
              :key="item.name"
              class="v2-more-item"
              :class="{ 'is-active': route.name === item.name }"
              @click="goFromMore(item.name)"
            >
              <span class="more-ico" :style="moreChipStyle(item.name)">
                <component :is="navIconFor(item.name)" :size="24" :stroke-width="1.9" />
              </span>
              <span>{{ item.label }}</span>
            </button>
            <!-- 手机端也要能切主题 -->
            <button class="v2-more-item" @click="toggleTheme()">
              <span class="more-ico" :style="moreChipStyle('theme')">
                <component :is="theme === 'dark' ? Sun : Moon" :size="24" :stroke-width="1.9" />
              </span>
              <span>{{ theme === 'dark' ? '浅色' : '深色' }}</span>
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
        <span v-if="mockTag" class="v2-pill" style="background: rgba(76, 154, 255, .12); color: var(--v2-info); border-color: rgba(76, 154, 255, .3)">
          MOCK
        </span>
        <!-- 状态入口 (2026-07-27): 从侧栏挪来 — 侧栏图标挤不下, 状态属于"偶尔看"的
             工具页, 放首页顶栏右侧一个心电图标即可 -->
        <button class="v2-fs-btn" title="系统状态" @click="go('status')">
          <Activity :size="18" :stroke-width="2" />
        </button>
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
    <!-- A5 离线胶囊 (2026-07-25): 断网不再靠错误弹窗轰炸 — 顶部一条安静的胶囊,
         内容区打灰保留最后已知状态; 恢复自动消失并闪现"已重连"。 -->
    <transition name="v2-page">
      <div v-if="!conn.online" class="v2-net-capsule offline">
        <span class="dot"></span> 网络中断 · 重连中…
      </div>
      <div v-else-if="justReconnected" class="v2-net-capsule back">
        <span class="dot"></span> 已重连
      </div>
    </transition>
    <main class="v2-main" :class="{ 'v2-offline-dim': !conn.online }">
      <router-view v-slot="{ Component, route }">
        <!-- 崩溃自恢复: ErrorBoundary 包住所有页面, 单页报错降级不白屏整机 -->
        <ErrorBoundary>
          <!-- 页面切换轻过渡 (2026-09-24 丝滑优化): 早年用 mode="out-in" 在 iOS
               WKWebView 丢 transitionend 会永久停在"旧页已删、新页未挂"的空档,
               故一度整体移除过渡、变成硬切。现改为默认(无 mode)交叉淡入淡出并显式
               传 :duration —— Vue 到点即强制收尾, 不依赖 transitionend; 新页即时
               挂载不会白屏, 离开页 absolute 不顶布局。KeepAlive 继续保留相邻页状态。 -->
          <transition name="v2-route" :duration="190">
            <keep-alive :max="6">
              <component :is="Component" :key="route.name" />
            </keep-alive>
          </transition>
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
  background: var(--v2-chrome-bg);
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
  background: var(--v2-primary);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 18px;
  color: white;
  letter-spacing: 0;
  box-shadow: none;
  overflow: hidden;
}
/* 有自定义 logo 图时去掉写死的蓝渐变底与光晕, 图完整显示 */
.v2-nav-brand .v2-logo.has-img {
  background: transparent;
  box-shadow: none;
}
.v2-nav-brand .v2-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
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
.v2-nav-item.is-active {
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
}
.v2-nav-item.is-active::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 24px;
  background: var(--v2-primary);
  border-radius: 0 3px 3px 0;
}
.v2-nav-label {
  font-size: 13px;
  letter-spacing: 0.5px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.v2-nav-divider {
  width: 36px;
  height: 1px;
  background: var(--v2-border-soft);
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
  /* 顶栏是独立 grid cell, 内容只在 .v2-main 内滚动、不会从顶栏下方经过 ——
     backdrop-filter 透出的永远是固定底色, 模糊零视觉收益却在中低端机上常驻重算合成。
     改用近实色(同 AdminLayout/StatusCard 的去毛玻璃方案), 文字对比也更稳。(2026-09-15) */
  background: var(--v2-chrome-bg-solid);
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
  background: var(--v2-primary);
  display: grid;
  place-items: center;
  font-weight: 700;
  color: white;
  letter-spacing: 0;
}
.v2-brand-title {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: var(--v2-text-1);
  text-shadow: none;
}
:root[data-theme="light"] .v2-brand-title {
  color: var(--v2-text-1);
  text-shadow: none;
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
  color: var(--v2-danger);
  text-shadow: none;
}
.v2-inline-toast.is-warning {
  color: var(--v2-warning);
  text-shadow: none;
}
.v2-inline-toast.is-success {
  color: var(--v2-success);
  text-shadow: none;
}
.v2-inline-toast.is-info {
  color: var(--v2-info);
  text-shadow: none;
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
  border-color: rgba(76, 154, 255, 0.4);
}
.v2-fs-btn:active { transform: scale(0.94); }
.v2-clock {
  font-size: 22px;
  font-weight: 600;
  color: var(--v2-text-1);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 2px;
  text-shadow: var(--v2-text-glow-primary);
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
  text-shadow: none;
  font-weight: 500;
}
/* .v2-fs-btn 已删 — 全屏按钮 2026-05-31 去掉 */

/* ============ 主区 ============ */
.v2-main {
  grid-area: main;
  overflow-y: auto;
  overflow-x: hidden;
  /* 2026-07-26 业主: 全站去掉下拉橡皮筋回弹 —— 滚动到边界不再往外弹, 也不把
     回弹传给外层。配合各功能页"上下栏固定、只内容区滚"一起统一体验。 */
  overscroll-behavior: contain;
  min-width: 0;
  min-height: 0;
}

/* ============ 窄屏适配 ============ */
@media (max-width: 900px) {
  .v2-shell { grid-template-columns: 72px 1fr; }
  .v2-nav-item { width: 60px; min-height: 46px; }
  .v2-nav-label { font-size: 10px; }
  .v2-brand-title { font-size: 22px; }
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
  background: var(--v2-surf-1, #14161A);
  border-top: 1px solid var(--v2-border-soft, #23262C);
  border-radius: 18px 18px 0 0;
  /* 封顶 34px, 理由跟 .v2-nav 那处一致 (Chrome for iOS 的 env() 汇报值不可信) */
  padding: 10px 14px calc(14px + min(env(safe-area-inset-bottom), 34px));
}
.v2-more-grip {
  width: 40px; height: 4px; margin: 2px auto 12px;
  border-radius: 3px; background: #46566e;
}
/* 2026-07-27 业主: "手机端占两行, 改四个图标一行" —— 4 列单行, 格子相应收紧 */
.v2-more-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.v2-more-item {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 7px; padding: 12px 4px;
  min-height: 80px;                       /* 仍高于 44pt 触摸下限 */
  border-radius: 12px; cursor: pointer;
  background: var(--v2-surf-2, #1A1D22);
  border: 1px solid var(--v2-border-soft, #23262C);
  /* 2026-07-27 业主: 文字从 text-3 提到 text-1, 不再灰不拉几 */
  color: var(--v2-text-1, #E8EAED); font-size: 12px; font-weight: 500;
}
/* 图标芯片: 圆角方块, 颜色由 moreChipStyle 按入口注入 */
.more-ico {
  width: 38px; height: 38px; border-radius: 11px;
  display: grid; place-items: center;
}
.v2-more-item.is-active { border-color: var(--v2-primary); }
.v2-more-item.is-active .more-ico { filter: drop-shadow(0 0 8px currentColor); }

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
    background: var(--v2-chrome-bg-solid);
    /* 底栏背景已是 0.94 近实色且内容不会从其下方经过, blur 无视觉收益, 去掉以省手机端常驻 GPU */
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
  .v2-brand-title { font-size: 20px; letter-spacing: 0.6px; }
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

/* ---- A5 离线胶囊 ---- */
.v2-net-capsule {
  position: fixed; top: max(10px, env(safe-area-inset-top)); left: 50%;
  transform: translateX(-50%);
  z-index: 4000;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 16px; border-radius: 999px;
  font-size: 13px; font-weight: 500;
  backdrop-filter: blur(8px);
  border: 1px solid var(--v2-border-strong);
  box-shadow: var(--v2-elev-2);
}
.v2-net-capsule .dot { width: 8px; height: 8px; border-radius: 50%; }
.v2-net-capsule.offline { background: color-mix(in srgb, var(--v2-danger) 16%, var(--v2-surf-2)); color: var(--v2-text-1); }
.v2-net-capsule.offline .dot { background: var(--v2-danger); animation: hvPulseNet 1.1s ease-in-out infinite; }
.v2-net-capsule.back { background: color-mix(in srgb, var(--v2-success) 18%, var(--v2-surf-2)); color: var(--v2-text-1); }
.v2-net-capsule.back .dot { background: var(--v2-success); }
@keyframes hvPulseNet { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
/* 离线时内容区打灰: 数据是"最后已知", 不该看起来还新鲜 */
.v2-offline-dim { filter: grayscale(0.45) opacity(0.82); transition: filter var(--v2-dur-slow) ease; }
@media (prefers-reduced-motion: reduce) { .v2-net-capsule.offline .dot { animation: none; } }

/* 导航文字对比度 (2026-07-25 业主: APP 底栏文字太灰) — 未选中提到 text-2,
 * 选中用 primary 加粗; 深浅两主题同源变量, 自动跟随 */
.v2-nav-label { color: var(--v2-text-2); }
.v2-nav-item.is-active .v2-nav-label { color: var(--v2-primary); font-weight: 700; }
</style>
