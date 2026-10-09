<script setup lang="ts">
/**
 * 欢迎页主标题 / 嘉宾行字号数字控件 (2026-10-09)。
 * 空 = 内置默认 (标题 180 / 嘉宾 96)；仅接受范围内整数，其余输入回退/忽略。
 * 从 PlayerConsole 抽出，避免主控制台组件继续膨胀。
 */
const props = defineProps<{
  titleSize: number | null;
  guestSize: number | null;
}>();
const emit = defineEmits<{
  'update:titleSize': [value: number | null];
  'update:guestSize': [value: number | null];
  changed: [];
}>();

function onInput(
  event: Event,
  key: 'title' | 'guest',
  min: number,
  max: number,
): void {
  const raw = (event.target as HTMLInputElement).value.trim();
  let next: number | null = null;
  if (raw !== '') {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= min && n <= max) next = n;
  }
  if (key === 'title') emit('update:titleSize', next);
  else emit('update:guestSize', next);
  emit('changed');
}
</script>

<template>
  <div class="wb-font-grid">
    <div class="wb-font-item">
      <label class="wb-label">主标题字号（空 = 默认 180）</label>
      <input type="number" class="wb-input" min="40" max="400" step="2" inputmode="numeric"
        :value="props.titleSize ?? ''" placeholder="180"
        @input="onInput($event, 'title', 40, 400)" />
    </div>
    <div class="wb-font-item">
      <label class="wb-label">嘉宾行字号（空 = 默认 96）</label>
      <input type="number" class="wb-input" min="24" max="240" step="2" inputmode="numeric"
        :value="props.guestSize ?? ''" placeholder="96"
        @input="onInput($event, 'guest', 24, 240)" />
    </div>
  </div>
</template>

<style scoped>
.wb-font-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.wb-font-item { min-width: 0; }
@media (max-width: 560px) { .wb-font-grid { grid-template-columns: 1fr; } }
.wb-label { font-size: 12px; color: var(--v2-text-3); margin-top: 6px; display: block; }
.wb-input {
  width: 100%; box-sizing: border-box;
  background: var(--v2-ov-1); border: 1px solid var(--v2-border-soft); border-radius: var(--v2-r-sm);
  padding: 10px 12px; color: var(--v2-text-1); font-size: 14px; outline: none; font-family: inherit;
}
.wb-input:focus { border-color: var(--v2-primary); }
</style>
