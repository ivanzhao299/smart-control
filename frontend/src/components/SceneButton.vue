<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  code: string;
  name: string;
  icon: string;
  active?: boolean;
  loading?: boolean;
  error?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{ (e: 'click', code: string): void }>();

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
    <div class="ico">{{ icon }}</div>
    <div class="text">
      <div class="name">{{ name }}</div>
      <div class="code">{{ code }}</div>
    </div>
    <div class="badge" v-if="active">运行中</div>
    <div class="badge badge-err" v-else-if="error">失败</div>
    <div class="spinner" v-if="loading"></div>
  </button>
</template>

<style scoped>
.scene-btn {
  position: relative;
  min-height: 180px;
  background: linear-gradient(160deg, var(--bg-panel) 0%, var(--bg-panel-soft) 100%);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  padding: 22px 26px;
  cursor: pointer;
  outline: none;
  transition: transform 0.12s ease, box-shadow 0.18s ease, background 0.18s ease, border-color 0.18s ease;
}
.scene-btn:active {
  transform: scale(0.97);
}
.scene-btn:hover {
  border-color: var(--color-primary);
  box-shadow: 0 12px 32px rgba(37, 99, 235, 0.22);
}
.scene-btn.is-active {
  background: linear-gradient(160deg, var(--color-primary) 0%, var(--color-primary-press) 100%);
  border-color: var(--color-primary);
  box-shadow: var(--shadow-button);
}
.scene-btn.is-error {
  border-color: var(--color-error);
  background: linear-gradient(160deg, rgba(239,68,68,0.18) 0%, var(--bg-panel) 100%);
}
.scene-btn.is-loading { opacity: 0.85; cursor: progress; }
.scene-btn.is-disabled { opacity: 0.5; cursor: not-allowed; }

.ico { font-size: 46px; line-height: 1; }
.text { width: 100%; }
.name { font-size: 26px; font-weight: 600; }
.code { font-size: 12px; color: var(--text-secondary); margin-top: 4px; letter-spacing: 1px; }
.scene-btn.is-active .code { color: rgba(255, 255, 255, 0.65); }

.badge {
  position: absolute;
  top: 18px;
  right: 18px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.25);
  color: var(--color-success);
}
.scene-btn.is-active .badge {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.badge-err {
  background: rgba(239, 68, 68, 0.25);
  color: var(--color-error);
}
.spinner {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 18px;
  height: 18px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
