<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { useRouter } from 'vue-router';
import { adminSceneService, type SceneCreatePayload } from '@/services/admin.service';
import { usePermissionStore } from '@/stores/permission';
import type { SceneSummary } from '@/types/api';

const perm = usePermissionStore();
const router = useRouter();
const loading = ref(false);
const rows = ref<SceneSummary[]>([]);

const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const formRef = ref<FormInstance>();
const form = reactive<SceneCreatePayload & { id?: number }>({
  code: '',
  name: '',
  description: '',
  enabled: true,
});

const rules: FormRules = {
  code: [
    { required: true, message: '场景编码不能为空', trigger: 'blur' },
    { pattern: /^[a-z0-9_\-]+$/i, message: '只允许字母数字下划线连字符', trigger: 'blur' },
  ],
  name: [{ required: true, message: '场景名称不能为空', trigger: 'blur' }],
};

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const r = await adminSceneService.list();
    rows.value = r.list;
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  dialogMode.value = 'create';
  Object.assign(form, { id: undefined, code: '', name: '', description: '', enabled: true });
  dialogVisible.value = true;
}
function openEdit(row: SceneSummary): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  dialogMode.value = 'edit';
  Object.assign(form, {
    id: row.id,
    code: row.code,
    name: row.name,
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
        await adminSceneService.create(form);
        ElMessage.success('已创建');
      } else if (form.id) {
        await adminSceneService.update(form.id, form);
        ElMessage.success('已更新');
      }
      dialogVisible.value = false;
      await refresh();
    } catch (err) {
      ElMessage.error('保存失败: ' + (err as Error).message);
    }
  });
}

async function toggleEnabled(row: SceneSummary): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await adminSceneService.update(row.id, { enabled: !row.enabled });
    await refresh();
  } catch (err) {
    ElMessage.error('操作失败: ' + (err as Error).message);
  }
}

async function remove(row: SceneSummary): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await ElMessageBox.confirm(`确认删除场景「${row.name}」?`, '删除确认', { type: 'warning' });
  } catch { return; }
  try {
    await adminSceneService.remove(row.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (err) {
    ElMessage.error('删除失败: ' + (err as Error).message);
  }
}

async function testExecute(row: SceneSummary): Promise<void> {
  if (!perm.canExecute) { ElMessage.warning('当前角色无执行权限'); return; }
  try {
    await adminSceneService.execute(row.code);
    ElMessage.success(`已请求执行: ${row.name}`);
  } catch (err) {
    ElMessage.error('执行失败: ' + (err as Error).message);
  }
}

function gotoActions(row: SceneSummary): void {
  router.push({ name: 'admin-scene-actions', params: { id: row.id } });
}

onMounted(refresh);
</script>

<template>
  <section class="page">
    <header class="bar">
      <div class="left sc-subtle">共 {{ rows.length }} 个场景</div>
      <div class="right">
        <el-button @click="refresh">刷新</el-button>
        <el-button type="primary" :disabled="!perm.canEdit" @click="openCreate">+ 新增场景</el-button>
      </div>
    </header>

    <el-table v-loading="loading" :data="rows" stripe style="width: 100%;" row-key="id">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="code" label="编码" width="160" />
      <el-table-column prop="name" label="名称" width="200" />
      <el-table-column prop="description" label="说明" min-width="220">
        <template #default="{ row }">{{ row.description || '—' }}</template>
      </el-table-column>
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="!perm.canEdit" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link @click="gotoActions(row)">动作配置</el-button>
          <el-button size="small" link type="success" @click="testExecute(row)" :disabled="!perm.canExecute">测试</el-button>
          <el-button size="small" link @click="openEdit(row)" :disabled="!perm.canEdit">编辑</el-button>
          <el-button size="small" link type="danger" @click="remove(row)" :disabled="!perm.canEdit">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增场景' : '编辑场景'"
      width="560"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100" status-icon>
        <el-form-item label="编码" prop="code">
          <el-input v-model="form.code" placeholder="如 morning_open" :disabled="dialogMode === 'edit'" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="如 早晨开馆" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="可选" />
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
</style>
