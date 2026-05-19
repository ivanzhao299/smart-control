<script setup lang="ts">
import { computed, type Component } from 'vue';

const props = defineProps<{
  code: string;
  name: string;
  /** Lucide 组件 (推荐) 或 emoji 字符串 (向后兼容) */
  icon: Component | string;
  active?: boolean;
  loading?: boolean;
  error?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{ (e: 'click', code: string): void }>();

const isStringIcon = computed(() => typeof props.icon === 'string');

const cls = computed(() => ({
  'is-active': props.active,
  'is-loading': props.loading,
  'is-error': props.error,
  'is-disabled': props.disabled,
}));

function onClick(): void {
  if (props.disabled || props.loading) return;
  emit('click', props.code);
}
</script>

<template>
  <button class="scene-btn" :class="cls" @click="onClick" :aria-busy="props.loading">
    <div class="ico-wrap">
      <component :is="icon" v-if="!isStringIcon" class="ico" :size="32" :stroke-width="1.75" />
      <span v-else class="ico-fallback">{{ icon }}</span>
    </div>

    <div class="text">
      <div class="name">{{ name }}</div>
      <div class="code">{{ code }}</div>
    </div>

    <div class="badge" v-if="active">
      <span class="dot" />
      运行中
    </div>
    <div class="badge badge-err" v-else-if="error">失败</div>
    <div class="spinner" v-if="loading"></div>
  </button>
</template>

<style scoped>
.scene-btn {
  position: relative;
  min-height: 188px;
  background:
    linear-gradient(180deg, rgba(59, 130, 246, 0.06) 0%, rgba(59, 130, 246, 0) 60%),
    linear-gradient(160deg, var(--bg-panel) 0%, var(--bg-panel-soft) 100%);
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  padding: 22px 24px;
  cursor: pointer;
  outline: none;
  transition: transform 0.14s ease, box-shadow 0.22s ease, border-color 0.18s ease, background 0.22s ease;
  overflow: hidden;
}
.scene-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 100% 0%, rgba(124, 58, 237, 0.10), transparent 55%);
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
}
.scene-btn:hover::before { opacity: 1; }
.scene-btn:active { transform: scale(0.985); }
.scene-btn:hover {
  border-color: rgba(99, 102, 241, 0.55);
  box-shadow: 0 14px 34px -8px rgba(59, 130, 246, 0.32);
  transform: translateY(-2px);
}
.scene-btn.is-active {
  background: linear-gradient(135deg, #3b82f6 0%, #6366f1 55%, #7c3aed 100%);
  border-color: transparent;
  box-shadow: 0 18px 42px -10px rgba(124, 58, 237, 0.55);
}
.scene-btn.is-active::before { opacity: 0; }
.scene-btn.is-error {
  border-color: rgba(239, 68, 68, 0.55);
  background: linear-gradient(160deg, rgba(239,68,68,0.14) 0%, var(--bg-panel) 100%);
}
.scene-btn.is-loading { opacity: 0.85; cursor: progress; }
.scene-btn.is-disabled { opacity: 0.5; cursor: not-allowed; }

.ico-wrap {
  width: 54px; height: 54px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.18) 0%, rgba(124, 58, 237, 0.18) 100%);
  border: 1px solid rgba(99, 102, 241, 0.22);
  color: #93c5fd;
}
.scene-btn.is-active .ico-wrap {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.28);
  color: #fff;
  backdrop-filter: blur(6px);
}
.ico { stroke: currentColor; }
.ico-fallback { font-size: 28px; line-height: 1; }

.text { width: 100%; }
.name { font-size: 24px; font-weight: 600; letter-spacing: 0.5px; }
.code {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 6px;
  letter-spacing: 2px;
  text-transform: lowercase;
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
}
.scene-btn.is-active .code { color: rgba(255, 255, 255, 0.72); }

.badge {
  position: absolute;
  top: 18px;
  right: 18px;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px 4px 8px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(16, 185, 129, 0.16);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
  letter-spacing: 1px;
}
.scene-btn.is-active .badge {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.28);
}
.badge .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 0 currentColor;
  animation: pulse 1.6s ease-out infinite;
}
.badge-err {
  background: rgba(239, 68, 68, 0.16);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.32);
}
.spinner {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 18px;
  height: 18px;
  border: 2.5px solid rgba(99, 102, 241, 0.25);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse {
  0%   { box-shadow: 0 0 0 0   currentColor; }
  70%  { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0   transparent; }
}
</style>
