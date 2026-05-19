<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { adminAlertService, type AlertsQuery } from '@/services/admin.service';
import { usePermissionStore } from '@/stores/permission';
import { wsClient } from '@/services/websocket.service';
import type { Alert, AlertLevel, AlertStatus, AlertSummary, WsEvent } from '@/types/api';

const perm = usePermissionStore();

const loading = ref(false);
const rows = ref<Alert[]>([]);
const total = ref(0);
const summary = ref<AlertSummary | null>(null);
let unsubscribeWs: (() => void) | null = null;

const filter = reactive<AlertsQuery>({
  level: undefined,
  status: 'active',
  sourceType: undefined,
  type: undefined,
  startTime: undefined,
  endTime: undefined,
  page: 1,
  pageSize: 50,
});

const dateRange = ref<[Date, Date] | null>(null);

const levelOptions: Array<{ value: AlertLevel; label: string; type: string }> = [
  { value: 'info', label: '提示', type: 'info' },
  { value: 'warning', label: '警告', type: 'warning' },
  { value: 'critical', label: '严重', type: 'danger' },
  { value: 'emergency', label: '紧急', type: 'danger' },
];

const statusOptions: Array<{ value: AlertStatus; label: string; type: string }> = [
  { value: 'active', label: '激活', type: 'danger' },
  { value: 'resolved', label: '已解除', type: 'success' },
  { value: 'ignored', label: '已忽略', type: 'info' },
];

const sourceTypeOptions = [
  { value: '', label: '全部' },
  { value: 'gateway', label: '设备网关' },
  { value: 'device', label: '设备' },
  { value: 'scene', label: '场景' },
  { value: 'scheduler', label: '定时任务' },
  { value: 'system', label: '系统' },
];

function levelType(l: AlertLevel): string {
  return levelOptions.find((o) => o.value === l)?.type ?? 'info';
}
function levelLabel(l: AlertLevel): string {
  return levelOptions.find((o) => o.value === l)?.label ?? l;
}
function statusType(s: AlertStatus): string {
  return statusOptions.find((o) => o.value === s)?.type ?? 'info';
}
function statusLabel(s: AlertStatus): string {
  return statusOptions.find((o) => o.value === s)?.label ?? s;
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
    const [list, sum] = await Promise.all([
      adminAlertService.list({
        ...filter,
        sourceType: filter.sourceType || undefined,
      }),
      adminAlertService.summary(),
    ]);
    rows.value = list.list;
    total.value = list.total;
    summary.value = sum;
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

function reset(): void {
  filter.level = undefined;
  filter.status = 'active';
  filter.sourceType = undefined;
  filter.type = undefined;
  dateRange.value = null;
  filter.page = 1;
  void refresh();
}

function onPage(p: number): void {
  filter.page = p;
  void refresh();
}

async function resolve(row: Alert): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await ElMessageBox.confirm(`确认解除报警「${row.title}」?`, '解除确认', { type: 'warning' });
  } catch { return; }
  try {
    await adminAlertService.resolve(row.id, perm.role);
    ElMessage.success('已解除');
    await refresh();
  } catch (err) {
    ElMessage.error('解除失败: ' + (err as Error).message);
  }
}

async function ignore(row: Alert): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await ElMessageBox.confirm(`确认忽略报警「${row.title}」?`, '忽略确认', { type: 'warning' });
  } catch { return; }
  try {
    await adminAlertService.ignore(row.id, perm.role);
    ElMessage.success('已忽略');
    await refresh();
  } catch (err) {
    ElMessage.error('忽略失败: ' + (err as Error).message);
  }
}

function formatDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString();
}

function handleWs(event: WsEvent): void {
  if (event.type === 'alert_created' || event.type === 'alert_resolved') {
    void refresh();
  }
}

onMounted(() => {
  void refresh();
  unsubscribeWs = wsClient.on(handleWs);
});

onBeforeUnmount(() => {
  if (unsubscribeWs) unsubscribeWs();
});
</script>

<template>
  <section class="page">
    <!-- 顶部统计 -->
    <div class="summary-row" v-if="summary">
      <div class="card-stat" :class="summary.active > 0 ? 'is-danger' : 'is-ok'">
        <div class="num">{{ summary.active }}</div>
        <div class="lbl">当前激活</div>
      </div>
      <div class="card-stat is-danger" v-if="summary.byLevel.critical + summary.byLevel.emergency > 0">
        <div class="num">{{ summary.byLevel.critical + summary.byLevel.emergency }}</div>
        <div class="lbl">严重/紧急</div>
      </div>
      <div class="card-stat is-warning">
        <div class="num">{{ summary.byLevel.warning }}</div>
        <div class="lbl">警告</div>
      </div>
      <div class="card-stat is-info">
        <div class="num">{{ summary.byLevel.info }}</div>
        <div class="lbl">提示</div>
      </div>
      <div class="card-stat">
        <div class="num">{{ summary.last24h }}</div>
        <div class="lbl">最近 24h</div>
      </div>
    </div>

    <header class="bar">
      <div class="filters">
        <el-select v-model="filter.status" placeholder="状态" clearable style="width: 120px;">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="filter.level" placeholder="等级" clearable style="width: 120px;">
          <el-option v-for="o in levelOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="filter.sourceType" placeholder="来源类型" clearable style="width: 140px;">
          <el-option v-for="o in sourceTypeOptions" :key="o.value || 'all'" :label="o.label" :value="o.value" />
        </el-select>
        <el-input v-model="filter.type" placeholder="子类型 (gateway_offline 等)" clearable style="width: 200px;" />
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
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column label="等级" width="80">
        <template #default="{ row }">
          <el-tag :type="levelType(row.level)" size="small">{{ levelLabel(row.level) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="180">
        <template #default="{ row }">
          <div>{{ row.sourceType }}</div>
          <div class="sc-subtle">{{ row.sourceId ?? '—' }}</div>
        </template>
      </el-table-column>
      <el-table-column label="子类型" width="140">
        <template #default="{ row }"><code>{{ row.type }}</code></template>
      </el-table-column>
      <el-table-column label="标题" min-width="200">
        <template #default="{ row }">{{ row.title }}</template>
      </el-table-column>
      <el-table-column label="详细消息" min-width="240">
        <template #default="{ row }">
          <span v-if="row.message" class="msg-cell">{{ row.message }}</span>
          <span v-else class="sc-subtle">—</span>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="处理时间" width="170">
        <template #default="{ row }">
          <span v-if="row.resolvedAt">{{ formatDate(row.resolvedAt) }}</span>
          <span v-else class="sc-subtle">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'active'">
            <el-button size="small" link type="success" :disabled="!perm.canEdit" @click="resolve(row)">解除</el-button>
            <el-button size="small" link :disabled="!perm.canEdit" @click="ignore(row)">忽略</el-button>
          </template>
          <span v-else class="sc-subtle">已处理</span>
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
.summary-row { display: flex; gap: 12px; flex-wrap: wrap; }
.card-stat {
  flex: 0 0 140px;
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 12px 18px;
}
.card-stat .num { font-size: 28px; font-weight: 700; }
.card-stat .lbl { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.card-stat.is-ok { border-color: var(--color-success); }
.card-stat.is-danger { border-color: var(--color-error); }
.card-stat.is-danger .num { color: var(--color-error); }
.card-stat.is-warning { border-color: var(--color-warning); }
.card-stat.is-warning .num { color: var(--color-warning); }
.card-stat.is-info .num { color: var(--color-info); }

.bar { display: flex; }
.filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.msg-cell {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.pager { display: flex; justify-content: flex-end; }
</style>
