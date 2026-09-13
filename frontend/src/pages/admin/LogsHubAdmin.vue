<script setup lang="ts">
import { ref } from 'vue';
import LogsAdmin from './LogsAdmin.vue';
import SceneExecutionsAdmin from './SceneExecutionsAdmin.vue';
import AuditAdmin from './AuditAdmin.vue';

/**
 * 日志中心 (合并页) — 把三个只读历史流收到一处, 顶部 tab 切换:
 *   操作日志 / 场景执行记录 / 配置变更历史
 * 三个子页各自独立取数, 用 lazy 延迟挂载, 只在首次点开那个 tab 才请求.
 */
const tab = ref<'logs' | 'exec' | 'audit'>('logs');
</script>

<template>
  <div class="hub">
    <el-tabs v-model="tab" class="hub-tabs">
      <el-tab-pane label="操作日志" name="logs" lazy><LogsAdmin /></el-tab-pane>
      <el-tab-pane label="场景执行" name="exec" lazy><SceneExecutionsAdmin /></el-tab-pane>
      <el-tab-pane label="变更历史" name="audit" lazy><AuditAdmin /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.hub { color: var(--v2-text-1); }
.hub-tabs :deep(.el-tabs__header) { margin: 0 0 4px; padding: 4px 8px 0; }
</style>
