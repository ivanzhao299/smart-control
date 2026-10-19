<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  roleService,
  type PermissionCatalog,
  type PermissionGroup,
  type PermissionPoint,
  type RoleDetail,
  type RoleListRow,
} from '@/services/role.service';

const loading = ref(false);
const roles = ref<RoleListRow[]>([]);
const catalog = ref<PermissionCatalog | null>(null);

// ---- 编辑 / 新建对话框 ----
const dialogVisible = ref(false);
const isNew = ref(true);
const saving = ref(false);
const editing = ref<RoleDetail | null>(null);
const activeGroups = ref<string[]>([]);
const form = ref({
  code: '',
  name: '',
  description: '',
  canFront: false,
  canBack: false,
  enabled: false,
  permissions: [] as string[],
});

/** 内置且锁定（admin）：全只读。 */
const isLocked = computed(() => !!editing.value?.isLocked);
/** 内置角色（非 admin）：仅可停用/启用，其余只读。 */
const isBuiltin = computed(() => !!editing.value?.isBuiltin);
const basicReadonly = computed(() => isLocked.value || isBuiltin.value);
// 第二十一轮：仅 admin 锁权限点；其余内置角色可勾选权限点（名称/登录方向仍由 basicReadonly 锁）。
const permReadonly = computed(() => isLocked.value);

// 打开编辑时记录的"原始权限"与"该角色用户数"（保存前 diff 与影响人数提示用）。
const originalPerms = ref<string[]>([]);
const affectedUserCount = ref(0);

/** 内置角色默认权限集映射（来自 catalog.roles）。 */
const defaultPermsMap = computed<Map<string, Set<string>>>(() =>
  new Map((catalog.value?.roles ?? []).map((r) => [r.code, new Set(r.defaultPermissions)])),
);
function defaultPerms(code: string): Set<string> {
  return defaultPermsMap.value.get(code) ?? new Set();
}

/** 当前权限相对默认集的状态：默认/人工新增/人工移除（仅内置角色标色）。 */
type PermDelta = 'default' | 'added' | 'removed';
function permDelta(code: string): PermDelta {
  if (!isBuiltin.value) return 'default';
  const inDefault = defaultPerms(editing.value?.code ?? '').has(code);
  const has = form.value.permissions.includes(code);
  if (has && !inDefault) return 'added';
  if (!has && inDefault) return 'removed';
  return 'default';
}
function permClass(code: string): string {
  const d = permDelta(code);
  return d === 'default' ? '' : `perm-${d}`;
}

/** 是否相对默认集有改动（控制"恢复默认"按钮显隐）。 */
const isCustomized = computed(() => {
  const code = editing.value?.code;
  if (!code || !isBuiltin.value) return false;
  const d = defaultPerms(code);
  const cur = new Set(form.value.permissions);
  if (cur.size !== d.size) return true;
  for (const c of d) if (!cur.has(c)) return true;
  return false;
});

/** 一键恢复该内置角色的默认权限集。 */
function restoreDefault(): void {
  const code = editing.value?.code;
  if (!code) return;
  form.value.permissions = [...defaultPerms(code)];
}
const dialogTitle = computed(() => {
  if (isNew.value) return '新建角色';
  if (isLocked.value) return `角色详情 · ${editing.value?.name ?? ''}`;
  return `编辑角色 · ${editing.value?.name ?? ''}`;
});

const sortedGroups = computed<PermissionGroup[]>(() =>
  [...(catalog.value?.groups ?? [])].sort((a, b) => a.sort - b.sort),
);
function permsOfGroup(groupCode: string): PermissionPoint[] {
  return (catalog.value?.permissions ?? [])
    .filter((p) => p.group === groupCode)
    .sort((a, b) => a.sort - b.sort);
}
function groupCheckedCount(code: string): number {
  return permsOfGroup(code).filter((p) => form.value.permissions.includes(p.code)).length;
}
function isGroupAllChecked(code: string): boolean {
  const list = permsOfGroup(code);
  return list.length > 0 && list.every((p) => form.value.permissions.includes(p.code));
}
function toggleGroup(code: string, checked: boolean): void {
  if (permReadonly.value) return;
  const codes = permsOfGroup(code).map((p) => p.code);
  if (checked) {
    form.value.permissions = Array.from(new Set([...form.value.permissions, ...codes]));
  } else {
    form.value.permissions = form.value.permissions.filter((c) => !codes.includes(c));
  }
}

async function loadAll(): Promise<void> {
  loading.value = true;
  try {
    const [roleList, cat] = await Promise.all([
      roleService.list(),
      roleService.catalog(),
    ]);
    roles.value = roleList;
    catalog.value = cat;
  } finally {
    loading.value = false;
  }
}

function resetForm(): void {
  form.value = {
    code: '',
    name: '',
    description: '',
    canFront: false,
    canBack: false,
    enabled: false,
    permissions: [],
  };
  activeGroups.value = sortedGroups.value.map((g) => g.code);
}

function openCreate(): void {
  isNew.value = true;
  editing.value = null;
  resetForm();
  // 新建角色默认停用优先（用户拍板），管理员手动勾选启用。
  form.value.enabled = false;
  originalPerms.value = [];
  affectedUserCount.value = 0;
  dialogVisible.value = true;
}

async function openEdit(row: RoleListRow): Promise<void> {
  isNew.value = false;
  try {
    const detail = await roleService.detail(row.code);
    editing.value = detail;
    form.value = {
      code: detail.code,
      name: detail.name,
      description: detail.description ?? '',
      canFront: detail.canFront,
      canBack: detail.canBack,
      enabled: detail.enabled,
      permissions: [...detail.permissions],
    };
    originalPerms.value = [...detail.permissions];
    affectedUserCount.value = row.userCount ?? detail.userCount ?? 0;
    activeGroups.value = sortedGroups.value.map((g) => g.code);
    dialogVisible.value = true;
  } catch (e) {
    ElMessage.error((e as Error)?.message || '加载角色失败');
  }
}

async function openCopy(row: RoleListRow): Promise<void> {
  isNew.value = true;
  editing.value = null;
  try {
    const { value: newCode } = await ElMessageBox.prompt('请输入新角色的英文标识（code）', `复制角色「${row.name}」`, {
      confirmButtonText: '下一步',
      cancelButtonText: '取消',
      inputValue: `${row.code}_copy`,
      inputPattern: /^[a-z0-9_-]{2,32}$/,
      inputErrorMessage: '仅支持小写字母、数字、下划线、连字符，2-32 位',
    });
    const detail = await roleService.detail(row.code);
    form.value = {
      code: newCode.trim(),
      name: `${row.name} 副本`,
      description: detail.description ?? '',
      canFront: detail.canFront,
      canBack: detail.canBack,
      // 副本默认停用优先。
      enabled: false,
      permissions: [...detail.permissions],
    };
    activeGroups.value = sortedGroups.value.map((g) => g.code);
    dialogVisible.value = true;
  } catch { /* 取消复制 */ }
}

async function save(): Promise<void> {
  if (!form.value.name.trim()) {
    ElMessage.warning('请填写角色名称');
    return;
  }
  if (isNew.value) {
    if (!/^[a-z0-9_-]{2,32}$/.test(form.value.code)) {
      ElMessage.warning('角色标识需为 2-32 位小写字母/数字/下划线/连字符');
      return;
    }
    if (!form.value.canFront && !form.value.canBack) {
      ElMessage.warning('请至少勾选一个登录方向（可登录前台 或 可登录后台）');
      return;
    }
  }
  saving.value = true;
  try {
    if (isNew.value) {
      await roleService.create({
        code: form.value.code.trim(),
        name: form.value.name.trim(),
        description: form.value.description.trim() || null,
        canFront: form.value.canFront,
        canBack: form.value.canBack,
        enabled: form.value.enabled,
        permissions: form.value.permissions,
      });
      ElMessage.success('角色已创建');
    } else {
      const code = editing.value!.code;
      // 相对"打开时"的权限 diff。
      const original = new Set(originalPerms.value);
      const current = new Set(form.value.permissions);
      const added = [...current].filter((c) => !original.has(c));
      const removed = [...original].filter((c) => !current.has(c));
      const permChanged = added.length > 0 || removed.length > 0;

      // 非 admin 且权限点有变化 → 先确认影响人数与 diff。
      if (!permReadonly.value && permChanged) {
        try {
          await ElMessageBox.confirm(
            `权限变更将影响该角色下 ${affectedUserCount.value} 个用户：新增 ${added.length} 项、移除 ${removed.length} 项。是否继续？`,
            '确认权限变更',
            { type: 'warning', confirmButtonText: '继续保存', cancelButtonText: '取消' },
          );
        } catch { return; }
      }

      // 内置角色仅可改启用状态；自定义角色可改全部基本信息。
      if (!isBuiltin.value) {
        await roleService.update(code, {
          name: form.value.name.trim(),
          description: form.value.description.trim() || null,
          canFront: form.value.canFront,
          canBack: form.value.canBack,
          enabled: form.value.enabled,
        });
      } else {
        await roleService.update(code, { enabled: form.value.enabled });
      }
      // 权限点：仅 admin 锁定；非 admin 内置角色放开后也会保存。
      if (!permReadonly.value) {
        await roleService.replacePermissions(code, form.value.permissions);
      }
      ElMessage.success('角色已保存');
    }
    dialogVisible.value = false;
    await loadAll();
  } catch (e) {
    ElMessage.error((e as Error)?.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(row: RoleListRow, enabled: boolean): Promise<void> {
  try {
    await roleService.update(row.code, { enabled });
    ElMessage.success(enabled ? '角色已启用' : '角色已停用');
    await loadAll();
  } catch (e) {
    ElMessage.error((e as Error)?.message || '操作失败');
    await loadAll();
  }
}

async function remove(row: RoleListRow): Promise<void> {
  if (row.isBuiltin) {
    ElMessage.warning('内置角色不可删除（可停用）');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定删除角色「${row.name}」？该操作不可恢复。`,
      '删除角色',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch { return; }
  try {
    await roleService.remove(row.code);
    ElMessage.success('角色已删除');
    await loadAll();
  } catch (e) {
    // 有用户使用 / 内置角色等由后端返回 409。
    ElMessage.error((e as Error)?.message || '删除失败');
    await loadAll();
  }
}

function dirTag(row: RoleListRow): string {
  if (row.canFront && row.canBack) return '前台 + 后台';
  if (row.canFront) return '仅前台';
  if (row.canBack) return '仅后台';
  return '不可登录';
}

onMounted(loadAll);
</script>

<template>
  <div class="sc-page roles-admin">
    <div class="sc-hero">
      <div>
        <div class="sc-eyebrow">SYSTEM · RBAC</div>
        <h1 class="sc-title">角色管理</h1>
        <p class="sc-sub">
          新建角色并按原子权限点逐项勾选；内置角色不可删除，停用优先，仍有用户使用的角色禁止删除。
        </p>
      </div>
      <div class="sc-hero-actions">
        <el-button type="primary" @click="openCreate">新建角色</el-button>
      </div>
    </div>

    <el-table v-loading="loading" :data="roles" class="sc-table" stripe>
      <el-table-column label="角色" min-width="180">
        <template #default="{ row }">
          <div class="role-name">
            <span class="name">{{ row.name }}</span>
            <el-tag v-if="row.isLocked" size="small" type="danger">超级管理员</el-tag>
            <el-tag v-else-if="row.isBuiltin" size="small" type="info">内置</el-tag>
            <el-tag v-else size="small" type="success">自定义</el-tag>
          </div>
          <div class="role-code">{{ row.code }}</div>
          <div v-if="row.description" class="role-desc">{{ row.description }}</div>
        </template>
      </el-table-column>
      <el-table-column label="登录方向" width="130">
        <template #default="{ row }">
          <el-tag size="small" :type="row.canFront || row.canBack ? '' : 'info'">{{ dirTag(row) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="权限数" width="80" align="center">
        <template #default="{ row }">
          <span>{{ row.isLocked ? '全部' : (row.permissionCount ?? 0) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="用户数" width="80" align="center">
        <template #default="{ row }">
          <span>{{ row.userCount ?? 0 }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-switch
            :model-value="row.enabled"
            :disabled="row.isLocked"
            @change="(v: boolean) => toggleEnabled(row, v)"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">
            {{ row.isLocked ? '查看' : '编辑' }}
          </el-button>
          <el-button link type="primary" @click="openCopy(row)">复制</el-button>
          <el-button
            v-if="!row.isBuiltin"
            link
            type="danger"
            :disabled="(row.userCount ?? 0) > 0"
            @click="remove(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="min(760px, 94vw)"
      top="5vh"
      class="role-dialog"
    >
      <el-form label-position="top" class="role-form">
        <div class="form-grid">
          <el-form-item label="角色标识（code，创建后不可改）">
            <el-input
              v-model="form.code"
              :disabled="!isNew"
              placeholder="如 property"
            />
          </el-form-item>
          <el-form-item label="角色名称">
            <el-input v-model="form.name" :disabled="basicReadonly" placeholder="如 物业" />
          </el-form-item>
        </div>
        <el-form-item label="说明">
          <el-input
            v-model="form.description"
            :disabled="basicReadonly"
            type="textarea"
            :rows="2"
            placeholder="该角色的职责说明"
          />
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="可登录 PWA 前台">
            <el-switch v-model="form.canFront" :disabled="basicReadonly" />
          </el-form-item>
          <el-form-item label="可登录后台">
            <el-switch v-model="form.canBack" :disabled="basicReadonly" />
          </el-form-item>
          <el-form-item label="启用状态">
            <el-switch
              :model-value="form.enabled"
              :disabled="isLocked"
              @update:model-value="(v: boolean) => (form.enabled = v)"
            />
            <span class="form-hint">{{ form.enabled ? '启用' : '停用（默认停用优先）' }}</span>
          </el-form-item>
        </div>

        <el-alert
          v-if="isLocked"
          type="info"
          :closable="false"
          show-icon
          title="超级管理员默认拥有全部权限，不可停用、不可删除、不可修改。"
          class="perm-alert"
        />
        <el-alert
          v-else-if="isBuiltin"
          type="info"
          :closable="false"
          show-icon
          title="岗位名称与登录方向保持系统定义；功能权限可在下方按权限点增减，可一键「恢复默认」，改动将影响该角色下所有用户。"
          class="perm-alert"
        />

        <el-divider content-position="left">
          <span>功能权限（按分组勾选）</span>
          <el-button
            v-if="isBuiltin && !isLocked && isCustomized"
            link
            type="warning"
            size="small"
            class="restore-btn"
            @click="restoreDefault"
          >
            恢复默认
          </el-button>
        </el-divider>
        <el-collapse v-model="activeGroups" class="perm-collapse">
          <el-collapse-item
            v-for="g in sortedGroups"
            :key="g.code"
            :name="g.code"
          >
            <template #title>
              <span class="group-title">{{ g.name }}</span>
              <el-tag size="small" class="group-count">
                {{ groupCheckedCount(g.code) }} / {{ permsOfGroup(g.code).length }}
              </el-tag>
            </template>
            <el-checkbox
              class="group-all"
              :model-value="isGroupAllChecked(g.code)"
              :disabled="permReadonly"
              @change="(v: boolean) => toggleGroup(g.code, v)"
            >
              全选本组
            </el-checkbox>
            <el-checkbox-group v-model="form.permissions" :disabled="permReadonly" class="perm-grid">
              <el-checkbox
                v-for="p in permsOfGroup(g.code)"
                :key="p.code"
                :value="p.code"
                :class="permClass(p.code)"
              >
                <span class="perm-label">{{ p.name }}</span>
                <code class="perm-code">{{ p.code }}</code>
                <span v-if="permDelta(p.code) === 'added'" class="delta-tag added">新增</span>
                <span v-else-if="permDelta(p.code) === 'removed'" class="delta-tag removed">移除</span>
              </el-checkbox>
            </el-checkbox-group>
          </el-collapse-item>
        </el-collapse>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button v-if="!isLocked" type="primary" :loading="saving" @click="save">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.roles-admin {
  max-width: 1080px;
  margin: 0 auto;
}
.sc-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.role-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.role-code {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  margin-top: 2px;
}
.role-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}
.dir-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-hint {
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.perm-alert {
  margin: 8px 0 4px;
}
.group-title {
  font-weight: 600;
  margin-right: 10px;
}
.group-count {
  margin-left: 4px;
}
.group-all {
  margin-bottom: 10px;
  font-weight: 600;
}
.perm-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
}
.perm-grid :deep(.el-checkbox) {
  align-items: flex-start;
  height: auto;
  margin-right: 0;
  white-space: normal;
}
.perm-grid :deep(.el-checkbox__label) {
  white-space: normal;
  line-height: 1.35;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
}
.perm-label {
  min-width: 0;
}
.perm-code {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  padding: 1px 5px;
  border-radius: 4px;
  word-break: break-all;
}
.restore-btn {
  margin-left: 12px;
  vertical-align: middle;
}
.delta-tag {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 4px;
  margin-left: 2px;
}
.delta-tag.added {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}
.delta-tag.removed {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
/* 人工新增 / 移除的权限点整体轻染色 */
.perm-added :deep(.el-checkbox__label) {
  color: var(--el-color-success-dark-2);
}
.perm-removed :deep(.el-checkbox__label) {
  color: var(--el-color-danger-dark-2);
}
@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
  .perm-grid {
    grid-template-columns: 1fr;
  }
  .role-dialog :deep(.el-dialog) {
    width: 94vw !important;
  }
  /* 手机端表格横向滚动，避免固定列遮挡导致文字重叠 */
  .sc-table :deep(.el-table-fixed-column--right) {
    position: static !important;
  }
}
</style>
