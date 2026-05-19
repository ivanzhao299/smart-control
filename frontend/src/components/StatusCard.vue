<script setup lang="ts">
import { computed, type Component } from 'vue';
import { ChevronRight } from 'lucide-vue-next';
import type { DeviceStatus } from '@/types/api';

const props = defineProps<{
  title: string;
  /** Lucide 组件 (推荐) 或 emoji 字符串 (向后兼容) */
  icon: Component | string;
  status: DeviceStatus;
  subtitle?: string;
  detail?: string;
  to?: string;
}>();

const emit = defineEmits<{ (e: 'go', to: string): void }>();

const isStringIcon = computed(() => typeof props.icon === 'string');

const cfg = computed(() => {
  switch (props.status) {
    case 'online': return { label: '在线', cls: 'is-success', accent: '#10b981' };
    case 'running': return { label: '运行中', cls: 'is-info', accent: '#3b82f6' };
    case 'reconnecting': return { label: '重连中', cls: 'is-warning', accent: '#f59e0b' };
    case 'error': return { label: '故障', cls: 'is-error', accent: '#ef4444' };
    case 'disabled': return { label: '已禁用', cls: 'is-default', accent: '#6b7280' };
    default: return { label: '离线', cls: 'is-error', accent: '#ef4444' };
  }
});

function onClick(): void {
  if (props.to) emit('go', props.to);
}
</script>

<template>
  <div
    class="status-card"
    :class="[cfg.cls, { clickable: !!to }]"
    :style="{ '--card-accent': cfg.accent } as Record<string, string>"
    @click="onClick"
  >
    <span class="accent-bar" />
    <div class="head">
      <div class="icon-wrap">
        <component :is="icon" v-if="!isStringIcon" :size="22" :stroke-width="1.75" />
        <span v-else class="icon-fallback">{{ icon }}</span>
      </div>
      <div class="title-col">
        <div class="title">{{ title }}</div>
        <div class="status-row">
          <span class="dot" />
          <span class="status-label">{{ cfg.label }}</span>
        </div>
      </div>
    </div>
    <div v-if="subtitle" class="subtitle">{{ subtitle }}</div>
    <div v-if="detail" class="detail">{{ detail }}</div>
    <div v-if="to" class="cta">
      进入控制 <ChevronRight :size="14" :stroke-width="2" />
    </div>
  </div>
</template>

<style scoped>
.status-card {
  position: relative;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--card-accent) 10%, transparent) 0%, transparent 65%),
    var(--bg-panel);
  border-radius: 16px;
  padding: 20px 20px 16px;
  border: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 162px;
  overflow: hidden;
  transition: transform 0.14s ease, border-color 0.2s ease, box-shadow 0.22s ease;
}
.accent-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--card-accent) 0%, transparent 90%);
}
.status-card.clickable { cursor: pointer; }
.status-card.clickable:hover {
  border-color: color-mix(in srgb, var(--card-accent) 55%, transparent);
  box-shadow: 0 12px 28px -10px color-mix(in srgb, var(--card-accent) 45%, transparent);
  transform: translateY(-2px);
}
.status-card.clickable:active { transform: scale(0.985); }

.head { display: flex; align-items: center; gap: 12px; }
.icon-wrap {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--card-accent) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--card-accent) 28%, transparent);
  color: var(--card-accent);
  flex-shrink: 0;
}
.icon-fallback { font-size: 22px; line-height: 1; }
.title-col { flex: 1; min-width: 0; }
.title { font-size: 16px; font-weight: 600; letter-spacing: 0.2px; }
.status-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--card-accent);
}
.dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--card-accent);
  box-shadow: 0 0 0 0 var(--card-accent);
  animation: card-pulse 1.8s ease-out infinite;
}
.status-card.is-default .dot { animation: none; }
@keyframes card-pulse {
  0%   { box-shadow: 0 0 0 0   var(--card-accent); }
  70%  { box-shadow: 0 0 0 7px transparent; }
  100% { box-shadow: 0 0 0 0   transparent; }
}

.subtitle { font-size: 13px; color: var(--text-secondary); }
.detail { font-size: 13px; color: var(--text-primary); }
.cta {
  margin-top: auto;
  align-self: flex-end;
  font-size: 12px;
  color: var(--color-primary);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  letter-spacing: 0.5px;
  opacity: 0.8;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.status-card.clickable:hover .cta { opacity: 1; transform: translateX(2px); }

.is-default {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}
</style>
