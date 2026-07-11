<script setup lang="ts">
import { ref } from 'vue';
import DeviceNetworkAdmin from './DeviceNetworkAdmin.vue';
import HardwareAdmin from './HardwareAdmin.vue';

/**
 * 硬件清单 (合并页) — 简化版 (业主反馈 2026-07-11: 后台简洁好用就行).
 *   设备网络 (默认): IoT 设备 IP 列表, 直接改 IP/端口, 保存立即生效
 *   设备登记: 完整硬件档案 CRUD (型号/位置/接线等运维信息)
 * 驱动模板 / 厂商品牌 从 tab 移除 (低频配置), 深链仍可进:
 *   /admin/drivers  /admin/brands
 */
const tab = ref<'network' | 'units'>('network');
</script>

<template>
  <div class="hub">
    <el-tabs v-model="tab" class="hub-tabs">
      <el-tab-pane label="设备网络" name="network" lazy><DeviceNetworkAdmin /></el-tab-pane>
      <el-tab-pane label="设备登记" name="units" lazy><HardwareAdmin /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.hub { color: var(--v2-text-1); }
.hub-tabs :deep(.el-tabs__header) { margin: 0 0 4px; padding: 4px 8px 0; }
</style>
