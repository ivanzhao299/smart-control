<script setup lang="ts">
import { ref } from 'vue';
import HardwareAdmin from './HardwareAdmin.vue';
import DriversAdmin from './DriversAdmin.vue';
import BrandsAdmin from './BrandsAdmin.vue';

/**
 * 硬件清单 (合并页) — 把"硬件定义"层收到一处, 顶部 tab 切换:
 *   设备登记 (物理硬件) / 驱动模板 / 厂商品牌
 * 驱动模板 + 厂商品牌 原本是隐藏入口 (只能 URL 进), 收成 tab 给它们正经入口.
 */
const tab = ref<'units' | 'drivers' | 'brands'>('units');
</script>

<template>
  <div class="hub">
    <el-tabs v-model="tab" class="hub-tabs">
      <el-tab-pane label="设备登记" name="units" lazy><HardwareAdmin /></el-tab-pane>
      <el-tab-pane label="驱动模板" name="drivers" lazy><DriversAdmin /></el-tab-pane>
      <el-tab-pane label="厂商品牌" name="brands" lazy><BrandsAdmin /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.hub { color: var(--v2-text-1); }
.hub-tabs :deep(.el-tabs__header) { margin: 0 0 4px; padding: 4px 8px 0; }
</style>
