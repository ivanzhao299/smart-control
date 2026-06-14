<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Users as UsersIcon, RefreshCw, Plus, Pencil, Trash2, Loader } from 'lucide-vue-next';
import {
  adminUserService,
  type UserCreatePayload,
  type UserUpdatePayload,
} from '@/services/admin.service';
import { usePermissionStore } from '@/stores/permission';
import type { User, UserRole } from '@/types/api';

const perm = usePermissionStore();
const loading = ref(false);
const rows = ref<User[]>([]);

const roleOptions: Array<{ value: UserRole; label: string; type: string }> = [
  { value: 'admin', label: '管理员', type: 'danger' },
  { value: 'operator', label: '操作员', type: 'primary' },
  { value: 'viewer', label: '观察者', type: 'info' },
];

const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const formRef = ref<FormInstance>();
const form = reactive<UserCreatePayload & { id?: number; passwordRepeat: string }>({
  username: '',
  password: '',
  passwordRepeat: '',
  role: 'operator',
  enabled: true,
});

const rules: FormRules = {
  username: [
    { required: true, message: '用户名不能为空', trigger: 'blur' },
    { min: 2, max: 64, message: '长度 2-64', trigger: 'blur' },
  ],
  password: [
    {
      validator: (_r, v, cb) => {
        if (dialogMode.value === 'create' && (!v || v.length < 6)) {
          return cb(new Error('新建用户必填密码, 至少 6 位'));
        }
        if (v && v.length > 0 && v.length < 6) return cb(new Error('密码至少 6 位'));
        cb();
      },
      trigger: 'blur',
    },
  ],
  passwordRepeat: [
    {
      validator: (_r, v, cb) => {
        if (!form.password) return cb();
        if (v !== form.password) return cb(new Error('两次密码不一致'));
        cb();
      },
      trigger: 'blur',
    },
  ],
  role: [{ required: true, message: '必须选择角色', trigger: 'change' }],
};

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const r = await adminUserService.list();
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
  Object.assign(form, {
    id: undefined,
    username: '',
    password: '',
    passwordRepeat: '',
    role: 'operator',
    enabled: true,
  });
  dialogVisible.value = true;
}

function openEdit(row: User): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  dialogMode.value = 'edit';
  Object.assign(form, {
    id: row.id,
    username: row.username,
    password: '',
    passwordRepeat: '',
    role: row.role,
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
        await adminUserService.create({
          username: form.username,
          password: form.password,
          role: form.role,
          enabled: form.enabled,
        });
        ElMessage.success('已创建');
      } else if (form.id) {
        const payload: UserUpdatePayload = {
          username: form.username,
          role: form.role,
          enabled: form.enabled,
        };
        if (form.password) payload.password = form.password;
        await adminUserService.update(form.id, payload);
        ElMessage.success('已更新');
      }
      dialogVisible.value = false;
      await refresh();
    } catch (err) {
      ElMessage.error('保存失败: ' + (err as Error).message);
    }
  });
}

async function toggleEnabled(row: User): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await adminUserService.update(row.id, { enabled: !row.enabled });
    await refresh();
  } catch (err) {
    ElMessage.error('操作失败: ' + (err as Error).message);
  }
}

async function remove(row: User): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  if (row.username === 'admin') { ElMessage.warning('默认 admin 不可删除'); return; }
  try {
    await ElMessageBox.confirm(`确认删除用户「${row.username}」?`, '删除确认', { type: 'warning' });
  } catch { return; }
  try {
    await adminUserService.remove(row.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (err) {
    ElMessage.error('删除失败: ' + (err as Error).message);
  }
}

onMounted(refresh);
</script>

<template>
  <section class="page">
    <header class="hero">
      <div class="hero-left">
        <div class="sc-head-ico"><UsersIcon :size="22" :stroke-width="1.75" /></div>
        <div>
          <h2 class="sc-title">用户管理</h2>
          <div class="sc-subtle">共 {{ rows.length }} 个账户 · 角色权限 · 启停</div>
        </div>
      </div>
      <div class="hero-right">
        <button class="sc-touch sc-act sc-act-neutral hero-btn" :disabled="loading" @click="refresh">
          <Loader v-if="loading" :size="16" class="spin" :stroke-width="2" />
          <RefreshCw v-else :size="16" :stroke-width="2" />
          刷新
        </button>
        <button class="sc-touch sc-act sc-act-primary hero-btn" :disabled="!perm.canEdit" @click="openCreate">
          <Plus :size="16" :stroke-width="2" /> 新增用户
        </button>
      </div>
    </header>

    <el-table v-loading="loading" :data="rows" stripe size="default" row-key="id">
      <el-table-column prop="id" label="ID" width="48" />
      <el-table-column prop="username" label="用户名" min-width="150" />
      <el-table-column label="角色" width="140">
        <template #default="{ row }">
          <span class="sc-status" :class="row.role === 'admin' ? 'is-error' : row.role === 'operator' ? 'is-on' : 'is-off'">
            <span class="sc-status-dot" /> {{ roleOptions.find((o) => o.value === row.role)?.label }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="!perm.canEdit" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="132">
        <template #default="{ row }"><span class="sub-mono">{{ new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="158" fixed="right" align="right">
        <template #default="{ row }">
          <button class="row-btn" @click="openEdit(row)" :disabled="!perm.canEdit">
            <Pencil :size="13" :stroke-width="2" /> 编辑
          </button>
          <button class="row-btn row-btn-danger" @click="remove(row)" :disabled="!perm.canEdit || row.username === 'admin'">
            <Trash2 :size="13" :stroke-width="2" /> 删除
          </button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增用户' : '编辑用户'"
      width="520"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100" status-icon>
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="用户名" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password
            :placeholder="dialogMode === 'edit' ? '留空则不修改' : '至少 6 位'" />
        </el-form-item>
        <el-form-item label="确认密码" prop="passwordRepeat">
          <el-input v-model="form.passwordRepeat" type="password" show-password />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" style="width: 100%;">
            <el-option v-for="r in roleOptions" :key="r.value" :label="r.label" :value="r.value" />
          </el-select>
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
.row-btn:hover:not(:disabled) { color: #c7d2fe; border-color: rgba(99, 102, 241, 0.5); }
.row-btn-danger:hover:not(:disabled) { color: #f87171; border-color: rgba(239, 68, 68, 0.5); }
.row-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
