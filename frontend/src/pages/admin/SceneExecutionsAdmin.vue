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
import { BarChart3, Filter, XCircle, Loader } from 'lucide-vue-next';

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

const statusCls: Record<ExecutionStatus, string> = {
  pending:        'is-warning',
  running:        'is-warning',
  success:        'is-on',
  partial_failed: 'is-warning',
  failed:         'is-error',
  cancelled:      'is-off',
};
const triggerOptions: Array<{ value: TriggerType; label: string }> = [
  { value: 'manual', label: '手动' },
  { value: 'schedule', label: '定时' },
  { value: 'system', label: '系统' },
];

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
    <header class="hero">
      <div class="hero-left">
        <div class="sc-head-ico"><BarChart3 :size="22" :stroke-width="1.75" /></div>
        <div>
          <h2 class="sc-title">执行记录</h2>
          <div class="sc-subtle">场景执行历史 · 实时进度 · 失败回溯</div>
        </div>
      </div>
      <div class="hero-right">
        <button class="sc-touch sc-act sc-act-neutral hero-btn" :disabled="loading" @click="refresh">
          <Loader v-if="loading" :size="16" class="spin" :stroke-width="2" />
          <Filter v-else :size="16" :stroke-width="2" />
          刷新
        </button>
      </div>
    </header>

    <div class="sc-panel filter-panel">
      <div class="section-title"><Filter :size="16" :stroke-width="1.75" /> 筛选</div>
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
          style="width: 360px;"
        />
        <button class="sc-touch sc-act sc-act-primary section-btn" @click="refresh">
          <Filter :size="14" :stroke-width="2" /> 查询
        </button>
        <button class="row-btn" @click="reset">重置</button>
      </div>
    </div>

    <el-table v-loading="loading" :data="rows" stripe size="default">
      <el-table-column prop="id" label="ID" width="64" />
      <el-table-column label="场景" min-width="200">
        <template #default="{ row }">
          <div>{{ row.sceneName }}</div>
          <code class="code-cell">{{ row.sceneCode }}</code>
        </template>
      </el-table-column>
      <el-table-column label="触发" width="150">
        <template #default="{ row }">
          <div>{{ triggerLabel(row.triggerType) }}</div>
          <div class="sub-mono">{{ row.triggerSource }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <span class="sc-status" :class="statusCls[row.status as ExecutionStatus]">
            <span class="sc-status-dot" /> {{ statusLabel(row.status) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="动作 (成功/失败/总)" width="170">
        <template #default="{ row }">
          <span class="ok">{{ row.successCount }}</span>
          <span class="sub-mono"> / </span>
          <span :class="row.failedCount > 0 ? 'fail' : 'sub-mono'">{{ row.failedCount }}</span>
          <span class="sub-mono"> / {{ row.totalActions }}</span>
        </template>
      </el-table-column>
      <el-table-column label="耗时" width="90">
        <template #default="{ row }"><span class="sub-mono">{{ formatDuration(row.durationMs) }}</span></template>
      </el-table-column>
      <el-table-column label="开始" width="170">
        <template #default="{ row }"><span class="sub-mono">{{ formatDate(row.startedAt) }}</span></template>
      </el-table-column>
      <el-table-column label="结束" width="170">
        <template #default="{ row }"><span class="sub-mono">{{ formatDate(row.finishedAt) }}</span></template>
      </el-table-column>
      <el-table-column label="摘要" min-width="160">
        <template #default="{ row }">
          <el-popover v-if="row.failedCount > 0" :width="520" trigger="hover" placement="left-start">
            <template #reference>
              <span class="sc-status is-warning" style="cursor:pointer;">
                <span class="sc-status-dot" /> 失败 {{ row.failedCount }}
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
          <span v-else class="sub-mono">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right" align="right">
        <template #default="{ row }">
          <button
            v-if="row.status === 'running' || row.status === 'pending'"
            class="row-btn row-btn-danger"
            :disabled="!perm.canExecute"
            @click="cancel(row)"
          >
            <XCircle :size="13" :stroke-width="2" /> 取消
          </button>
          <span v-else class="sub-mono">—</span>
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
.page { display: flex; flex-direction: column; gap: 16px; }
.hero { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.hero-left { display: flex; align-items: center; gap: 14px; }
.hero-right { display: flex; gap: 10px; }
.hero-btn { min-height: 42px; padding: 0 16px; }

.filter-panel { display: flex; flex-direction: column; gap: 10px; }
.section-title { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
.section-btn { min-height: 36px; padding: 0 14px; font-size: 13px; }
.filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

.code-cell {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-block;
  margin-top: 2px;
}
.sub-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; color: var(--text-secondary); }
.ok { color: #34d399; font-weight: 700; font-family: 'JetBrains Mono', ui-monospace, monospace; }
.fail { color: #f87171; font-weight: 700; font-family: 'JetBrains Mono', ui-monospace, monospace; }

.row-btn {
  background: var(--bg-elevated);
  color: var(--text-secondary);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 4px 10px;
  margin-left: 6px;
  cursor: pointer;
  font-size: 12px;
  display: inline-flex; align-items: center; gap: 4px;
  font-family: inherit;
  touch-action: manipulation;
  transition: all 0.15s;
}
.row-btn:hover:not(:disabled) { color: #c7d2fe; border-color: rgba(99, 102, 241, 0.5); }
.row-btn-danger:hover:not(:disabled) { color: #f87171; border-color: rgba(239, 68, 68, 0.5); }
.row-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.failures-pop { display: flex; flex-direction: column; gap: 10px; }
.failure-item { font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--border-soft); }
.failure-item:last-child { border-bottom: none; }
.failure-item code {
  background: var(--bg-elevated); padding: 1px 6px; border-radius: 4px;
  font-family: ui-monospace, monospace;
}
.failure-item .attempts { color: var(--text-secondary); margin-left: 6px; }
.failure-item .error { color: #f87171; margin-top: 4px; font-family: ui-monospace, monospace; }
.pager { display: flex; justify-content: flex-end; }

.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
