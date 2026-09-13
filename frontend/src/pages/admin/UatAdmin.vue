<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  CheckCircle2, RefreshCw, Filter, Trash2, RotateCcw, CheckCircle, XCircle, AlertTriangle, Pencil, Loader,
} from 'lucide-vue-next';
import { adminUatService } from '@/services/admin.service';
import { wsClient } from '@/services/websocket.service';
import { usePermissionStore } from '@/stores/permission';
import type { UatCategory, UatRecord, UatStatus, UatSummary, WsEvent } from '@/types/api';

const perm = usePermissionStore();

const records = ref<UatRecord[]>([]);
const summary = ref<UatSummary | null>(null);
const loading = ref(false);
let unsubscribeWs: (() => void) | null = null;

const filter = reactive({
  category: '' as '' | UatCategory,
  status: '' as '' | UatStatus,
  keyword: '',
});

const statusOptions: Array<{ value: UatStatus; label: string; type: string }> = [
  { value: 'pending', label: '待测', type: 'info' },
  { value: 'passed', label: '通过', type: 'success' },
  { value: 'failed', label: '失败', type: 'danger' },
  { value: 'need_adjustment', label: '需调整', type: 'warning' },
];

const statusCls: Record<UatStatus, string> = {
  pending:         'is-off',
  passed:          'is-on',
  failed:          'is-error',
  need_adjustment: 'is-warning',
};

const categoryOptions: Array<{ value: UatCategory; label: string; icon: string }> = [
  { value: 'scene', label: '场景', icon: '🎬' },
  { value: 'device', label: '设备', icon: '🛠' },
  { value: 'stability', label: '稳定性', icon: '📡' },
  { value: 'other', label: '其他', icon: '·' },
];

function statusLabel(s: UatStatus): string {
  return statusOptions.find((o) => o.value === s)?.label ?? s;
}
function categoryLabel(c: UatCategory): string {
  return categoryOptions.find((o) => o.value === c)?.label ?? c;
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [r, s] = await Promise.all([
      adminUatService.list({
        category: (filter.category || undefined) as UatCategory | undefined,
        status: (filter.status || undefined) as UatStatus | undefined,
        keyword: filter.keyword || undefined,
      }),
      adminUatService.summary(),
    ]);
    records.value = r.list;
    summary.value = s;
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

/* 测试人员姓名 (持久化到 localStorage) */
const tester = ref<string>('');
const STORAGE_KEY = 'sc.uat.tester';
onMounted(() => {
  try {
    tester.value = localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    tester.value = '';
  }
  void refresh();
  unsubscribeWs = wsClient.on((event: WsEvent) => {
    if (event.type === 'uat_updated') void refresh();
  });
});
onBeforeUnmount(() => {
  if (unsubscribeWs) unsubscribeWs();
});

function saveTester(): void {
  try {
    if (tester.value) localStorage.setItem(STORAGE_KEY, tester.value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/* 编辑 actualResult / remark */
const editing = ref<Record<number, { actualResult: string; remark: string }>>({});
function startEdit(r: UatRecord): void {
  editing.value[r.id] = {
    actualResult: r.actualResult ?? '',
    remark: r.remark ?? '',
  };
}

async function transit(r: UatRecord, status: UatStatus): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  const e = editing.value[r.id];
  try {
    const payload = {
      tester: tester.value || perm.role,
      actualResult: e?.actualResult,
      remark: e?.remark,
    };
    if (status === 'passed') await adminUatService.pass(r.id, payload);
    else if (status === 'failed') await adminUatService.fail(r.id, payload);
    else if (status === 'need_adjustment') await adminUatService.needAdjustment(r.id, payload);
    else await adminUatService.reset(r.id, { tester: tester.value || perm.role });
    ElMessage.success('已更新');
    delete editing.value[r.id];
    await refresh();
  } catch (err) {
    ElMessage.error('操作失败: ' + (err as Error).message);
  }
}

async function remove(r: UatRecord): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await ElMessageBox.confirm(`确认删除验收项「${r.itemName}」?`, '删除确认', { type: 'warning' });
  } catch { return; }
  try {
    await adminUatService.remove(r.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (err) {
    ElMessage.error('删除失败: ' + (err as Error).message);
  }
}

function fmtTime(s: string): string {
  return new Date(s).toLocaleString();
}
</script>

<template>
  <section class="page">
    <header class="hero">
      <div class="hero-left">
        <div class="sc-head-ico"><CheckCircle2 :size="22" :stroke-width="1.75" /></div>
        <div>
          <h2 class="sc-title">UAT 验收</h2>
          <div class="sc-subtle">用户验收测试 · 通过率 {{ summary?.passRate ?? 0 }}% · 共 {{ summary?.total ?? 0 }} 项</div>
        </div>
      </div>
      <div class="hero-right">
        <span class="sc-subtle">测试人:</span>
        <el-input v-model="tester" placeholder="您的姓名" style="width: 140px;" size="default" @change="saveTester" />
        <button class="sc-touch sc-act sc-act-neutral hero-btn" :disabled="loading" @click="refresh">
          <Loader v-if="loading" :size="16" class="spin" :stroke-width="2" />
          <RefreshCw v-else :size="16" :stroke-width="2" />
          刷新
        </button>
      </div>
    </header>

    <!-- 顶部统计 (用 SettingsAdmin info-card 风格) -->
    <div v-if="summary" class="info-grid">
      <div class="info-card">
        <div class="info-label">总项数</div>
        <div class="info-value"><span class="ver-num">{{ summary.total }}</span></div>
        <div class="info-foot"><span class="info-mono">待测 {{ summary.pending }}</span></div>
      </div>
      <div class="info-card ok-card">
        <div class="info-label">已通过</div>
        <div class="info-value"><span class="ver-num is-good">{{ summary.passed }}</span></div>
        <div class="info-foot"><span class="info-mono">{{ summary.total ? Math.round(summary.passed/summary.total*100) : 0 }}%</span></div>
      </div>
      <div class="info-card" :class="summary.failed > 0 ? 'alert-card' : ''">
        <div class="info-label">失败</div>
        <div class="info-value"><span class="ver-num" :class="summary.failed > 0 ? 'is-bad' : ''">{{ summary.failed }}</span></div>
        <div class="info-foot"><span class="info-mono">需调整 {{ summary.needAdjustment }}</span></div>
      </div>
      <div class="info-card pct-card" :class="summary.passRate >= 80 ? 'ok-card' : summary.passRate >= 50 ? 'warn-card' : 'alert-card'">
        <div class="info-label">通过率</div>
        <div class="info-value">
          <span class="ver-num" :class="summary.passRate >= 80 ? 'is-good' : summary.passRate >= 50 ? '' : 'is-bad'">
            {{ summary.passRate }}<small>%</small>
          </span>
        </div>
        <div class="info-foot">
          <span class="info-mono">{{ summary.passRate >= 95 ? '可上线' : summary.passRate >= 80 ? '基本可上线' : '需继续测试' }}</span>
        </div>
      </div>
    </div>

    <div class="sc-panel filter-panel">
      <div class="section-title"><Filter :size="16" :stroke-width="1.75" /> 筛选</div>
      <div class="filters">
        <el-select v-model="filter.category" placeholder="分类" clearable style="width: 140px;">
          <el-option v-for="c in categoryOptions" :key="c.value" :label="c.icon + ' ' + c.label" :value="c.value" />
        </el-select>
        <el-select v-model="filter.status" placeholder="状态" clearable style="width: 140px;">
          <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
        <el-input v-model="filter.keyword" placeholder="搜索验收项" clearable style="width: 240px;" @change="refresh" />
        <button class="sc-touch sc-act sc-act-primary section-btn" @click="refresh">
          <Filter :size="14" :stroke-width="2" /> 查询
        </button>
      </div>
    </div>

    <el-table v-loading="loading" :data="records" stripe size="default" row-key="id">
      <el-table-column label="序号" width="64">
        <template #default="{ row }">{{ row.sortOrder || row.id }}</template>
      </el-table-column>
      <el-table-column label="分类" width="80">
        <template #default="{ row }">{{ categoryLabel(row.category) }}</template>
      </el-table-column>
      <el-table-column label="项目" min-width="180">
        <template #default="{ row }">
          <div class="item-name">{{ row.itemName }}</div>
          <div v-if="row.testStep" class="sc-subtle item-step">{{ row.testStep }}</div>
        </template>
      </el-table-column>
      <el-table-column label="预期结果" min-width="200">
        <template #default="{ row }">
          <span v-if="row.expectedResult">{{ row.expectedResult }}</span>
          <span v-else class="sc-subtle">—</span>
        </template>
      </el-table-column>
      <el-table-column label="实际结果" min-width="220">
        <template #default="{ row }">
          <el-input
            v-if="editing[row.id] !== undefined"
            v-model="editing[row.id].actualResult"
            type="textarea"
            :rows="2"
            placeholder="填写测试观察到的结果"
            @click.stop
          />
          <span v-else-if="row.actualResult" class="actual">{{ row.actualResult }}</span>
          <el-button v-else size="small" link @click="startEdit(row)" :disabled="!perm.canEdit">+ 录入结果</el-button>
        </template>
      </el-table-column>
      <el-table-column label="备注" width="180">
        <template #default="{ row }">
          <el-input
            v-if="editing[row.id] !== undefined"
            v-model="editing[row.id].remark"
            size="small"
            placeholder="备注 (可选)"
          />
          <span v-else-if="row.remark" class="sc-subtle">{{ row.remark }}</span>
          <span v-else class="sc-subtle">—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <span class="sc-status" :class="statusCls[row.status as UatStatus]">
            <span class="sc-status-dot" /> {{ statusLabel(row.status) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="测试人" width="100">
        <template #default="{ row }">
          <span v-if="row.tester">{{ row.tester }}</span>
          <span v-else class="sc-subtle">—</span>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="160">
        <template #default="{ row }">
          <span v-if="row.status !== 'pending'" class="sc-subtle">{{ fmtTime(row.updatedAt) }}</span>
          <span v-else class="sc-subtle">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="340" fixed="right" align="right">
        <template #default="{ row }">
          <template v-if="editing[row.id] !== undefined">
            <button class="row-btn row-btn-ok" :disabled="!perm.canEdit" @click="transit(row, 'passed')">
              <CheckCircle :size="13" :stroke-width="2" /> 通过
            </button>
            <button class="row-btn row-btn-danger" :disabled="!perm.canEdit" @click="transit(row, 'failed')">
              <XCircle :size="13" :stroke-width="2" /> 失败
            </button>
            <button class="row-btn row-btn-warn" :disabled="!perm.canEdit" @click="transit(row, 'need_adjustment')">
              <AlertTriangle :size="13" :stroke-width="2" /> 需调整
            </button>
          </template>
          <template v-else>
            <button class="row-btn" @click="startEdit(row)" :disabled="!perm.canEdit">
              <Pencil :size="13" :stroke-width="2" /> 录入
            </button>
            <button class="row-btn row-btn-ok" :disabled="!perm.canEdit" @click="transit(row, 'passed')">
              <CheckCircle :size="13" :stroke-width="2" /> 通过
            </button>
            <button class="row-btn row-btn-danger" :disabled="!perm.canEdit" @click="transit(row, 'failed')">
              <XCircle :size="13" :stroke-width="2" /> 失败
            </button>
            <button v-if="row.status !== 'pending'" class="row-btn" :disabled="!perm.canEdit" @click="transit(row, 'pending')">
              <RotateCcw :size="13" :stroke-width="2" /> 重置
            </button>
            <button class="row-btn row-btn-danger" :disabled="!perm.canEdit" @click="remove(row)">
              <Trash2 :size="13" :stroke-width="2" /> 删除
            </button>
          </template>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.hero { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.hero-left { display: flex; align-items: center; gap: 14px; }
.hero-right { display: flex; gap: 10px; align-items: center; }
.hero-btn { min-height: 42px; padding: 0 16px; }

.info-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.info-card {
  background: var(--bg-panel); border: 1px solid var(--border-soft);
  border-radius: 14px; padding: 16px 18px 14px;
  position: relative; overflow: hidden;
}
.info-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, #4C9AFF 0%, #9BA1A9 80%, transparent 100%);
}
.info-card.ok-card::before { background: linear-gradient(90deg, #3FBF87 0%, #059669 100%); }
.info-card.warn-card::before { background: linear-gradient(90deg, #E0A030 0%, #d97706 100%); }
.info-card.alert-card::before { background: linear-gradient(90deg, #E5645D 0%, #dc2626 100%); }
.info-card.alert-card { border-color: rgba(229, 100, 93, 0.32); }
.info-label { font-size: 11px; color: var(--text-secondary); letter-spacing: 1.5px; text-transform: uppercase; }
.info-value { margin: 6px 0 4px; font-size: 22px; font-weight: 700; }
.ver-num {
  font-size: 32px;
  background: linear-gradient(135deg, #4C9AFF, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-variant-numeric: tabular-nums;
}
.ver-num.is-good { background: linear-gradient(135deg, #3FBF87, #3FBF87); -webkit-background-clip: text; background-clip: text; }
.ver-num.is-bad  { background: linear-gradient(135deg, #E5645D, #E5645D); -webkit-background-clip: text; background-clip: text; }
.ver-num small { font-size: 18px; }
.info-foot { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.info-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-secondary);
}

.filter-panel { display: flex; flex-direction: column; gap: 10px; }
.section-title { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
.section-btn { min-height: 36px; padding: 0 14px; font-size: 13px; }
.filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

.item-name { font-weight: 600; }
.item-step { font-size: 12px; margin-top: 4px; color: var(--text-secondary); }
.actual { color: var(--text-primary); }

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
.row-btn:hover:not(:disabled) { color: #c7d2fe; border-color: var(--v2-border-soft); }
.row-btn-ok:hover:not(:disabled) { color: #3FBF87; border-color: rgba(63, 191, 135, 0.5); }
.row-btn-warn:hover:not(:disabled) { color: #E0A030; border-color: rgba(224, 160, 48, 0.5); }
.row-btn-danger:hover:not(:disabled) { color: #E5645D; border-color: rgba(229, 100, 93, 0.5); }
.row-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1280px) { .info-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
