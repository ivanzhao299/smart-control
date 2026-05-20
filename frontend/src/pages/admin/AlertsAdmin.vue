<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  BellRing, RefreshCw, AlertOctagon, AlertTriangle, Info, CheckCircle2, XCircle, Filter, Loader,
} from 'lucide-vue-next';
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

const levelMeta: Record<AlertLevel, { label: string; cls: string }> = {
  info:      { label: '提示', cls: 'is-info-lv' },
  warning:   { label: '警告', cls: 'is-warning' },
  critical:  { label: '严重', cls: 'is-error' },
  emergency: { label: '紧急', cls: 'is-error' },
};

const statusMeta: Record<AlertStatus, { label: string; cls: string }> = {
  active:   { label: '激活',   cls: 'is-error' },
  resolved: { label: '已解除', cls: 'is-on' },
  ignored:  { label: '已忽略', cls: 'is-off' },
};

const levelOptions = [
  { value: 'info', label: '提示' },
  { value: 'warning', label: '警告' },
  { value: 'critical', label: '严重' },
  { value: 'emergency', label: '紧急' },
];
const statusOptions = [
  { value: 'active', label: '激活' },
  { value: 'resolved', label: '已解除' },
  { value: 'ignored', label: '已忽略' },
];
const sourceTypeOptions = [
  { value: 'gateway', label: '设备网关' },
  { value: 'device', label: '设备' },
  { value: 'scene', label: '场景' },
  { value: 'scheduler', label: '定时任务' },
  { value: 'system', label: '系统' },
];

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
      adminAlertService.list({ ...filter, sourceType: filter.sourceType || undefined }),
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

function onPage(p: number): void { filter.page = p; void refresh(); }

async function resolve(row: Alert): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await ElMessageBox.confirm(`确认解除报警「${row.title}」?`, '解除确认', { type: 'warning' });
  } catch { return; }
  try {
    await adminAlertService.resolve(row.id, perm.role);
    ElMessage.success('已解除');
    await refresh();
  } catch (err) { ElMessage.error('解除失败: ' + (err as Error).message); }
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
  } catch (err) { ElMessage.error('忽略失败: ' + (err as Error).message); }
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('zh-CN', { hour12: false });
}

function handleWs(event: WsEvent): void {
  if (event.type === 'alert_created' || event.type === 'alert_resolved') void refresh();
}

const seriousCount = computed(() =>
  (summary.value?.byLevel.critical ?? 0) + (summary.value?.byLevel.emergency ?? 0),
);

onMounted(() => {
  void refresh();
  unsubscribeWs = wsClient.on(handleWs);
});

onBeforeUnmount(() => { if (unsubscribeWs) unsubscribeWs(); });
</script>

<template>
  <section class="page">
    <!-- Hero -->
    <header class="hero">
      <div class="hero-left">
        <div class="sc-head-ico"><BellRing :size="22" :stroke-width="1.75" /></div>
        <div>
          <h2 class="sc-title">报警中心</h2>
          <div class="sc-subtle">实时报警 · 历史回溯 · 解除 / 忽略</div>
        </div>
      </div>
      <div class="hero-right">
        <button class="sc-touch sc-act sc-act-neutral hero-btn" :disabled="loading" @click="refresh">
          <Loader v-if="loading" :size="16" class="spin" :stroke-width="2" />
          <RefreshCw v-else :size="16" :stroke-width="2" />
          刷新
        </button>
      </div>
    </header>

    <!-- 统计卡 (沿用 SettingsAdmin info-card 风格) -->
    <div v-if="summary" class="info-grid">
      <div class="info-card" :class="summary.active > 0 ? 'alert-card' : 'ok-card'">
        <div class="info-label">当前激活</div>
        <div class="info-value">
          <span class="ver-num" :class="{ 'is-bad': summary.active > 0 }">{{ summary.active }}</span>
        </div>
        <div class="info-foot">
          <component :is="summary.active > 0 ? AlertOctagon : CheckCircle2"
            :size="12" :stroke-width="2"
            :style="{ color: summary.active > 0 ? '#f87171' : '#34d399' }" />
          <span class="info-mono">{{ summary.active > 0 ? '需要处理' : '运行平稳' }}</span>
        </div>
      </div>

      <div class="info-card" :class="{ 'alert-card': seriousCount > 0 }">
        <div class="info-label">严重 / 紧急</div>
        <div class="info-value">
          <span class="ver-num" :class="{ 'is-bad': seriousCount > 0 }">{{ seriousCount }}</span>
        </div>
        <div class="info-foot">
          <AlertOctagon :size="12" :stroke-width="2" style="color:#f87171;" />
          <span class="info-mono">critical {{ summary.byLevel.critical }} · emergency {{ summary.byLevel.emergency }}</span>
        </div>
      </div>

      <div class="info-card">
        <div class="info-label">警告</div>
        <div class="info-value">
          <span class="ver-num warn-num">{{ summary.byLevel.warning }}</span>
        </div>
        <div class="info-foot">
          <AlertTriangle :size="12" :stroke-width="2" style="color:#fbbf24;" />
          <span class="info-mono">warning level</span>
        </div>
      </div>

      <div class="info-card">
        <div class="info-label">最近 24h 新增</div>
        <div class="info-value">
          <span class="ver-num">{{ summary.last24h }}</span>
        </div>
        <div class="info-foot">
          <Info :size="12" :stroke-width="2" />
          <span class="info-mono">含已处理</span>
        </div>
      </div>
    </div>

    <!-- 筛选条 -->
    <div class="sc-panel filter-panel">
      <div class="section-head">
        <div class="section-title"><Filter :size="16" :stroke-width="1.75" /> 筛选</div>
        <button class="row-btn" @click="reset">重置</button>
      </div>
      <div class="filters">
        <el-select v-model="filter.status" placeholder="状态" clearable style="width: 120px;">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="filter.level" placeholder="等级" clearable style="width: 120px;">
          <el-option v-for="o in levelOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="filter.sourceType" placeholder="来源类型" clearable style="width: 140px;">
          <el-option v-for="o in sourceTypeOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-input v-model="filter.type" placeholder="子类型 (gateway_offline 等)" clearable style="width: 200px;" />
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
      </div>
    </div>

    <!-- 表格 -->
    <div class="sc-panel section">
      <div class="section-head">
        <div class="section-title"><BellRing :size="16" :stroke-width="1.75" /> 报警列表</div>
        <span class="sc-subtle">共 {{ total }} 条</span>
      </div>
      <el-table v-loading="loading" :data="rows" stripe size="default" style="width:100%;">
        <el-table-column prop="id" label="ID" width="64" />
        <el-table-column label="等级" width="90">
          <template #default="{ row }">
            <span class="sc-status" :class="levelMeta[row.level as AlertLevel].cls">
              <span class="sc-status-dot" /> {{ levelMeta[row.level as AlertLevel].label }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span class="sc-status" :class="statusMeta[row.status as AlertStatus].cls">
              <span class="sc-status-dot" /> {{ statusMeta[row.status as AlertStatus].label }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="170">
          <template #default="{ row }">
            <div>{{ row.sourceType }}</div>
            <div class="sub-mono">{{ row.sourceId ?? '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="子类型" width="140">
          <template #default="{ row }"><code class="code-cell">{{ row.type }}</code></template>
        </el-table-column>
        <el-table-column label="标题" min-width="200" />
        <el-table-column label="详细消息" min-width="240">
          <template #default="{ row }">
            <span v-if="row.message" class="msg-cell">{{ row.message }}</span>
            <span v-else class="sub-mono">—</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">
            <span class="sub-mono">{{ fmtDate(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="处理时间" width="170">
          <template #default="{ row }">
            <span class="sub-mono">{{ fmtDate(row.resolvedAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right" align="right">
          <template #default="{ row }">
            <template v-if="row.status === 'active'">
              <button class="row-btn row-btn-ok" :disabled="!perm.canEdit" @click="resolve(row)">
                <CheckCircle2 :size="13" :stroke-width="2" /> 解除
              </button>
              <button class="row-btn" :disabled="!perm.canEdit" @click="ignore(row)">
                <XCircle :size="13" :stroke-width="2" /> 忽略
              </button>
            </template>
            <span v-else class="sub-mono">已处理</span>
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
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.hero { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.hero-left { display: flex; align-items: center; gap: 14px; }
.hero-right { display: flex; gap: 10px; }
.hero-btn { min-height: 42px; padding: 0 16px; }

/* Info cards (matches SettingsAdmin) */
.info-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.info-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 16px 18px 14px;
  position: relative;
  overflow: hidden;
}
.info-card::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #3b82f6 0%, #7c3aed 80%, transparent 100%);
}
.info-card.alert-card::before { background: linear-gradient(90deg, #ef4444 0%, #dc2626 100%); }
.info-card.alert-card { border-color: rgba(239, 68, 68, 0.32); }
.info-card.ok-card::before { background: linear-gradient(90deg, #10b981 0%, #059669 100%); }
.info-label { font-size: 11px; color: var(--text-secondary); letter-spacing: 1.5px; text-transform: uppercase; }
.info-value { margin: 6px 0 4px; font-size: 22px; font-weight: 700; }
.ver-num {
  font-size: 32px;
  background: linear-gradient(135deg, #60a5fa, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-variant-numeric: tabular-nums;
}
.ver-num.is-bad {
  background: linear-gradient(135deg, #f87171, #ef4444);
  -webkit-background-clip: text;
  background-clip: text;
}
.warn-num {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.info-foot { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.info-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-secondary);
}

/* sc-status local override: info level uses light blue */
.sc-status.is-info-lv {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.14);
  border: 1px solid rgba(96, 165, 250, 0.32);
}

/* Section */
.filter-panel { display: flex; flex-direction: column; gap: 12px; }
.section { display: flex; flex-direction: column; gap: 14px; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-title { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
.section-btn { min-height: 36px; padding: 0 14px; font-size: 13px; }
.filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

/* Cells */
.code-cell {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}
.sub-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: var(--text-secondary);
}
.msg-cell {
  font-size: 12.5px;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

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
.row-btn-ok:hover:not(:disabled) { color: #34d399; border-color: rgba(16, 185, 129, 0.5); }
.row-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.pager { display: flex; justify-content: flex-end; margin-top: 10px; }

.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1280px) {
  .info-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
