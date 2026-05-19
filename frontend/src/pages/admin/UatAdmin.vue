<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
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

const categoryOptions: Array<{ value: UatCategory; label: string; icon: string }> = [
  { value: 'scene', label: '场景', icon: '🎬' },
  { value: 'device', label: '设备', icon: '🛠' },
  { value: 'stability', label: '稳定性', icon: '📡' },
  { value: 'other', label: '其他', icon: '·' },
];

function statusType(s: UatStatus): string {
  return statusOptions.find((o) => o.value === s)?.type ?? 'info';
}
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
    <!-- 顶部统计 -->
    <div class="summary-row" v-if="summary">
      <div class="stat-card">
        <div class="num">{{ summary.total }}</div>
        <div class="lbl">总项数</div>
      </div>
      <div class="stat-card ok">
        <div class="num">{{ summary.passed }}</div>
        <div class="lbl">已通过</div>
      </div>
      <div class="stat-card fail">
        <div class="num">{{ summary.failed }}</div>
        <div class="lbl">失败</div>
      </div>
      <div class="stat-card warn">
        <div class="num">{{ summary.needAdjustment }}</div>
        <div class="lbl">需调整</div>
      </div>
      <div class="stat-card info">
        <div class="num">{{ summary.pending }}</div>
        <div class="lbl">待测</div>
      </div>
      <div class="stat-card pct" :class="summary.passRate >= 80 ? 'ok' : summary.passRate >= 50 ? 'warn' : 'fail'">
        <div class="num">{{ summary.passRate }}<span>%</span></div>
        <div class="lbl">通过率</div>
      </div>
    </div>

    <header class="bar">
      <div class="filters">
        <el-select v-model="filter.category" placeholder="分类" clearable style="width: 140px;">
          <el-option v-for="c in categoryOptions" :key="c.value" :label="c.icon + ' ' + c.label" :value="c.value" />
        </el-select>
        <el-select v-model="filter.status" placeholder="状态" clearable style="width: 140px;">
          <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
        <el-input v-model="filter.keyword" placeholder="搜索验收项" clearable style="width: 220px;" @change="refresh" />
        <el-button type="primary" @click="refresh">查询</el-button>
      </div>
      <div class="actions">
        <span class="sc-subtle">测试人:</span>
        <el-input v-model="tester" placeholder="您的姓名" style="width: 140px;" @change="saveTester" />
      </div>
    </header>

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
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
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
      <el-table-column label="操作" width="290" fixed="right">
        <template #default="{ row }">
          <template v-if="editing[row.id] !== undefined">
            <el-button size="small" type="success" :disabled="!perm.canEdit" @click="transit(row, 'passed')">✓ 通过</el-button>
            <el-button size="small" type="danger" :disabled="!perm.canEdit" @click="transit(row, 'failed')">✖ 失败</el-button>
            <el-button size="small" type="warning" :disabled="!perm.canEdit" @click="transit(row, 'need_adjustment')">需调整</el-button>
          </template>
          <template v-else>
            <el-button size="small" link @click="startEdit(row)" :disabled="!perm.canEdit">录入</el-button>
            <el-button size="small" link type="success" :disabled="!perm.canEdit" @click="transit(row, 'passed')">通过</el-button>
            <el-button size="small" link type="danger" :disabled="!perm.canEdit" @click="transit(row, 'failed')">失败</el-button>
            <el-button v-if="row.status !== 'pending'" size="small" link :disabled="!perm.canEdit" @click="transit(row, 'pending')">重置</el-button>
            <el-button size="small" link type="danger" :disabled="!perm.canEdit" @click="remove(row)">删除</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.summary-row { display: flex; gap: 12px; flex-wrap: wrap; }
.stat-card {
  flex: 0 0 130px; background: var(--bg-panel); border: 1px solid var(--border-soft);
  border-radius: 12px; padding: 12px 16px;
}
.stat-card .num { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.stat-card .num span { font-size: 16px; color: var(--text-secondary); margin-left: 2px; }
.stat-card .lbl { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.stat-card.ok { border-color: var(--color-success); }
.stat-card.ok .num { color: var(--color-success); }
.stat-card.fail { border-color: var(--color-error); }
.stat-card.fail .num { color: var(--color-error); }
.stat-card.warn { border-color: var(--color-warning); }
.stat-card.warn .num { color: var(--color-warning); }
.stat-card.info .num { color: var(--color-info); }

.bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.actions { display: flex; gap: 10px; align-items: center; }

.item-name { font-weight: 600; }
.item-step { font-size: 12px; margin-top: 4px; }
.actual { color: var(--text-primary); }
</style>
