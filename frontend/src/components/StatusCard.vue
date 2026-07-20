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
    case 'online': return { label: '在线', cls: 'is-success', accent: '#3FBF87' };
    case 'running': return { label: '运行中', cls: 'is-info', accent: '#4C9AFF' };
    case 'reconnecting': return { label: '重连中', cls: 'is-warning', accent: '#E0A030' };
    case 'error': return { label: '故障', cls: 'is-error', accent: '#E5645D' };
    case 'disabled': return { label: '已禁用', cls: 'is-default', accent: '#6B7178' };
    default: return { label: '离线', cls: 'is-error', accent: '#E5645D' };
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
    <div class="icon-wrap">
      <component :is="icon" v-if="!isStringIcon" :size="20" :stroke-width="2" />
      <span v-else class="icon-fallback">{{ icon }}</span>
    </div>
    <div class="title-col">
      <div class="title">{{ title }}</div>
      <div class="status-row">
        <span class="dot" />
        <span class="status-label">{{ cfg.label }}</span>
        <span v-if="subtitle" class="sub-inline">· {{ subtitle }}</span>
      </div>
    </div>
    <ChevronRight v-if="to" class="cta-arrow" :size="16" :stroke-width="2" />
  </div>
</template>

<style scoped>
/* 紧凑横排版: 图标左 / 标题+状态+子标题右 / CTA 角落隐式 */
.status-card {
  position: relative;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--card-accent) 14%, transparent) 0%, transparent 70%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 50%),
    #1a2030;
  /* 删 backdrop-filter — 12 个卡片同时 blur GPU 撑不住, 用纯色替代 */
  border-radius: 12px;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--card-accent) 22%, rgba(255, 255, 255, 0.08));
  display: grid;
  grid-template-columns: 44px 1fr auto;
  align-items: center;
  gap: 12px;
  min-height: 76px;
  overflow: hidden;
  transition: transform 0.16s ease, border-color 0.2s ease, box-shadow 0.22s ease;
}
.accent-bar {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--card-accent) 0%, color-mix(in srgb, var(--card-accent) 40%, transparent) 100%);
  box-shadow: 0 0 10px color-mix(in srgb, var(--card-accent) 60%, transparent);
}
/* 右上 corner glow */
.status-card::after {
  content: '';
  position: absolute;
  top: -20%; right: -10%;
  width: 50%; height: 120%;
  background: radial-gradient(ellipse at center, color-mix(in srgb, var(--card-accent) 30%, transparent) 0%, transparent 65%);
  opacity: 0.4;
  pointer-events: none;
  transition: opacity 0.25s ease;
}
.status-card.clickable { cursor: pointer; }
.status-card.clickable:hover {
  border-color: color-mix(in srgb, var(--card-accent) 60%, transparent);
  box-shadow:
    0 6px 14px -8px color-mix(in srgb, var(--card-accent) 55%, transparent),
    0 0 0 1px color-mix(in srgb, var(--card-accent) 25%, transparent);
  transform: translateY(-1px);
  z-index: 2; /* 避免阴影叠加邻卡 */
}
.status-card.clickable:hover::after { opacity: 0.7; }
.status-card.clickable:active { transform: scale(0.98); }

.icon-wrap {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--card-accent) 25%, transparent) 0%, color-mix(in srgb, var(--card-accent) 12%, transparent) 100%);
  border: 1px solid color-mix(in srgb, var(--card-accent) 30%, transparent);
  color: var(--card-accent);
  flex-shrink: 0;
  box-shadow:
    0 4px 10px -3px color-mix(in srgb, var(--card-accent) 35%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.icon-fallback { font-size: 20px; line-height: 1; }
.title-col { min-width: 0; }
.title { font-size: 14px; font-weight: 600; letter-spacing: 0.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--card-accent);
}
.status-label { letter-spacing: 0.5px; }
.dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--card-accent);
  box-shadow: 0 0 6px var(--card-accent);
  animation: card-pulse 1.8s ease-in-out infinite;
}
.status-card.is-default .dot { animation: none; box-shadow: none; }
/* opacity 呼吸替代双层 box-shadow 扩散 — 状态卡多实例 (首页子系统条/状态页) 时这是主要重绘开销 */
@keyframes card-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

.sub-inline { color: var(--text-secondary); margin-left: 2px; }
.cta-arrow {
  color: var(--card-accent);
  opacity: 0.55;
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.status-card.clickable:hover .cta-arrow { opacity: 1; transform: translateX(3px); }

.is-default {
  background: rgba(30, 41, 59, 0.4);
  color: var(--text-secondary);
}
.is-default .icon-wrap { color: var(--text-secondary); }

@media (max-width: 1100px) {
  .status-card { padding: 8px 10px; gap: 8px; grid-template-columns: 36px 1fr auto; min-height: 64px; }
  .icon-wrap { width: 36px; height: 36px; border-radius: 8px; }
  .title { font-size: 13px; }
}
</style>
