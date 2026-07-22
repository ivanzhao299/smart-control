<script setup lang="ts">
/**
 * 通用骨架屏 — 首屏/首次加载时先显占位, 替代空白或纯转圈, 减少"停顿感".
 * variant: table(表格行) / cards(卡片网格) / kpi(4 个指标块) / lines(几条文本)
 * 纯 CSS shimmer, 无依赖. 配合 keep-alive: 只首次访问显示, 缓存命中后直接出真内容.
 */
withDefaults(
  defineProps<{ variant?: 'table' | 'cards' | 'kpi' | 'lines'; rows?: number; cards?: number }>(),
  { variant: 'table', rows: 6, cards: 6 },
);
</script>

<template>
  <div class="sk" aria-busy="true" aria-label="加载中">
    <template v-if="variant === 'kpi'">
      <div class="sk-kpi-row">
        <div v-for="i in 4" :key="i" class="sk-block sk-kpi" />
      </div>
    </template>
    <template v-else-if="variant === 'cards'">
      <div class="sk-card-grid">
        <div v-for="i in cards" :key="i" class="sk-block sk-card" />
      </div>
    </template>
    <template v-else-if="variant === 'lines'">
      <div v-for="i in rows" :key="i" class="sk-block sk-line" :style="{ width: 92 - i * 6 + '%' }" />
    </template>
    <template v-else>
      <div class="sk-block sk-row sk-head" />
      <div v-for="i in rows" :key="i" class="sk-block sk-row" />
    </template>
  </div>
</template>

<style scoped>
.sk { width: 100%; }
.sk-block {
  position: relative;
  overflow: hidden;
  background: var(--v2-ov-1);
  border: 1px solid var(--v2-border-soft, rgba(255, 255, 255, 0.08));
  border-radius: 10px;
}
.sk-block::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.07), transparent);
  animation: sk-shimmer 1.25s infinite;
}
@keyframes sk-shimmer { 100% { transform: translateX(100%); } }
.sk-row { height: 46px; margin-bottom: 8px; }
.sk-head { height: 40px; opacity: 0.65; }
.sk-line { height: 14px; margin-bottom: 12px; border-radius: 7px; }
.sk-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.sk-kpi { height: 92px; }
.sk-card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.sk-card { height: 120px; }
@media (max-width: 700px) {
  .sk-kpi-row { grid-template-columns: repeat(2, 1fr); }
  .sk-card-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .sk-block::after { animation: none; } }
</style>
