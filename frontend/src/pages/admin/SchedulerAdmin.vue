<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  Clock, RefreshCw, Plus, Pencil, Trash2, Play, Loader,
} from 'lucide-vue-next';
import {
  adminSceneService,
  adminSchedulerService,
  type SchedulerPayload,
} from '@/services/admin.service';
import { usePermissionStore } from '@/stores/permission';
import type { SceneSummary, SchedulerTask } from '@/types/api';

const perm = usePermissionStore();
const loading = ref(false);
const rows = ref<SchedulerTask[]>([]);
const sceneOptions = ref<SceneSummary[]>([]);

const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const formRef = ref<FormInstance>();
const form = reactive<SchedulerPayload & { id?: number }>({
  name: '',
  cron: '0 9 * * *',
  sceneCode: '',
  description: '',
  enabled: true,
});

const rules: FormRules = {
  name: [{ required: true, message: '任务名称不能为空', trigger: 'blur' }],
  cron: [
    { required: true, message: 'Cron 表达式不能为空', trigger: 'blur' },
    {
      pattern: /^([*\/0-9,\-?LW#A-Z]+\s+){4,5}[*\/0-9,\-?LW#A-Z]+$/i,
      message: 'Cron 格式不合法 (例: 0 9 * * * 表示每天 9 点)',
      trigger: 'blur',
    },
  ],
  sceneCode: [{ required: true, message: '必须绑定一个场景', trigger: 'change' }],
};

const cronPresets = [
  { label: '每天 8:30 开馆', value: '30 8 * * *' },
  { label: '每天 18:00 闭馆', value: '0 18 * * *' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
  { label: '每分钟 (调试)', value: '* * * * *' },
];

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [list, scenes] = await Promise.all([
      adminSchedulerService.list(),
      adminSceneService.list(),
    ]);
    rows.value = list.list;
    sceneOptions.value = scenes.list.filter((s) => s.enabled);
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  dialogMode.value = 'create';
  Object.assign(form, {
    id: undefined,
    name: '',
    cron: '0 9 * * *',
    sceneCode: sceneOptions.value[0]?.code ?? '',
    description: '',
    enabled: true,
  });
  dialogVisible.value = true;
}

function openEdit(row: SchedulerTask): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  dialogMode.value = 'edit';
  Object.assign(form, {
    id: row.id,
    name: row.name,
    cron: row.cron,
    sceneCode: row.sceneCode,
    description: row.description ?? '',
    enabled: row.enabled,
  });
  dialogVisible.value = true;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    try {
      if (dialogMode.value === 'create') {
        await adminSchedulerService.create(form);
        ElMessage.success('已创建');
      } else if (form.id) {
        await adminSchedulerService.update(form.id, form);
        ElMessage.success('已更新');
      }
      dialogVisible.value = false;
      await refresh();
    } catch (err) {
      ElMessage.error('保存失败: ' + (err as Error).message);
    }
  });
}

async function toggleEnabled(row: SchedulerTask): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    if (row.enabled) {
      await adminSchedulerService.disable(row.id);
    } else {
      await adminSchedulerService.enable(row.id);
    }
    ElMessage.success(`已${row.enabled ? '停用' : '启用'} ${row.name}`);
    await refresh();
  } catch (err) {
    ElMessage.error('操作失败: ' + (err as Error).message);
  }
}

async function remove(row: SchedulerTask): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await ElMessageBox.confirm(`确认删除定时任务「${row.name}」?`, '删除确认', { type: 'warning' });
  } catch { return; }
  try {
    await adminSchedulerService.remove(row.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (err) {
    ElMessage.error('删除失败: ' + (err as Error).message);
  }
}

async function runNow(row: SchedulerTask): Promise<void> {
  if (!perm.canExecute) { ElMessage.warning('当前角色无执行权限'); return; }
  try {
    await adminSchedulerService.runNow(row.id);
    ElMessage.success(`已触发 ${row.name}`);
    setTimeout(refresh, 800);
  } catch (err) {
    ElMessage.error('触发失败: ' + (err as Error).message);
  }
}

function formatDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString();
}

onMounted(refresh);
</script>

<template>
  <section class="page">
    <header class="hero">
      <div class="hero-left">
        <div class="sc-head-ico"><Clock :size="22" :stroke-width="1.75" /></div>
        <div>
          <h2 class="sc-title">定时任务</h2>
          <div class="sc-subtle">共 {{ rows.length }} 个 Cron 任务 · 自动触发场景</div>
        </div>
      </div>
      <div class="hero-right">
        <button class="sc-touch sc-act sc-act-neutral hero-btn" :disabled="loading" @click="refresh">
          <Loader v-if="loading" :size="16" class="spin" :stroke-width="2" />
          <RefreshCw v-else :size="16" :stroke-width="2" />
          刷新
        </button>
        <button class="sc-touch sc-act sc-act-primary hero-btn" :disabled="!perm.canEdit" @click="openCreate">
          <Plus :size="16" :stroke-width="2" /> 新增任务
        </button>
      </div>
    </header>

    <el-table v-loading="loading" :data="rows" stripe size="default" row-key="id">
      <el-table-column prop="name" label="任务名" min-width="180" />
      <el-table-column label="Cron" width="170">
        <template #default="{ row }"><code class="code-cell">{{ row.cron }}</code></template>
      </el-table-column>
      <el-table-column label="绑定场景" width="180">
        <template #default="{ row }"><code class="code-cell">{{ row.sceneCode }}</code></template>
      </el-table-column>
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="!perm.canEdit" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="最近执行" width="170">
        <template #default="{ row }"><span class="sub-mono">{{ formatDate(row.lastRunAt) }}</span></template>
      </el-table-column>
      <el-table-column label="下次执行" width="170">
        <template #default="{ row }">
          <span v-if="row.enabled && row.nextRunAt" class="sub-mono">{{ formatDate(row.nextRunAt) }}</span>
          <span v-else class="sub-mono">—</span>
        </template>
      </el-table-column>
      <el-table-column label="最近结果" width="110">
        <template #default="{ row }">
          <span v-if="row.lastRunStatus === 'success'" class="sc-status is-on">
            <span class="sc-status-dot" /> 成功
          </span>
          <span v-else-if="row.lastRunStatus === 'failure'" class="sc-status is-error">
            <span class="sc-status-dot" /> 失败
          </span>
          <span v-else class="sub-mono">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="280" fixed="right" align="right">
        <template #default="{ row }">
          <button class="row-btn row-btn-ok" :disabled="!perm.canExecute" @click="runNow(row)">
            <Play :size="13" :stroke-width="2" /> 立即执行
          </button>
          <button class="row-btn" @click="openEdit(row)" :disabled="!perm.canEdit">
            <Pencil :size="13" :stroke-width="2" /> 编辑
          </button>
          <button class="row-btn row-btn-danger" @click="remove(row)" :disabled="!perm.canEdit">
            <Trash2 :size="13" :stroke-width="2" /> 删除
          </button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增定时任务' : '编辑定时任务'"
      width="600"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100" status-icon>
        <el-form-item label="任务名称" prop="name">
          <el-input v-model="form.name" placeholder="如 早晨自动开馆" />
        </el-form-item>
        <el-form-item label="Cron" prop="cron">
          <el-input v-model="form.cron" placeholder="分 时 日 月 周" />
          <div class="sc-subtle hint">
            预设:
            <el-button v-for="p in cronPresets" :key="p.value" size="small" link @click="form.cron = p.value">{{ p.label }}</el-button>
          </div>
        </el-form-item>
        <el-form-item label="绑定场景" prop="sceneCode">
          <el-select v-model="form.sceneCode" filterable style="width: 100%;">
            <el-option v-for="s in sceneOptions" :key="s.code" :label="`${s.name} (${s.code})`" :value="s.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.hero { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.hero-left { display: flex; align-items: center; gap: 14px; }
.hero-right { display: flex; gap: 10px; }
.hero-btn { min-height: 42px; padding: 0 16px; }

.code-cell {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  color: #6BADFF;
  background: rgba(76, 154, 255, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}
.sub-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; color: var(--text-secondary); }

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
.row-btn-danger:hover:not(:disabled) { color: #E5645D; border-color: rgba(229, 100, 93, 0.5); }
.row-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.hint { margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap; align-items: center; font-size: 12px; }
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
