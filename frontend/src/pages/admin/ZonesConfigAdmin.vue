<script setup lang="ts">
import { ref } from 'vue';
import LightZonesAdmin from './LightZonesAdmin.vue';
import PowerCircuitsAdmin from './PowerCircuitsAdmin.vue';
import AudioConfigAdmin from './AudioConfigAdmin.vue';

/**
 * 分区配置 (合并页) — 三个同构的"子系统输出单元配置"收到一处, 顶部 tab 切换:
 *   灯光分区 / 电源回路 / 音响配置
 * 业主现场配各子系统的分区/通道在一个地方搞定. lazy 延迟挂载.
 */
const tab = ref<'light' | 'power' | 'audio'>('light');
</script>

<template>
  <div class="hub">
    <el-tabs v-model="tab" class="hub-tabs">
      <el-tab-pane label="灯光分区" name="light" lazy><LightZonesAdmin /></el-tab-pane>
      <el-tab-pane label="电源回路" name="power" lazy><PowerCircuitsAdmin /></el-tab-pane>
      <el-tab-pane label="音响配置" name="audio" lazy><AudioConfigAdmin /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.hub { color: var(--v2-text-1); }
.hub-tabs :deep(.el-tabs__header) { margin: 0 0 4px; padding: 4px 8px 0; }
</style>
