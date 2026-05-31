<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
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

const router = useRouter();

function patch(key: string, value: unknown): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

/** 单字段值, 缺时走默认 */
function valOf(p: ParamSpec): unknown {
  const v = props.modelValue[p.key];
  return v ?? p.default;
}

/** 媒体选择: 暂时跳 MediaPage pick 模式去, 业主选完手回来手填. 后续可改成模态弹层 */
function pickMedia(p: ParamSpec): void {
  // 简单跳法: 弹个提示让用户记住要回来粘 mediaId. 后续改成 modal 弹媒体库.
  router.push({ name: 'media' });
  // TODO Sprint-D2: 内嵌 MediaPickerDialog 组件直接弹层选, 不离开当前 dialog
  void p;
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

      <!-- 媒体挑选 (临时实现, 跳 MediaPage) -->
      <div v-else-if="p.widget === 'media-picker'" class="media-picker">
        <el-input-number
          :model-value="Number(valOf(p) ?? 0)"
          :min="1"
          :max="99999"
          :step="1"
          controls-position="right"
          style="flex: 1;"
          @update:model-value="(v: number | undefined) => patch(p.key, v)"
        />
        <el-button @click="pickMedia(p)">去媒体库</el-button>
        <span class="hint">填媒体的数字 ID. 后续会改成弹层挑选</span>
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
  gap: 8px;
  width: 100%;
}
.media-picker .hint {
  margin-left: 6px;
  font-size: 11px;
  color: var(--v2-text-3);
  flex-shrink: 0;
}

.help-row {
  margin-top: 4px;
  font-size: 12px;
  color: var(--v2-text-3);
  line-height: 1.5;
}
</style>
