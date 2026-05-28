<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { auditService, type AuditEntry, type AuditAction } from '@/services/audit.service';

const list = ref<AuditEntry[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const loading = ref(false);
const selected = ref<AuditEntry | null>(null);
const drawerVisible = ref(false);

// 筛选
const filterEntityType = ref<string>('');
const filterAction = ref<AuditAction | ''>('');
const filterOperator = ref<string>('');

const ENTITY_OPTIONS = ['hardware_unit', 'driver_template', 'device', 'scene'];
const ACTION_OPTIONS: AuditAction[] = ['create', 'update', 'delete', 'rollback'];

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const data = await auditService.list({
      entityType: filterEntityType.value || undefined,
      action: filterAction.value || undefined,
      operator: filterOperator.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    list.value = data.list;
    total.value = data.total;
  } catch (err) {
    ElMessage.error(`加载失败: ${(err as Error).message}`);
  } finally {
    loading.value = false;
  }
}

function openDetail(row: AuditEntry): void {
  selected.value = row;
  drawerVisible.value = true;
}

async function rollback(row: AuditEntry): Promise<void> {
  if (row.entityType !== 'hardware_unit') {
    ElMessage.warning(`暂不支持回滚 ${row.entityType}, 只支持 hardware_unit`);
    return;
  }
  if (!row.snapshotBefore) {
    ElMessage.warning('没有 snapshotBefore (可能是 create 记录), 无法回滚');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定把 hardware_unit#${row.entityId} 回滚到 audit#${row.id} 的 snapshotBefore 状态? 这会再记一条 rollback 审计.`,
      '确认回滚',
      { type: 'warning' },
    );
  } catch { return; }
  try {
    await auditService.rollback(row.id);
    ElMessage.success('已回滚');
    await refresh();
  } catch (err) {
    ElMessage.error(`回滚失败: ${(err as Error).message}`);
  }
}

function actionTagType(action: AuditAction): 'success' | 'info' | 'warning' | 'danger' {
  if (action === 'create') return 'success';
  if (action === 'update') return 'info';
  if (action === 'rollback') return 'warning';
  return 'danger';
}

const formattedSnapshot = computed<{ before: string; after: string }>(() => {
  const fmt = (x: unknown): string => (x == null ? '(空)' : JSON.stringify(x, null, 2));
  return {
    before: fmt(selected.value?.snapshotBefore),
    after: fmt(selected.value?.snapshotAfter),
  };
});

onMounted(refresh);
</script>

<template>
  <section class="audit-admin">
    <header class="page-head">
      <div>
        <h2>配置变更历史</h2>
        <p class="sub">硬件清单 / 驱动模板 等"配置态"变动审计. 可回滚到任意快照.</p>
      </div>
      <div class="actions">
        <el-select v-model="filterEntityType" placeholder="实体类型" clearable style="width: 160px;" @change="refresh">
          <el-option v-for="t in ENTITY_OPTIONS" :key="t" :value="t" :label="t" />
        </el-select>
        <el-select v-model="filterAction" placeholder="动作" clearable style="width: 140px;" @change="refresh">
          <el-option v-for="a in ACTION_OPTIONS" :key="a" :value="a" :label="a" />
        </el-select>
        <el-input v-model="filterOperator" placeholder="操作人" clearable style="width: 160px;" @change="refresh" />
        <el-button @click="refresh" :loading="loading">刷新</el-button>
      </div>
    </header>

    <el-table :data="list" v-loading="loading" stripe @row-click="openDetail" class="audit-table">
      <el-table-column prop="id" label="#" width="70" />
      <el-table-column prop="createdAt" label="时间" width="180">
        <template #default="{ row }">
          <span class="time">{{ new Date(row.createdAt).toLocaleString() }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="entityType" label="类型" width="140" />
      <el-table-column prop="entityId" label="实体 ID" width="120" />
      <el-table-column label="动作" width="100">
        <template #default="{ row }">
          <el-tag :type="actionTagType(row.action)" size="small">{{ row.action }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="operator" label="操作人" width="120" />
      <el-table-column prop="remark" label="备注 / 来源" min-width="240" />
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.entityType === 'hardware_unit' && row.snapshotBefore"
            type="warning"
            link
            @click.stop="rollback(row)"
          >回滚</el-button>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[25, 50, 100, 200]"
      layout="total, sizes, prev, pager, next"
      class="pager"
      @current-change="refresh"
      @size-change="refresh"
    />

    <el-drawer
      v-model="drawerVisible"
      :title="selected ? `audit#${selected.id} · ${selected.entityType}#${selected.entityId}` : '详情'"
      size="50%"
      direction="rtl"
    >
      <div v-if="selected" class="detail">
        <dl>
          <dt>时间</dt><dd>{{ new Date(selected.createdAt).toLocaleString() }}</dd>
          <dt>动作</dt><dd><el-tag :type="actionTagType(selected.action)" size="small">{{ selected.action }}</el-tag></dd>
          <dt>操作人</dt><dd>{{ selected.operator }}</dd>
          <dt>备注</dt><dd>{{ selected.remark || '—' }}</dd>
        </dl>
        <h4>snapshot before</h4>
        <pre class="mono">{{ formattedSnapshot.before }}</pre>
        <h4>snapshot after</h4>
        <pre class="mono">{{ formattedSnapshot.after }}</pre>
      </div>
    </el-drawer>
  </section>
</template>

<style scoped>
.audit-admin { padding: 16px 24px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; gap: 16px; }
.page-head h2 { margin: 0; font-size: 20px; }
.sub { color: var(--el-text-color-secondary); margin: 4px 0 0; font-size: 13px; }
.actions { display: flex; gap: 12px; align-items: center; }
.audit-table :deep(.el-table__row) { cursor: pointer; }
.time { color: var(--el-text-color-secondary); font-size: 12px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.pager { margin-top: 12px; justify-content: flex-end; display: flex; }
.detail dl { display: grid; grid-template-columns: 80px 1fr; gap: 8px 16px; padding: 16px 24px; }
.detail dt { color: var(--el-text-color-secondary); font-size: 13px; }
.detail dd { margin: 0; }
.detail h4 { margin: 16px 24px 4px; }
.mono { background: var(--el-fill-color-light); padding: 12px 16px; border-radius: 6px;
        font-family: 'JetBrains Mono', 'Menlo', monospace; font-size: 12px; margin: 0 24px 16px;
        max-height: 280px; overflow: auto; }
</style>
