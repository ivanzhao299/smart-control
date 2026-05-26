<script setup lang="ts">
import { provide } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import StatusBar from '@/components/StatusBar.vue';
import AlertBanner from '@/components/AlertBanner.vue';
import ExecutionStatusBar from '@/components/ExecutionStatusBar.vue';
import FullscreenPrompt from '@/components/FullscreenPrompt.vue';
import { useFullscreen } from '@/composables/useFullscreen';
import { navIconFor } from '@/composables/useIcons';

const route = useRoute();
const router = useRouter();

// 终端全屏 (Sprint-08 终端模式)
const fs = useFullscreen({ autoEnter: true });
provide('fullscreen', fs);

const tabs: Array<{ name: string; label: string }> = [
  { name: 'dashboard', label: '首页' },
  { name: 'lighting', label: '灯光' },
  { name: 'led', label: 'LED' },
  { name: 'audio', label: '音响' },
  { name: 'hvac', label: '空调' },
  { name: 'media', label: '媒体' },
  { name: 'status', label: '状态' },
  { name: 'admin-devices', label: '后台' },
];

function go(name: string): void {
  if (route.name !== name) router.push({ name });
}
</script>

<template>
  <div class="layout">
    <StatusBar />
    <AlertBanner />
    <div class="body">
      <nav class="side-nav">
        <button
          v-for="t in tabs"
          :key="t.name"
          class="nav-item sc-touch"
          :class="{ 'is-active': route.name === t.name }"
          @click="go(t.name)"
        >
          <span class="ico">
            <component :is="navIconFor(t.name)" :size="20" :stroke-width="1.8" />
          </span>
          <span class="lbl">{{ t.label }}</span>
        </button>
      </nav>
      <main class="content">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
    <ExecutionStatusBar />
    <FullscreenPrompt
      :visible="fs.showPrompt.value"
      @enter="fs.enter()"
      @dismiss="fs.dismissPrompt()"
    />
  </div>
</template>

<style scoped>
.layout {
  width: 100vw;
  /* iPad Safari fix: 100vh 包含 Safari 底部 tab bar 区域, 会盖住内容
     用 dynamic viewport height (iOS 15.4+ / Safari 15.4+) */
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  /* Home Indicator / 安全区 */
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  box-sizing: border-box;
  /* 防止任意元素横向溢出 (StatusBar 380px 列 / 表格 / 卡片等) 引起左右滑 */
  overflow: hidden;
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 100px 1fr;
  overflow: hidden;
  min-height: 0; /* 防止子项 overflow 撑爆容器 */
}
@media (max-width: 1100px) { .body { grid-template-columns: 84px 1fr; } }
.side-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 6px;
  background:
    linear-gradient(180deg, rgba(99, 102, 241, 0.06) 0%, transparent 40%),
    var(--bg-panel);
  border-right: 1px solid var(--border-soft);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* iPad Safari: 给底部留空, 防止最后一个菜单项贴近 Home Indicator */
  padding-bottom: max(10px, env(safe-area-inset-bottom));
}
.nav-item {
  width: 100%;
  background: transparent;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 6px 4px;
  /* 8 主菜单 × 50px = 400px, 600-800px 平板全装下 */
  min-height: 50px;
  font-size: 12px;
  border-radius: 10px;
  position: relative;
  transition: background 0.18s ease, color 0.18s ease, transform 0.12s ease;
  flex-shrink: 0; /* 防 flex 容器压缩 */
}
.nav-item::before {
  content: '';
  position: absolute;
  left: -2px;
  top: 18%;
  bottom: 18%;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: linear-gradient(180deg, #3b82f6, #7c3aed);
  opacity: 0;
  transition: opacity 0.18s ease;
}
.nav-item:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}
.nav-item:active { transform: scale(0.96); }
.nav-item.is-active {
  background:
    linear-gradient(135deg, rgba(59, 130, 246, 0.18) 0%, rgba(124, 58, 237, 0.18) 100%);
  color: #c7d2fe;
  border: 1px solid rgba(99, 102, 241, 0.35);
  box-shadow: 0 8px 18px -8px rgba(99, 102, 241, 0.45);
}
.nav-item.is-active::before { opacity: 1; }
.nav-item .ico {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: transparent;
  flex-shrink: 0;
}
.nav-item.is-active .ico {
  background: rgba(255, 255, 255, 0.1);
}
.nav-item .lbl { font-size: 11px; letter-spacing: 0.5px; font-weight: 600; line-height: 1; }
/* 极小高 (≤ 600px) 只显图标省空间 */
@media (max-height: 600px) {
  .nav-item .lbl { display: none; }
  .nav-item { min-height: 44px; }
}

/* 默认 auto: 内容超了才出现滚动条; Dashboard 自己 overflow:hidden 锁死 */
.content {
  overflow-y: auto;
  overflow-x: hidden; /* 永远不允许左右滑 */
  padding: 12px 14px;
  min-width: 0;
  min-height: 0;
}
@media (max-width: 1100px) { .content { padding: 8px 10px; } }

.page-enter-from, .page-leave-to { opacity: 0; transform: translateY(6px); }
.page-enter-active, .page-leave-active { transition: all 0.2s ease; }
</style>
