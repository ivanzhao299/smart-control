<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
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
    <header class="bar">
      <div class="left sc-subtle">共 {{ rows.length }} 个定时任务</div>
      <div class="right">
        <el-button @click="refresh">刷新</el-button>
        <el-button type="primary" :disabled="!perm.canEdit" @click="openCreate">+ 新增任务</el-button>
      </div>
    </header>

    <el-table v-loading="loading" :data="rows" stripe row-key="id">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="name" label="任务名" min-width="180" />
      <el-table-column prop="cron" label="Cron" width="160">
        <template #default="{ row }"><code>{{ row.cron }}</code></template>
      </el-table-column>
      <el-table-column prop="sceneCode" label="绑定场景" width="160" />
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="!perm.canEdit" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="最近执行" width="170">
        <template #default="{ row }">{{ formatDate(row.lastRunAt) }}</template>
      </el-table-column>
      <el-table-column label="下次执行" width="170">
        <template #default="{ row }">
          <span v-if="row.enabled && row.nextRunAt">{{ formatDate(row.nextRunAt) }}</span>
          <span v-else class="sc-subtle">—</span>
        </template>
      </el-table-column>
      <el-table-column label="最近结果" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.lastRunStatus === 'success'" type="success" size="small">成功</el-tag>
          <el-tag v-else-if="row.lastRunStatus === 'failure'" type="danger" size="small">失败</el-tag>
          <span v-else class="sc-subtle">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link type="success" :disabled="!perm.canExecute" @click="runNow(row)">▶ 立即执行</el-button>
          <el-button size="small" link @click="openEdit(row)" :disabled="!perm.canEdit">编辑</el-button>
          <el-button size="small" link type="danger" @click="remove(row)" :disabled="!perm.canEdit">删除</el-button>
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
.page { display: flex; flex-direction: column; gap: 14px; }
.bar { display: flex; justify-content: space-between; align-items: center; }
.bar .right { display: flex; gap: 10px; }
.hint { margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap; align-items: center; font-size: 12px; }
</style>
