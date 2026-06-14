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

// 按场景 code 分配独特霓虹色 (主色/辅色), 不在表里走默认蓝紫
const PALETTE: Record<string, { a: string; b: string; glow: string }> = {
  opening:        { a: '#ff8a00', b: '#ffd84d', glow: 'rgba(255, 138, 0, 0.45)' },     // 开馆 暖橙→金黄
  reception:      { a: '#5b8def', b: '#a855f7', glow: 'rgba(124, 58, 237, 0.45)' },    // 接待 蓝→紫
  meeting:        { a: '#10b981', b: '#06b6d4', glow: 'rgba(6, 182, 212, 0.45)' },     // 会议 翠绿→青
  roadshow:       { a: '#ec4899', b: '#f97316', glow: 'rgba(236, 72, 153, 0.45)' },    // 路演 粉→橙
  cleaning:       { a: '#22d3ee', b: '#0ea5e9', glow: 'rgba(34, 211, 238, 0.45)' },    // 清洁 青蓝
  closing:        { a: '#6366f1', b: '#1e293b', glow: 'rgba(99, 102, 241, 0.35)' },    // 闭馆 靛蓝→深
  sprint07_demo:  { a: '#64748b', b: '#94a3b8', glow: 'rgba(148, 163, 184, 0.3)' },   // 演示 灰
};
function paletteOf(code: string) {
  return PALETTE[code] ?? { a: '#3b82f6', b: '#7c3aed', glow: 'rgba(99, 102, 241, 0.4)' };
}

const palette = computed(() => paletteOf(props.code));

const cssVars = computed(() => ({
  '--scene-a': palette.value.a,
  '--scene-b': palette.value.b,
  '--scene-glow': palette.value.glow,
} as Record<string, string>));

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
  <button class="scene-btn" :class="cls" :style="cssVars" @click="onClick" :aria-busy="props.loading">
    <span class="ribbon" />
    <div class="ico-wrap">
      <component :is="icon" v-if="!isStringIcon" class="ico" :size="22" :stroke-width="2" />
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
  height: 110px;
  /* 用纯色 + 渐变模拟"玻璃质感", 不用 backdrop-filter (平板 GPU 不堪重负) */
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--scene-a) 18%, transparent) 0%, color-mix(in srgb, var(--scene-b) 12%, transparent) 100%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, transparent 70%),
    #1a2030;
  border: 1px solid color-mix(in srgb, var(--scene-a) 30%, rgba(99, 102, 241, 0.15));
  border-radius: 14px;
  color: var(--text-primary);
  display: grid;
  grid-template-columns: 48px 1fr;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  outline: none;
  transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 0.25s ease,
              border-color 0.2s ease;
  overflow: hidden;
  text-align: left;
}
/* 左侧装饰彩条 (像勋章带) */
.ribbon {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--scene-a) 0%, var(--scene-b) 100%);
  box-shadow: 0 0 10px var(--scene-glow);
  border-radius: 14px 0 0 14px;
  opacity: 0.85;
  transition: width 0.2s ease;
}
/* 右上角隐约的"光晕" */
.scene-btn::after {
  content: '';
  position: absolute;
  top: -40%;
  right: -10%;
  width: 60%;
  height: 140%;
  background: radial-gradient(ellipse at center, var(--scene-glow) 0%, transparent 65%);
  opacity: 0.45;
  pointer-events: none;
  transition: opacity 0.25s ease;
}

.scene-btn:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--scene-a) 55%, transparent);
  box-shadow:
    0 8px 16px -8px var(--scene-glow),
    0 0 0 1px color-mix(in srgb, var(--scene-a) 25%, transparent);
  z-index: 2; /* hover 时盖过相邻卡片, 避免阴影互相叠加视觉混乱 */
}
.scene-btn:hover::after { opacity: 0.7; }
.scene-btn:hover .ribbon { width: 4px; }

.scene-btn:active { transform: translateY(0) scale(0.98); }

.scene-btn.is-active {
  background:
    linear-gradient(135deg, var(--scene-a) 0%, var(--scene-b) 100%);
  border-color: color-mix(in srgb, var(--scene-a) 80%, white);
  box-shadow:
    0 10px 20px -8px var(--scene-glow),
    0 0 0 2px color-mix(in srgb, var(--scene-a) 60%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
  z-index: 2;
}
.scene-btn.is-active::after { opacity: 0; }
.scene-btn.is-active .ribbon { background: rgba(255, 255, 255, 0.6); box-shadow: 0 0 12px rgba(255, 255, 255, 0.5); }

.scene-btn.is-error {
  border-color: rgba(239, 68, 68, 0.55);
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.3);
}
.scene-btn.is-loading { opacity: 0.82; cursor: progress; }
.scene-btn.is-disabled { opacity: 0.45; cursor: not-allowed; }

.ico-wrap {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--scene-a) 30%, transparent) 0%, color-mix(in srgb, var(--scene-b) 20%, transparent) 100%);
  border: 1px solid color-mix(in srgb, var(--scene-a) 35%, transparent);
  color: #fff;
  box-shadow: 0 4px 12px -4px var(--scene-glow), inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
.scene-btn.is-active .ico-wrap {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.35);
  color: #fff;
}
.ico { stroke: currentColor; filter: drop-shadow(0 0 6px var(--scene-glow)); }
.scene-btn.is-active .ico { filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.5)); }
.ico-fallback { font-size: 22px; line-height: 1; }

.text { min-width: 0; }
.name {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.code {
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 3px;
  letter-spacing: 2px;
  text-transform: lowercase;
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scene-btn.is-active .code { color: rgba(255, 255, 255, 0.78); }

.badge {
  position: absolute;
  top: 10px;
  right: 12px;
  font-size: 10px;
  font-weight: 600;
  padding: 3px 8px 3px 7px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.4);
  letter-spacing: 1px;
}
.scene-btn.is-active .badge {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.35);
}
.badge .dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 5px currentColor;
  animation: pulse 1.6s ease-in-out infinite;
}
.badge-err {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.4);
}
.spinner {
  position: absolute;
  top: 12px;
  right: 14px;
  width: 16px;
  height: 16px;
  border: 2.5px solid color-mix(in srgb, var(--scene-a) 25%, transparent);
  border-top-color: var(--scene-a);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
/* opacity 呼吸 (GPU 合成) 替代 box-shadow 扩散环 — 后者每帧 CPU 全量重绘, 场景磁贴多实例时叠加成卡顿 */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}

/* 小屏 (10.1" 平板) 进一步收紧 */
@media (max-width: 1100px) {
  .scene-btn { height: 96px; padding: 10px 14px; gap: 10px; grid-template-columns: 42px 1fr; }
  .ico-wrap { width: 40px; height: 40px; }
  .name { font-size: 16px; }
}
</style>
