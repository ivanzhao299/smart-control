<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useDeviceStore } from '@/stores/device';
import type { Device } from '@/types/api';

/**
 * 按 deviceType 把对应 category 的设备列成下拉, 用户选完得到 device.name (= deviceId).
 * 同时显示 "中文显示名 (内部 ID)", 业主一眼能认.
 *
 * 特殊 deviceType:
 *   - hvac-zone: deviceId 是 zone code 而不是 device.name. 从设备的 zone 字段去重列出.
 *   - playback:  不走设备库, 上层 ActionParamForm 的 playback-slot widget 处理.
 *   - power:     设备库可能没分类, 兜底允许手输.
 */

const props = defineProps<{
  modelValue: string;
  deviceType: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [v: string];
}>();

const deviceStore = useDeviceStore();

onMounted(() => {
  if (deviceStore.devices.length === 0) void deviceStore.fetchDevices();
});

/** 按 deviceType → 设备 category 映射 */
function categoriesFor(type: string): Device['category'][] {
  switch (type) {
    case 'lighting': return ['lighting'];
    case 'led':      return ['led'];
    case 'audio':    return ['audio'];
    case 'hvac':     return ['hvac'];
    case 'power':    return ['power'];
    default:         return [];
  }
}

/** 直选设备的选项 */
const deviceOptions = computed<Array<{ value: string; label: string }>>(() => {
  const cats = categoriesFor(props.deviceType);
  if (cats.length === 0) return [];
  return deviceStore.devices
    .filter((d) => cats.includes(d.category))
    .map((d) => ({
      value: d.name,
      label: `${friendlyName(d)} · ${d.name}`,
    }));
});

/** 按 zone 去重列出 (用于 hvac-zone) */
const zoneOptions = computed<Array<{ value: string; label: string }>>(() => {
  if (props.deviceType !== 'hvac-zone') return [];
  const seen = new Map<string, { floor?: string; count: number }>();
  for (const d of deviceStore.devices) {
    if (d.category !== 'hvac' || !d.zone) continue;
    const ex = seen.get(d.zone);
    if (ex) ex.count += 1;
    else seen.set(d.zone, { floor: d.floor ?? undefined, count: 1 });
  }
  return Array.from(seen.entries()).map(([zone, meta]) => ({
    value: zone,
    label: `${meta.floor ? meta.floor + ' / ' : ''}${zone} (${meta.count} 台)`,
  }));
});

/** 中文显示名 — 兼容老 zone 字段做友好名 */
function friendlyName(d: Device): string {
  // 优先 zone, 然后 floor, 然后 name
  const parts: string[] = [];
  if (d.floor) parts.push(d.floor);
  if (d.zone) parts.push(d.zone);
  if (parts.length === 0) parts.push(d.name);
  return parts.join(' / ');
}

const usingZones = computed(() => props.deviceType === 'hvac-zone');
const usingPlayback = computed(() => props.deviceType === 'playback');
const usingFreeText = computed(() => props.deviceType === 'power' || (!usingZones.value && !usingPlayback.value && deviceOptions.value.length === 0));

const options = computed(() => (usingZones.value ? zoneOptions.value : deviceOptions.value));
</script>

<template>
  <!-- playback 类型: 不显示 device 选择, 提示 playback-slot widget 处理 -->
  <div v-if="usingPlayback" class="hint-row">
    播控类型直接选通道, 下面的"通道"参数挑就行, 这里不需要填设备
  </div>

  <!-- 自由文本 (power 或 device list 拉不到) -->
  <el-input
    v-else-if="usingFreeText"
    :model-value="modelValue"
    placeholder="设备 ID, e.g. light_1f_main / power_socket_1"
    @update:model-value="(v: string) => emit('update:modelValue', v)"
  />

  <!-- 设备 / zone 下拉 -->
  <el-select
    v-else
    :model-value="modelValue"
    :placeholder="usingZones ? '选空调分区' : '选设备'"
    filterable
    style="width: 100%;"
    @update:model-value="(v: string) => emit('update:modelValue', v)"
  >
    <el-option
      v-for="opt in options"
      :key="opt.value"
      :label="opt.label"
      :value="opt.value"
    />
    <template v-if="options.length === 0" #empty>
      <div class="select-empty">没找到{{ usingZones ? '空调分区' : '该类设备' }}, 设备库可能没数据</div>
    </template>
  </el-select>
</template>

<style scoped>
.hint-row {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--v2-text-3);
  background: var(--v2-ov-1);
  border-radius: 6px;
}
.select-empty {
  padding: 10px;
  text-align: center;
  font-size: 12px;
  color: var(--v2-text-3);
}
</style>
