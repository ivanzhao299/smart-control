<script setup lang="ts">
import { ref } from 'vue';
import SettingsAdmin from './SettingsAdmin.vue';
import SystemBrandingAdmin from './SystemBrandingAdmin.vue';
import AppReleaseAdmin from './AppReleaseAdmin.vue';

/**
 * 系统设置 (合并页) — 常规系统参数 + 品牌(logo/名称) + APP 版本, 顶部 tab 切换:
 *   常规设置 / 系统品牌 / APP 版本
 * 三个都是系统级配置, 合一减入口 (APP版本 跟系统设置原来都用齿轮图标, 重复). lazy 挂载.
 */
const tab = ref<'general' | 'brand' | 'app'>('general');
</script>

<template>
  <div class="hub">
    <el-tabs v-model="tab" class="hub-tabs">
      <el-tab-pane label="常规设置" name="general" lazy><SettingsAdmin /></el-tab-pane>
      <el-tab-pane label="系统品牌" name="brand" lazy><SystemBrandingAdmin /></el-tab-pane>
      <el-tab-pane label="APP 版本" name="app" lazy><AppReleaseAdmin /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.hub { color: var(--v2-text-1); }
.hub-tabs :deep(.el-tabs__header) { margin: 0 0 4px; padding: 4px 8px 0; }
</style>
