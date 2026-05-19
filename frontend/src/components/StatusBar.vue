<script setup lang="ts">
import { computed, inject } from 'vue';
import { Maximize2, Minimize2 } from 'lucide-vue-next';
import BrandLogo from '@/components/BrandLogo.vue';
import { useSystemStore } from '@/stores/system';
import { useSceneStore } from '@/stores/scene';
import { useDeviceStore } from '@/stores/device';
import type { useFullscreen } from '@/composables/useFullscreen';

const sys = useSystemStore();
const sceneStore = useSceneStore();
const deviceStore = useDeviceStore();

// 由 MainLayout 注入 (admin 不注入则为 undefined)
const fs = inject<ReturnType<typeof useFullscreen> | null>('fullscreen', null);

const timeLabel = computed(() => {
  const d = new Date(sys.now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

const dateLabel = computed(() => {
  const d = new Date(sys.now);
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 周${days[d.getDay()]}`;
});

const activeScene = computed(() => {
  const code = sceneStore.activeSceneCode;
  if (!code) return '无场景运行';
  const found = sceneStore.scenes.find((s) => s.code === code);
  return found?.name ?? code;
});

const wsLabel = computed(() => {
  switch (sys.wsState) {
    case 'open': return { text: '在线', cls: 'is-success' };
    case 'connecting': return { text: '连接中', cls: 'is-warning' };
    case 'error': return { text: '错误', cls: 'is-error' };
    default: return { text: '离线', cls: 'is-error' };
  }
});

const alertSummary = computed(() => {
  if (sys.alerts.some((a) => a.level === 'error')) return { text: '报警', cls: 'is-error' };
  if (sys.alerts.some((a) => a.level === 'warning')) return { text: `警告 ${sys.alerts.length}`, cls: 'is-warning' };
  return { text: '正常', cls: 'is-success' };
});

const mockTag = computed(() => sys.info?.mockMode ?? true);
</script>

<template>
  <header class="status-bar">
    <div class="brand">
      <BrandLogo :size="44" />
      <div>
        <div class="title">展贸中心智能中控</div>
        <div class="sub">{{ dateLabel }}</div>
      </div>
    </div>

    <div class="metrics">
      <div class="metric">
        <div class="metric-label">当前场景</div>
        <div class="metric-value">{{ activeScene }}</div>
      </div>
      <div class="metric">
        <div class="metric-label">设备在线</div>
        <div class="metric-value">
          <span class="big">{{ deviceStore.onlineCount }}</span>
          <span class="dim">/ {{ deviceStore.totalCount }}</span>
        </div>
      </div>
      <div class="metric">
        <div class="metric-label">网络</div>
        <div class="metric-value">
          <span class="sc-pill" :class="wsLabel.cls">{{ wsLabel.text }}</span>
        </div>
      </div>
      <div class="metric">
        <div class="metric-label">报警</div>
        <div class="metric-value">
          <span class="sc-pill" :class="alertSummary.cls">{{ alertSummary.text }}</span>
        </div>
      </div>
    </div>

    <div class="right">
      <span v-if="mockTag" class="sc-pill is-info" title="MOCK_MODE=true: 当前使用模拟设备">模拟</span>
      <button
        v-if="fs && fs.isSupported.value && !fs.isStandalone.value"
        class="fs-toggle"
        :title="fs.isActive.value ? '退出全屏 (Esc)' : '进入终端模式 (全屏)'"
        @click="fs.toggle()"
      >
        <Minimize2 v-if="fs.isActive.value" :size="18" :stroke-width="2" />
        <Maximize2 v-else :size="18" :stroke-width="2" />
      </button>
      <div class="clock">{{ timeLabel }}</div>
    </div>
  </header>
</template>

<style scoped>
.status-bar {
  display: grid;
  grid-template-columns: 320px 1fr 220px;
  align-items: center;
  gap: 20px;
  padding: 14px 24px;
  background:
    linear-gradient(180deg, rgba(99, 102, 241, 0.05) 0%, transparent 70%),
    var(--bg-panel);
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
  backdrop-filter: blur(8px);
}
.brand { display: flex; align-items: center; gap: 14px; }
.title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.5px;
  background: linear-gradient(90deg, #f8fafc 0%, #cbd5e1 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.sub { font-size: 12px; color: var(--text-secondary); margin-top: 3px; letter-spacing: 1px; }

.metrics { display: flex; align-items: center; gap: 28px; justify-content: center; }
.metric { text-align: center; }
.metric-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; letter-spacing: 1px; }
.metric-value { font-size: 18px; font-weight: 600; min-width: 90px; }
.metric-value .big { font-size: 22px; color: var(--color-success); }
.metric-value .dim { color: var(--text-secondary); font-size: 14px; margin-left: 2px; }

.right {
  display: flex; align-items: center; gap: 12px; justify-content: flex-end;
}
.fs-toggle {
  width: 38px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-elevated); color: var(--text-primary);
  border: 1px solid var(--border-soft); border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.fs-toggle:hover {
  background: linear-gradient(135deg, #3b82f6, #7c3aed);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 8px 18px -6px rgba(99, 102, 241, 0.55);
}
.fs-toggle:active { transform: scale(0.95); }
.clock {
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 2px;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
}
</style>
