<script setup lang="ts">
import { computed, provide } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Maximize2, Minimize2 } from 'lucide-vue-next';
import AlertBanner from '@/components/AlertBanner.vue';
import ExecutionStatusBar from '@/components/ExecutionStatusBar.vue';
import FullscreenPrompt from '@/components/FullscreenPrompt.vue';
import { useFullscreen } from '@/composables/useFullscreen';
import { navIconFor } from '@/composables/useIcons';
import { useSystemStore } from '@/stores/system';
import { useSceneStore } from '@/stores/scene';

const route = useRoute();
const router = useRouter();
const sys = useSystemStore();
const sceneStore = useSceneStore();

// 终端全屏 (Sprint-08 终端模式)
const fs = useFullscreen({ autoEnter: true });
provide('fullscreen', fs);

// v2 侧导航 - 只 icon (跟 mockup 一致), title 给 hover tooltip
const navItems: Array<{ name: string; label: string; section?: 'main' | 'tools' }> = [
  { name: 'dashboard', label: '首页', section: 'main' },
  { name: 'lighting', label: '灯光', section: 'main' },
  { name: 'led', label: 'LED 大屏', section: 'main' },
  { name: 'audio', label: '音响', section: 'main' },
  { name: 'hvac', label: '空调', section: 'main' },
  { name: 'media', label: '媒体', section: 'tools' },
  { name: 'status', label: '状态', section: 'tools' },
  { name: 'admin-devices', label: '后台', section: 'tools' },
];
const mainNavs = navItems.filter((n) => n.section === 'main');
const toolNavs = navItems.filter((n) => n.section === 'tools');

function go(name: string): void {
  if (route.name !== name) router.push({ name });
}

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

const alertPill = computed(() => {
  const errCount = sys.alerts.filter((a) => a.level === 'error').length;
  const warnCount = sys.alerts.filter((a) => a.level === 'warning').length;
  if (errCount > 0) return { text: `${errCount} 项报警`, cls: 'danger' };
  if (warnCount > 0) return { text: `${warnCount} 项警告`, cls: 'warn' };
  return { text: '无告警', cls: 'idle' };
});

const mockTag = computed(() => sys.info?.mockMode ?? false);
</script>

<template>
  <div class="v2-shell">

    <!-- 侧导航 (72px, icon-only, 顶到底) -->
    <aside class="v2-nav">
      <button
        v-for="item in mainNavs"
        :key="item.name"
        class="v2-nav-item"
        :class="{ 'is-active': route.name === item.name }"
        :title="item.label"
        @click="go(item.name)"
      >
        <component :is="navIconFor(item.name)" :size="22" :stroke-width="1.8" />
      </button>
      <div class="v2-nav-divider"></div>
      <button
        v-for="item in toolNavs"
        :key="item.name"
        class="v2-nav-item"
        :class="{ 'is-active': route.name === item.name }"
        :title="item.label"
        @click="go(item.name)"
      >
        <component :is="navIconFor(item.name)" :size="22" :stroke-width="1.8" />
      </button>
    </aside>

    <!-- 顶 Header (56px) -->
    <header class="v2-header">
      <div class="v2-brand">
        <div class="v2-logo">金</div>
        <div>
          <div class="v2-brand-title">金湖展贸中心 · 智能控制</div>
          <div class="v2-brand-sub">{{ dateLabel }}</div>
        </div>
      </div>
      <div class="v2-header-right">
        <span class="v2-pill" :class="{ idle: activeScene === '无运行' }">
          <span class="v2-dot"></span>
          当前场景: {{ activeScene }}
        </span>
        <span class="v2-pill" :class="wsPillCls">
          <span class="v2-dot"></span>{{ wsPillText }}
        </span>
        <span class="v2-pill" :class="alertPill.cls">
          <span class="v2-dot"></span>{{ alertPill.text }}
        </span>
        <span v-if="mockTag" class="v2-pill" style="background: rgba(59,130,246,.12); color: var(--v2-info); border-color: rgba(59,130,246,.3)">
          MOCK
        </span>
        <div class="v2-clock v2-inter">
          {{ clockHM }}<span class="sec">:{{ clockSec }}</span>
        </div>
        <button
          v-if="fs.isSupported.value && !fs.isStandalone.value"
          class="v2-fs-btn"
          :title="fs.isActive.value ? '退出全屏 (Esc)' : '进入终端模式 (全屏)'"
          @click="fs.toggle()"
        >
          <Minimize2 v-if="fs.isActive.value" :size="18" :stroke-width="1.8" />
          <Maximize2 v-else :size="18" :stroke-width="1.8" />
        </button>
      </div>
    </header>

    <!-- 主区 (顶部 alert + 路由出口) -->
    <main class="v2-main">
      <AlertBanner />
      <router-view v-slot="{ Component }">
        <keep-alive :max="6">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>

    <ExecutionStatusBar />
    <FullscreenPrompt
      :visible="fs.showPrompt.value"
      @enter="fs.enter()"
      @dismiss="fs.dismissPrompt()"
    />
  </div>
</template>

<style scoped>
.v2-shell {
  display: grid;
  grid-template-columns: 72px 1fr;
  grid-template-rows: 56px 1fr;
  grid-template-areas:
    "nav header"
    "nav main";
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  box-sizing: border-box;
  overflow: hidden;
}

/* ============ 侧导航 ============ */
.v2-nav {
  grid-area: nav;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--v2-sp-3) 0;
  gap: var(--v2-sp-2);
  border-right: 1px solid var(--v2-border-soft);
  background: rgba(10, 14, 26, 0.4);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.v2-nav-item {
  width: 48px;
  height: 48px;
  border-radius: var(--v2-r-md);
  display: grid;
  place-items: center;
  color: var(--v2-text-3);
  cursor: pointer;
  transition: all 0.18s ease;
  position: relative;
  background: transparent;
  border: none;
  padding: 0;
  flex-shrink: 0;
}
.v2-nav-item:hover {
  background: var(--v2-surf-1);
  color: var(--v2-text-1);
}
.v2-nav-item.is-active {
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
}
.v2-nav-item.is-active::before {
  content: '';
  position: absolute;
  left: -16px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 22px;
  background: var(--v2-primary);
  border-radius: 0 3px 3px 0;
  box-shadow: 0 0 8px var(--v2-primary);
}
.v2-nav-divider {
  width: 24px;
  height: 1px;
  background: var(--v2-border-soft);
  margin: var(--v2-sp-2) 0;
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
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.v2-brand {
  display: flex;
  align-items: center;
  gap: var(--v2-sp-3);
}
.v2-logo {
  width: 30px;
  height: 30px;
  border-radius: var(--v2-r-sm);
  background: linear-gradient(135deg, var(--v2-primary) 0%, var(--v2-info) 100%);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 14px;
  color: white;
  letter-spacing: 0;
}
.v2-brand-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--v2-text-1);
}
.v2-brand-sub {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-3);
  margin-top: 2px;
}
.v2-header-right {
  display: flex;
  align-items: center;
  gap: var(--v2-sp-4);
}
.v2-clock {
  font-size: 18px;
  font-weight: 500;
  color: var(--v2-text-1);
}
.v2-clock .sec {
  font-size: 12px;
  color: var(--v2-text-3);
  margin-left: 4px;
}
.v2-fs-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 0.18s ease;
}
.v2-fs-btn:hover {
  background: var(--v2-surf-1-hover);
  color: var(--v2-text-1);
}

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
  .v2-shell { grid-template-columns: 60px 1fr; }
  .v2-nav-item { width: 40px; height: 40px; }
  .v2-brand-title { font-size: 13px; }
  .v2-brand-sub { font-size: 10px; }
  .v2-header { padding: 0 var(--v2-sp-3); }
  .v2-header-right { gap: var(--v2-sp-3); }
}
@media (max-width: 720px) {
  .v2-pill { display: none; }
  .v2-pill.danger { display: inline-flex; }
}
</style>
