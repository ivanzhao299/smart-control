<script setup lang="ts">
import { provide } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import StatusBar from '@/components/StatusBar.vue';
import AlertBanner from '@/components/AlertBanner.vue';
import ExecutionStatusBar from '@/components/ExecutionStatusBar.vue';
import FullscreenPrompt from '@/components/FullscreenPrompt.vue';
import { useFullscreen } from '@/composables/useFullscreen';

const route = useRoute();
const router = useRouter();

// 终端全屏 (Sprint-08 终端模式)
const fs = useFullscreen({ autoEnter: true });
provide('fullscreen', fs);

const tabs: Array<{ name: string; label: string; icon: string }> = [
  { name: 'dashboard', label: '首页', icon: '🏠' },
  { name: 'lighting', label: '灯光', icon: '💡' },
  { name: 'led', label: 'LED', icon: '🖥' },
  { name: 'audio', label: '音响', icon: '🔊' },
  { name: 'hvac', label: '空调', icon: '❄️' },
  { name: 'status', label: '状态', icon: '📡' },
  { name: 'admin-devices', label: '后台', icon: '⚙' },
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
          <span class="ico">{{ t.icon }}</span>
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
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 132px 1fr;
  overflow: hidden;
}
.side-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 12px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-soft);
  overflow-y: auto;
}
.nav-item {
  width: 100%;
  background: transparent;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px 6px;
  min-height: 84px;
  font-size: 16px;
}
.nav-item:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}
.nav-item.is-active {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-press) 100%);
  color: #fff;
  box-shadow: var(--shadow-button);
}
.nav-item .ico { font-size: 26px; line-height: 1; }
.nav-item .lbl { font-size: 14px; letter-spacing: 1px; }

.content {
  overflow: auto;
  padding: 20px 24px;
}

.page-enter-from, .page-leave-to { opacity: 0; transform: translateY(6px); }
.page-enter-active, .page-leave-active { transition: all 0.2s ease; }
</style>
