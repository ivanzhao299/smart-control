<script setup lang="ts">
import { computed } from 'vue';
import { useSceneStore } from '@/stores/scene';

const sceneStore = useSceneStore();

interface StatusBucket {
  text: string;
  cls: string;
  icon: string;
}

const STATUS_MAP: Record<string, StatusBucket> = {
  pending:        { text: '准备中',   cls: 'is-pending',   icon: '⏳' },
  running:        { text: '执行中',   cls: 'is-running',   icon: '▶' },
  success:        { text: '执行成功', cls: 'is-success',   icon: '✓' },
  partial_failed: { text: '部分失败', cls: 'is-warning',   icon: '⚠' },
  failed:         { text: '执行失败', cls: 'is-error',     icon: '✖' },
  cancelled:      { text: '已取消',   cls: 'is-cancelled', icon: '⊘' },
};

const ae = computed(() => sceneStore.activeExecution);

const triggerLabel: Record<string, string> = {
  manual: '手动',
  schedule: '定时',
  system: '系统',
};

const bucket = computed<StatusBucket>(() => {
  if (!ae.value) return { text: '空闲', cls: 'is-idle', icon: '·' };
  return STATUS_MAP[ae.value.status] ?? { text: ae.value.status, cls: 'is-idle', icon: '·' };
});

const progressPercent = computed(() => {
  if (!ae.value || ae.value.totalActions === 0) return 0;
  const done = ae.value.successCount + ae.value.failedCount;
  return Math.round((done / ae.value.totalActions) * 100);
});

const finishedRecently = computed(() => {
  if (!ae.value) return false;
  return ['success', 'partial_failed', 'failed', 'cancelled'].includes(ae.value.status);
});

const durationLabel = computed(() => {
  if (!ae.value || !ae.value.durationMs) return '';
  const ms = ae.value.durationMs;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
});
</script>

<template>
  <transition name="slide-up">
    <div v-if="ae" class="exec-bar" :class="bucket.cls">
      <div class="row">
        <div class="left">
          <span class="icon">{{ bucket.icon }}</span>
          <span class="scene">{{ ae.sceneName }}</span>
          <span class="sc-pill" :class="bucket.cls">{{ bucket.text }}</span>
          <span class="trigger">{{ triggerLabel[ae.triggerType] ?? ae.triggerType }} · {{ ae.triggerSource }}</span>
        </div>
        <div class="right">
          <span class="counts">
            <strong class="ok">{{ ae.successCount }}</strong>
            <span class="sep">/</span>
            <span class="total">{{ ae.totalActions }}</span>
            <span v-if="ae.failedCount > 0" class="failed">失败 {{ ae.failedCount }}</span>
          </span>
          <span v-if="durationLabel" class="duration">耗时 {{ durationLabel }}</span>
        </div>
      </div>
      <div v-if="ae.status === 'running' || ae.status === 'pending'" class="progress">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }" />
      </div>
      <div v-if="ae.step" class="step">{{ ae.step }}</div>
      <div v-if="finishedRecently && ae.failedCount > 0" class="hint">
        ⚠ 有 {{ ae.failedCount }} 个动作失败，详见 后台 → 场景执行记录
      </div>
    </div>
  </transition>
</template>

<style scoped>
.exec-bar {
  position: fixed;
  left: 18px;
  right: 18px;
  bottom: 18px;
  z-index: 50;
  padding: 12px 18px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(31, 41, 55, 0.94), rgba(17, 24, 39, 0.94));
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--border-soft);
  color: var(--text-primary);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
}
.exec-bar.is-running { border-color: var(--color-primary); }
.exec-bar.is-success { border-color: var(--color-success); }
.exec-bar.is-warning { border-color: var(--color-warning); }
.exec-bar.is-error { border-color: var(--color-error); }
.exec-bar.is-cancelled { border-color: var(--text-secondary); }

.row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.left { display: flex; align-items: center; gap: 12px; flex: 1; }
.right { display: flex; align-items: center; gap: 16px; color: var(--text-secondary); font-size: 13px; }
.icon { font-size: 20px; min-width: 22px; text-align: center; }
.scene { font-size: 18px; font-weight: 600; }
.trigger { font-size: 12px; color: var(--text-secondary); }
.counts { font-variant-numeric: tabular-nums; }
.counts .ok { color: var(--color-success); font-size: 16px; }
.counts .total { color: var(--text-secondary); margin-left: 2px; }
.counts .sep { color: var(--text-secondary); margin: 0 2px; }
.counts .failed { color: var(--color-error); margin-left: 10px; }
.duration { font-size: 12px; }

.progress {
  height: 4px;
  background: var(--bg-elevated);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 10px;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-success));
  transition: width 0.4s ease;
}
.step {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint { font-size: 12px; color: var(--color-warning); margin-top: 6px; }

.is-pending { color: var(--text-primary); }
.is-success { color: var(--color-success); background: rgba(16, 185, 129, 0.12); }
.is-warning { color: var(--color-warning); background: rgba(245, 158, 11, 0.12); }
.is-error { color: var(--color-error); background: rgba(239, 68, 68, 0.12); }
.is-cancelled { color: var(--text-secondary); background: var(--bg-elevated); }

.slide-up-enter-from, .slide-up-leave-to { opacity: 0; transform: translateY(20px); }
.slide-up-enter-active, .slide-up-leave-active { transition: all 0.25s ease; }
</style>
