<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  adminExecutionService,
  adminSceneService,
  type ExecutionsQuery,
} from '@/services/admin.service';
import { usePermissionStore } from '@/stores/permission';
import type {
  ExecutionStatus,
  SceneExecutionRecord,
  SceneSummary,
  TriggerType,
} from '@/types/api';
import { useSceneStore } from '@/stores/scene';

const perm = usePermissionStore();
const sceneStore = useSceneStore();

const loading = ref(false);
const rows = ref<SceneExecutionRecord[]>([]);
const total = ref(0);
const sceneOptions = ref<SceneSummary[]>([]);
let autoTimer: number | undefined;

const filter = reactive<ExecutionsQuery>({
  sceneCode: '',
  status: undefined,
  triggerType: undefined,
  startTime: undefined,
  endTime: undefined,
  page: 1,
  pageSize: 50,
});

const dateRange = ref<[Date, Date] | null>(null);

const statusOptions: Array<{ value: ExecutionStatus; label: string; type: string }> = [
  { value: 'pending', label: '准备中', type: 'info' },
  { value: 'running', label: '执行中', type: 'primary' },
  { value: 'success', label: '成功', type: 'success' },
  { value: 'partial_failed', label: '部分失败', type: 'warning' },
  { value: 'failed', label: '失败', type: 'danger' },
  { value: 'cancelled', label: '已取消', type: 'info' },
];
const triggerOptions: Array<{ value: TriggerType; label: string }> = [
  { value: 'manual', label: '手动' },
  { value: 'schedule', label: '定时' },
  { value: 'system', label: '系统' },
];

function statusType(s: ExecutionStatus): string {
  return statusOptions.find((o) => o.value === s)?.type ?? 'info';
}
function statusLabel(s: ExecutionStatus): string {
  return statusOptions.find((o) => o.value === s)?.label ?? s;
}
function triggerLabel(t: TriggerType): string {
  return triggerOptions.find((o) => o.value === t)?.label ?? t;
}

function formatDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString();
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${min}m${sec}s`;
}

function parseSummary(s: string | null): { failures: Array<{ deviceType: string; deviceId: string; command: string; error: string; attempts: number }> } {
  if (!s) return { failures: [] };
  try {
    return JSON.parse(s);
  } catch {
    return { failures: [] };
  }
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    if (dateRange.value && dateRange.value.length === 2) {
      filter.startTime = dateRange.value[0].toISOString();
      filter.endTime = dateRange.value[1].toISOString();
    } else {
      filter.startTime = undefined;
      filter.endTime = undefined;
    }
    const r = await adminExecutionService.list({
      ...filter,
      sceneCode: filter.sceneCode || undefined,
    });
    rows.value = r.list;
    total.value = r.total;
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

function reset(): void {
  filter.sceneCode = '';
  filter.status = undefined;
  filter.triggerType = undefined;
  dateRange.value = null;
  filter.page = 1;
  void refresh();
}

function onPage(p: number): void {
  filter.page = p;
  void refresh();
}

async function cancel(row: SceneExecutionRecord): Promise<void> {
  if (!perm.canExecute) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await adminExecutionService.cancel(row.sceneCode);
    ElMessage.success(`已请求取消 ${row.sceneCode}`);
    setTimeout(refresh, 500);
  } catch (err) {
    ElMessage.error('取消失败: ' + (err as Error).message);
  }
}

onMounted(async () => {
  try {
    const list = await adminSceneService.list();
    sceneOptions.value = list.list;
  } catch {
    // ignore
  }
  await refresh();
  // 当有场景在执行时, 自动每 3 秒刷新
  autoTimer = window.setInterval(() => {
    if (sceneStore.isExecutionRunning || rows.value.some((r) => r.status === 'running' || r.status === 'pending')) {
      void refresh();
    }
  }, 3000);
});

onBeforeUnmount(() => {
  if (autoTimer) window.clearInterval(autoTimer);
});
</script>

<template>
  <section class="page">
    <header class="bar">
      <div class="filters">
        <el-select v-model="filter.sceneCode" placeholder="场景" clearable filterable style="width: 200px;">
          <el-option v-for="s in sceneOptions" :key="s.code" :label="`${s.name} (${s.code})`" :value="s.code" />
        </el-select>
        <el-select v-model="filter.status" placeholder="状态" clearable style="width: 140px;">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="filter.triggerType" placeholder="触发方式" clearable style="width: 130px;">
          <el-option v-for="o in triggerOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="datetimerange"
          range-separator="—"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          style="width: 380px;"
        />
        <el-button type="primary" @click="refresh">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
    </header>

    <el-table v-loading="loading" :data="rows" stripe size="small">
      <el-table-column prop="id" label="ID" width="64" />
      <el-table-column label="场景" min-width="180">
        <template #default="{ row }">
          <div class="scene-cell">
            <div class="scene-name">{{ row.sceneName }}</div>
            <code class="scene-code">{{ row.sceneCode }}</code>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="触发" width="140">
        <template #default="{ row }">
          <div>{{ triggerLabel(row.triggerType) }}</div>
          <div class="sc-subtle">{{ row.triggerSource }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="动作 (成功/失败/总)" width="160">
        <template #default="{ row }">
          <span class="ok">{{ row.successCount }}</span>
          /
          <span :class="row.failedCount > 0 ? 'fail' : ''">{{ row.failedCount }}</span>
          /
          <span class="total">{{ row.totalActions }}</span>
        </template>
      </el-table-column>
      <el-table-column label="耗时" width="100">
        <template #default="{ row }">{{ formatDuration(row.durationMs) }}</template>
      </el-table-column>
      <el-table-column label="开始时间" width="170">
        <template #default="{ row }">{{ formatDate(row.startedAt) }}</template>
      </el-table-column>
      <el-table-column label="结束时间" width="170">
        <template #default="{ row }">{{ formatDate(row.finishedAt) }}</template>
      </el-table-column>
      <el-table-column label="摘要" min-width="180">
        <template #default="{ row }">
          <el-popover v-if="row.failedCount > 0" :width="520" trigger="hover" placement="left-start">
            <template #reference>
              <span class="failures-trigger">
                <el-tag type="warning" size="small">失败 {{ row.failedCount }}</el-tag>
              </span>
            </template>
            <div class="failures-pop">
              <div v-for="(f, i) in parseSummary(row.resultSummary).failures" :key="i" class="failure-item">
                <code>{{ f.deviceType }}.{{ f.command }}</code>
                on <code>{{ f.deviceId }}</code>
                <span class="attempts">(尝试 {{ f.attempts }} 次)</span>
                <div class="error">{{ f.error }}</div>
              </div>
            </div>
          </el-popover>
          <span v-else class="sc-subtle">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'running' || row.status === 'pending'"
            size="small" link type="danger"
            :disabled="!perm.canExecute"
            @click="cancel(row)"
          >取消</el-button>
          <span v-else class="sc-subtle">—</span>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="pager"
      v-model:current-page="filter.page"
      :page-size="filter.pageSize"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="onPage"
    />
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.bar { display: flex; }
.filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.scene-cell { display: flex; flex-direction: column; }
.scene-name { font-weight: 600; }
.scene-code { font-size: 11px; color: var(--text-secondary); }
.ok { color: var(--color-success); font-weight: 600; }
.fail { color: var(--color-error); font-weight: 600; }
.total { color: var(--text-secondary); }
.failures-trigger { cursor: pointer; }
.failures-pop { display: flex; flex-direction: column; gap: 10px; }
.failure-item { font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--border-soft); }
.failure-item:last-child { border-bottom: none; }
.failure-item code {
  background: var(--bg-elevated); padding: 1px 6px; border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.failure-item .attempts { color: var(--text-secondary); margin-left: 6px; }
.failure-item .error { color: var(--color-error); margin-top: 4px; font-family: ui-monospace, SFMono-Regular, monospace; }
.pager { display: flex; justify-content: flex-end; }
</style>
