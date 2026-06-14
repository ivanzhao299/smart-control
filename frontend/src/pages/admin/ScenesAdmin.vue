<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  Clapperboard, RefreshCw, Plus, Pencil, Trash2, Play, Settings2, Loader,
} from 'lucide-vue-next';
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
    <header class="hero">
      <div class="hero-left">
        <div class="sc-head-ico"><Clapperboard :size="22" :stroke-width="1.75" /></div>
        <div>
          <h2 class="sc-title">场景管理</h2>
          <div class="sc-subtle">共 {{ rows.length }} 个场景 · 编辑动作 / 测试执行 / 启停</div>
        </div>
      </div>
      <div class="hero-right">
        <button class="sc-touch sc-act sc-act-neutral hero-btn" :disabled="loading" @click="refresh">
          <Loader v-if="loading" :size="16" class="spin" :stroke-width="2" />
          <RefreshCw v-else :size="16" :stroke-width="2" />
          刷新
        </button>
        <button class="sc-touch sc-act sc-act-primary hero-btn" :disabled="!perm.canEdit" @click="openCreate">
          <Plus :size="16" :stroke-width="2" /> 新增场景
        </button>
      </div>
    </header>

    <el-table v-loading="loading" :data="rows" stripe size="default" style="width: 100%;" row-key="id">
      <el-table-column label="编码" width="180">
        <template #default="{ row }"><code class="code-cell">{{ row.code }}</code></template>
      </el-table-column>
      <el-table-column prop="name" label="名称" width="220" />
      <el-table-column prop="description" label="说明" min-width="220">
        <template #default="{ row }">
          <span v-if="row.description">{{ row.description }}</span>
          <span v-else class="sub-mono">—</span>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="!perm.canEdit" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="320" fixed="right" align="right">
        <template #default="{ row }">
          <button class="row-btn" @click="gotoActions(row)">
            <Settings2 :size="13" :stroke-width="2" /> 动作
          </button>
          <button class="row-btn row-btn-ok" @click="testExecute(row)" :disabled="!perm.canExecute">
            <Play :size="13" :stroke-width="2" /> 测试
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
.page { display: flex; flex-direction: column; gap: 16px; }
.hero { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.hero-left { display: flex; align-items: center; gap: 14px; }
.hero-right { display: flex; gap: 10px; }
.hero-btn { min-height: 42px; padding: 0 16px; }

.code-cell {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}
.sub-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: var(--text-secondary);
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
.row-btn-danger:hover:not(:disabled) { color: #f87171; border-color: rgba(239, 68, 68, 0.5); }
.row-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
