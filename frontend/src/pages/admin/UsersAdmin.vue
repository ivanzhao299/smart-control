<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Users as UsersIcon, RefreshCw, Plus, Pencil, Trash2, Loader, ShieldCheck } from 'lucide-vue-next';
import {
  adminUserService,
  type UserCreatePayload,
  type UserUpdatePayload,
  type UserPermissionDetail,
} from '@/services/admin.service';
import { roleService, type PermissionCatalog, type RoleListRow } from '@/services/role.service';
import { usePermissionStore } from '@/stores/permission';
import type { User } from '@/types/api';

const perm = usePermissionStore();
const loading = ref(false);
const rows = ref<User[]>([]);

/** 内置角色的固定标签与配色（自定义角色动态从后端拉取）。 */
const builtinRoleMeta: Record<string, { label: string; type: string }> = {
  admin: { label: '管理员', type: 'danger' },
  hardware: { label: '硬件工程师', type: 'warning' },
  config: { label: '运营配置员', type: 'success' },
  operator: { label: '展厅操作员', type: 'primary' },
  viewer: { label: '只读账户', type: 'info' },
};
const roleRows = ref<RoleListRow[]>([]);

function roleLabel(code: string): string {
  const hit = roleRows.value.find((r) => r.code === code);
  if (hit) return hit.name;
  return builtinRoleMeta[code]?.label ?? code;
}
function roleTagType(code: string): string {
  const hit = roleRows.value.find((r) => r.code === code);
  if (hit) return hit.isBuiltin ? (builtinRoleMeta[code]?.type ?? 'info') : 'success';
  return builtinRoleMeta[code]?.type ?? 'info';
}
/** 新建/编辑下拉：启用角色 + 编辑时当前用户所属（可能已停用）角色。 */
const selectableRoles = computed<RoleListRow[]>(() => {
  const list = roleRows.value.filter((r) => r.enabled);
  if (form.role && !list.some((r) => r.code === form.role)) {
    const current = roleRows.value.find((r) => r.code === form.role);
    if (current) return [...list, current];
  }
  return list;
});

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
    const [r, roleList] = await Promise.all([
      adminUserService.list(),
      roleService.list().catch(() => [] as RoleListRow[]),
    ]);
    rows.value = r.list;
    roleRows.value = roleList;
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

// ================= 用户级权限覆盖（第二十一轮） =================
const permDrawer = ref(false);
const drawerUser = ref<User | null>(null);
const drawerLoading = ref(false);
const drawerSaving = ref(false);
const catalog = ref<PermissionCatalog | null>(null);
const drawerDetail = ref<UserPermissionDetail | null>(null);
/** 本地编辑态：permissionCode → grant / deny；不在 Map 中即跟随角色。 */
const stateMap = reactive(new Map<string, 'grant' | 'deny'>());
const SENSITIVE_PERMS = new Set(['user:manage', 'role:manage', 'system:settings']);

async function ensureCatalog(): Promise<void> {
  if (!catalog.value) catalog.value = await roleService.catalog();
}
const drawerGroups = computed(() => [...(catalog.value?.groups ?? [])].sort((a, b) => a.sort - b.sort));
const drawerActive = ref<string[]>([]);
function drawerPermsOf(groupCode: string) {
  return (catalog.value?.permissions ?? [])
    .filter((p) => p.group === groupCode)
    .sort((a, b) => a.sort - b.sort);
}
function baselineHas(code: string): boolean {
  return drawerDetail.value?.rolePermissions.includes(code) ?? false;
}
function stateOf(code: string): 'inherit' | 'grant' | 'deny' {
  return stateMap.get(code) ?? 'inherit';
}
function setState(code: string, s: 'inherit' | 'grant' | 'deny'): void {
  if (s === 'grant' && SENSITIVE_PERMS.has(code)) {
    ElMessage.warning('该权限为系统级权限，授予后该用户可管理用户/角色或系统设置，请谨慎。');
  }
  if (s === 'inherit') stateMap.delete(code);
  else stateMap.set(code, s);
}
/** 实时计算最终有效权限（角色基线 ∪ grant − deny）。 */
const effectiveSet = computed<Set<string>>(() => {
  const base = new Set(drawerDetail.value?.rolePermissions ?? []);
  for (const [code, s] of stateMap) {
    if (s === 'grant') base.add(code);
    else if (s === 'deny') base.delete(code);
  }
  return base;
});
const effectiveCount = computed(() => effectiveSet.value.size);
const hasOverride = computed(() => stateMap.size > 0);
function resetAll(): void {
  stateMap.clear();
}

async function openPermissions(row: User): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  drawerUser.value = row;
  permDrawer.value = true;
  drawerLoading.value = true;
  stateMap.clear();
  drawerDetail.value = null;
  try {
    await ensureCatalog();
    drawerActive.value = drawerGroups.value.map((g) => g.code);
    drawerDetail.value = await adminUserService.getUserPermissions(row.id);
    for (const code of drawerDetail.value.grants) stateMap.set(code, 'grant');
    for (const code of drawerDetail.value.denies) stateMap.set(code, 'deny');
  } catch (e) {
    ElMessage.error('加载权限失败: ' + (e as Error).message);
  } finally {
    drawerLoading.value = false;
  }
}

async function savePermissions(): Promise<void> {
  const user = drawerUser.value;
  if (!user) return;
  const grants: string[] = [];
  const denies: string[] = [];
  for (const [code, s] of stateMap) {
    if (s === 'grant') grants.push(code);
    else if (s === 'deny') denies.push(code);
  }
  drawerSaving.value = true;
  try {
    await adminUserService.saveUserPermissions(user.id, grants, denies);
    ElMessage.success('权限已保存');
    permDrawer.value = false;
    await refresh();
  } catch (e) {
    ElMessage.error('保存失败: ' + (e as Error).message);
  } finally {
    drawerSaving.value = false;
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
      <el-table-column prop="username" label="用户名" min-width="180" />
      <el-table-column label="角色" width="140">
        <template #default="{ row }">
          <el-tag size="small" :type="(roleTagType(row.role) as 'danger' | 'warning' | 'success' | 'primary' | 'info')">
            {{ roleLabel(row.role) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="!perm.canEdit" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }"><span class="sub-mono">{{ new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="250" fixed="right" align="right">
        <template #default="{ row }">
          <button class="row-btn" @click="openPermissions(row)" :disabled="!perm.canEdit || row.role === 'admin'">
            <ShieldCheck :size="13" :stroke-width="2" /> 权限
          </button>
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
            <el-option
              v-for="r in selectableRoles"
              :key="r.code"
              :label="r.name + (r.enabled ? '' : '（已停用）')"
              :value="r.code"
              :disabled="!r.enabled && r.code !== form.role"
            >
              <span>{{ r.name }}</span>
              <span v-if="!r.enabled" class="sub-mono" style="margin-left:8px;color:var(--el-text-color-secondary)">已停用</span>
            </el-option>
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

    <el-drawer
      v-model="permDrawer"
      :title="`用户权限 · ${drawerUser?.username ?? ''}`"
      size="min(580px, 96vw)"
      destroy-on-close
    >
      <div v-loading="drawerLoading" class="perm-drawer-body">
        <template v-if="drawerDetail">
          <div class="drawer-summary">
            <div class="ds-item">
              <span class="ds-label">角色基线</span>
              <strong>{{ drawerDetail.roleName }}</strong>
              <span class="ds-count">{{ drawerDetail.rolePermissions.length }} 项</span>
            </div>
            <div class="ds-item">
              <span class="ds-label">最终有效权限</span>
              <strong class="ds-eff">{{ effectiveCount }} 项</strong>
            </div>
            <el-button v-if="hasOverride" size="small" @click="resetAll">全部重置为跟随角色</el-button>
          </div>
          <el-alert
            type="info"
            :closable="false"
            show-icon
            class="drawer-tip"
            title="「跟随角色」取该用户角色的权限；「额外开通」在角色之外临时授予；「临时关闭」在角色权限中临时收回。个人覆盖优先于角色，admin 不适用。"
          />

          <el-collapse v-model="drawerActive" class="drawer-collapse">
            <el-collapse-item v-for="g in drawerGroups" :key="g.code" :name="g.code">
              <template #title>
                <span class="group-title">{{ g.name }}</span>
              </template>
              <div
                v-for="p in drawerPermsOf(g.code)"
                :key="p.code"
                class="perm-row"
                :class="{ 'is-on': effectiveSet.has(p.code) }"
              >
                <div class="perm-row-head">
                  <span class="perm-row-name">{{ p.name }}</span>
                  <code class="perm-row-code">{{ p.code }}</code>
                </div>
                <el-radio-group
                  :model-value="stateOf(p.code)"
                  size="small"
                  class="perm-state"
                  @change="(v: 'inherit' | 'grant' | 'deny') => setState(p.code, v)"
                >
                  <el-radio-button value="inherit">跟随角色（{{ baselineHas(p.code) ? '有' : '无' }}）</el-radio-button>
                  <el-radio-button value="grant" :disabled="baselineHas(p.code)">额外开通</el-radio-button>
                  <el-radio-button value="deny" :disabled="!baselineHas(p.code)">临时关闭</el-radio-button>
                </el-radio-group>
              </div>
            </el-collapse-item>
          </el-collapse>
        </template>
      </div>
      <template #footer>
        <el-button @click="permDrawer = false">关闭</el-button>
        <el-button type="primary" :loading="drawerSaving" :disabled="!drawerDetail" @click="savePermissions">
          保存权限
        </el-button>
      </template>
    </el-drawer>
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
.row-btn:hover:not(:disabled) { color: #c7d2fe; border-color: var(--v2-border-soft); }
.row-btn-danger:hover:not(:disabled) { color: #E5645D; border-color: rgba(229, 100, 93, 0.5); }
.row-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 用户权限抽屉 */
.perm-drawer-body { display: flex; flex-direction: column; gap: 12px; }
.drawer-summary {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  padding: 12px 14px; border: 1px solid var(--border-soft); border-radius: 8px;
  background: var(--bg-elevated);
}
.ds-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.ds-label { color: var(--text-secondary); }
.ds-count { font-size: 12px; color: var(--text-secondary); }
.ds-eff { color: var(--el-color-primary); }
.drawer-tip { margin: 0; }
.drawer-collapse .group-title { font-weight: 600; }
.perm-row {
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
  display: flex; flex-direction: column; gap: 8px;
}
.perm-row.is-on { border-color: var(--el-color-primary-light-5); }
.perm-row-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.perm-row-name { font-size: 13px; font-weight: 500; }
.perm-row-code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: var(--text-secondary);
  background: var(--bg-elevated); border: 1px solid var(--border-soft);
  padding: 1px 5px; border-radius: 4px;
}
.perm-state { display: flex; flex-wrap: wrap; }
@media (max-width: 560px) {
  .perm-state :deep(.el-radio-button__inner) { padding: 7px 9px; font-size: 12px; }
}
</style>
