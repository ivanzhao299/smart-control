<script setup lang="ts">
import { computed } from 'vue';
import type { DeviceStatus } from '@/types/api';

const props = defineProps<{
  title: string;
  icon: string;
  status: DeviceStatus;
  subtitle?: string;
  detail?: string;
  to?: string;
}>();

const emit = defineEmits<{ (e: 'go', to: string): void }>();

const cfg = computed(() => {
  switch (props.status) {
    case 'online': return { label: '在线', cls: 'is-success' };
    case 'running': return { label: '运行中', cls: 'is-info' };
    case 'reconnecting': return { label: '重连中', cls: 'is-warning' };
    case 'error': return { label: '故障', cls: 'is-error' };
    case 'disabled': return { label: '已禁用', cls: 'is-default' };
    default: return { label: '离线', cls: 'is-error' };
  }
});

function onClick(): void {
  if (props.to) emit('go', props.to);
}
</script>

<template>
  <div class="status-card" :class="[cfg.cls, { clickable: !!to }]" @click="onClick">
    <div class="head">
      <div class="icon">{{ icon }}</div>
      <div class="title">{{ title }}</div>
      <span class="sc-pill" :class="cfg.cls">{{ cfg.label }}</span>
    </div>
    <div v-if="subtitle" class="subtitle">{{ subtitle }}</div>
    <div v-if="detail" class="detail">{{ detail }}</div>
    <div v-if="to" class="cta">进入控制 →</div>
  </div>
</template>

<style scoped>
.status-card {
  background: var(--bg-panel);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  border: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 150px;
  position: relative;
  transition: transform 0.12s ease, border-color 0.18s ease;
}
.status-card.clickable { cursor: pointer; }
.status-card.clickable:active { transform: scale(0.98); }
.status-card.clickable:hover { border-color: var(--color-primary); }

.head { display: flex; align-items: center; gap: 12px; }
.icon { font-size: 30px; }
.title { flex: 1; font-size: 18px; font-weight: 600; }

.subtitle { font-size: 13px; color: var(--text-secondary); }
.detail { font-size: 14px; color: var(--text-primary); }
.cta {
  margin-top: auto;
  align-self: flex-end;
  font-size: 13px;
  color: var(--color-primary);
}

.status-card.is-error { border-color: rgba(239, 68, 68, 0.6); }
.status-card.is-warning { border-color: rgba(245, 158, 11, 0.4); }
.is-default { background: var(--bg-elevated); color: var(--text-secondary); }
</style>
