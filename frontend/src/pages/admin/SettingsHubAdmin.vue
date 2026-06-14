<script setup lang="ts">
import { ref } from 'vue';
import SettingsAdmin from './SettingsAdmin.vue';
import SystemBrandingAdmin from './SystemBrandingAdmin.vue';

/**
 * 系统设置 (合并页) — 常规系统参数 + 品牌(logo/名称)收到一处, 顶部 tab 切换:
 *   常规设置 / 系统品牌
 * 品牌算系统设置的子项, 合一减一个入口. lazy 延迟挂载.
 */
const tab = ref<'general' | 'brand'>('general');
</script>

<template>
  <div class="hub">
    <el-tabs v-model="tab" class="hub-tabs">
      <el-tab-pane label="常规设置" name="general" lazy><SettingsAdmin /></el-tab-pane>
      <el-tab-pane label="系统品牌" name="brand" lazy><SystemBrandingAdmin /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.hub { color: var(--v2-text-1); }
.hub-tabs :deep(.el-tabs__header) { margin: 0 0 4px; padding: 4px 8px 0; }
</style>
