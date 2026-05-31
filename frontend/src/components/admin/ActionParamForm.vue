<script setup lang="ts">
import { computed, ref } from 'vue';
import { Image as ImageIcon } from 'lucide-vue-next';
import MediaPickerDialog from './MediaPickerDialog.vue';
import type { CommandSpec, ParamSpec } from '@/services/scene-action-schema';

/**
 * 按 CommandSpec 渲染参数 widget 的智能 form.
 *
 * v-model:modelValue 是个扁平对象 (key → value), 跟 paramsFromForm 出来一样.
 * 把 schema 里每个 ParamSpec 渲染成对应 widget, 改了就 emit('update:modelValue', ...).
 *
 * widget 类型见 scene-action-schema.ts WidgetType.
 */

const props = defineProps<{
  modelValue: Record<string, unknown>;
  spec: CommandSpec;
}>();

const emit = defineEmits<{
  'update:modelValue': [v: Record<string, unknown>];
}>();

function patch(key: string, value: unknown): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

/** 单字段值, 缺时走默认 */
function valOf(p: ParamSpec): unknown {
  const v = props.modelValue[p.key];
  return v ?? p.default;
}

/** 当前正在挑媒体的字段 (用 dialog) */
const pickerOpen = ref(false);
const pickerForKey = ref<string>('');
const pickerCurrentId = ref<number | null>(null);
const pickedMediaName = ref<Record<string, string>>({}); // 记字段对应的文件名, 方便回显
function openMediaPicker(p: ParamSpec): void {
  pickerForKey.value = p.key;
  const v = props.modelValue[p.key];
  pickerCurrentId.value = typeof v === 'number' ? v : null;
  pickerOpen.value = true;
}
function onMediaPicked(item: { id: number; originalName: string }): void {
  patch(pickerForKey.value, item.id);
  pickedMediaName.value[pickerForKey.value] = item.originalName;
}

const items = computed(() => props.spec.params);
</script>

<template>
  <div v-if="items.length === 0" class="empty">
    <span class="empty-text">此命令无参数</span>
  </div>

  <el-form v-else label-position="top" class="param-form">
    <el-form-item
      v-for="p in items"
      :key="p.key"
      :label="`${p.label}${p.required ? ' *' : ''}`"
    >
      <!-- 滑条 -->
      <div v-if="p.widget === 'slider'" class="slider-row">
        <el-slider
          :model-value="Number(valOf(p) ?? 0)"
          :min="p.min ?? 0"
          :max="p.max ?? 100"
          :step="p.step ?? 1"
          show-stops
          @update:model-value="(v: number | number[]) => patch(p.key, v)"
        />
        <div class="slider-val">{{ valOf(p) ?? 0 }}{{ p.suffix ?? '' }}</div>
      </div>

      <!-- 数字 -->
      <el-input-number
        v-else-if="p.widget === 'number'"
        :model-value="Number(valOf(p) ?? p.default ?? 0)"
        :min="p.min"
        :max="p.max"
        :step="p.step ?? 1"
        controls-position="right"
        @update:model-value="(v: number | undefined) => patch(p.key, v)"
      />
      <span v-if="p.widget === 'number' && p.suffix" class="suffix-inline">{{ p.suffix }}</span>

      <!-- 静态枚举下拉 -->
      <el-select
        v-else-if="p.widget === 'select'"
        :model-value="valOf(p)"
        :placeholder="p.placeholder ?? '请选择'"
        style="width: 100%;"
        @update:model-value="(v: unknown) => patch(p.key, v)"
      >
        <el-option
          v-for="opt in p.options ?? []"
          :key="String(opt.value)"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>

      <!-- 开关 -->
      <el-switch
        v-else-if="p.widget === 'switch'"
        :model-value="Boolean(valOf(p) ?? false)"
        @update:model-value="(v: string | number | boolean) => patch(p.key, v)"
      />

      <!-- 自由文本 -->
      <el-input
        v-else-if="p.widget === 'text'"
        :model-value="String(valOf(p) ?? '')"
        :placeholder="p.placeholder ?? ''"
        @update:model-value="(v: string) => patch(p.key, v)"
      />

      <!-- 媒体挑选 — 弹层版 -->
      <div v-else-if="p.widget === 'media-picker'" class="media-picker">
        <div class="media-display">
          <ImageIcon :size="14" :stroke-width="2" class="media-ico" />
          <span v-if="valOf(p)" class="media-name">
            {{ pickedMediaName[p.key] || `媒体 #${valOf(p)}` }}
            <span class="media-id">#{{ valOf(p) }}</span>
          </span>
          <span v-else class="media-empty">(未选媒体)</span>
        </div>
        <el-button type="primary" @click="openMediaPicker(p)">
          {{ valOf(p) ? '换' : '选' }}媒体
        </el-button>
      </div>

      <!-- 场景挑选 -->
      <el-input
        v-else-if="p.widget === 'scene-picker'"
        :model-value="String(valOf(p) ?? '')"
        placeholder="scene_code, e.g. opening / lunch_break"
        @update:model-value="(v: string) => patch(p.key, v)"
      />

      <!-- 播控通道 1/2 -->
      <el-radio-group
        v-else-if="p.widget === 'playback-slot'"
        :model-value="Number(valOf(p) ?? 1)"
        @update:model-value="(v: string | number | boolean | undefined) => patch(p.key, Number(v ?? 1))"
      >
        <el-radio-button :value="1">📺 HDMI1 → LED 大屏</el-radio-button>
        <el-radio-button :value="2">📽 HDMI2 → 投影仪</el-radio-button>
      </el-radio-group>

      <!-- 兜底: 不认识的 widget 走文本 -->
      <el-input
        v-else
        :model-value="String(valOf(p) ?? '')"
        placeholder="(未识别的 widget, 走文本)"
        @update:model-value="(v: string) => patch(p.key, v)"
      />

      <div v-if="p.help" class="help-row">{{ p.help }}</div>
    </el-form-item>
  </el-form>

  <!-- 媒体挑选弹层 -->
  <MediaPickerDialog
    v-model="pickerOpen"
    :selected-id="pickerCurrentId"
    @picked="onMediaPicked"
  />
</template>

<style scoped>
.empty {
  padding: 12px 0;
  color: var(--v2-text-3);
  font-size: 13px;
}

.param-form {
  width: 100%;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.slider-row :deep(.el-slider) { flex: 1; }
.slider-val {
  min-width: 56px;
  text-align: right;
  font-family: 'Inter', monospace;
  font-variant-numeric: tabular-nums;
  color: var(--v2-primary-hover);
  font-weight: 500;
}

.suffix-inline {
  margin-left: 8px;
  color: var(--v2-text-3);
  font-size: 13px;
}

.media-picker {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.media-display {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--v2-border-soft);
  border-radius: 8px;
  font-size: 13px;
  min-height: 36px;
  overflow: hidden;
}
.media-ico { color: var(--v2-text-3); flex-shrink: 0; }
.media-name {
  color: var(--v2-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.media-id {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--v2-text-3);
  margin-left: 6px;
}
.media-empty {
  color: var(--v2-text-3);
  font-style: italic;
}

.help-row {
  margin-top: 4px;
  font-size: 12px;
  color: var(--v2-text-3);
  line-height: 1.5;
}
</style>
