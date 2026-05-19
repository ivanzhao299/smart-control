import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { UserRole } from '@/types/api';

/**
 * 简易前端权限 store (Sprint-06 阶段)
 * - 当前没有完整鉴权后端, 角色仅作为前端 UI 显示控制
 * - 默认 admin, 可在右上角切换
 * - 持久化到 localStorage
 */

const STORAGE_KEY = 'sc.role';

const VALID: UserRole[] = ['admin', 'operator', 'viewer'];

function loadInitial(): UserRole {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (VALID as string[]).includes(raw)) return raw as UserRole;
  } catch {
    // ignore
  }
  return 'admin';
}

export const usePermissionStore = defineStore('permission', () => {
  const role = ref<UserRole>(loadInitial());

  const canEdit = computed(() => role.value === 'admin');
  const canExecute = computed(() => role.value === 'admin' || role.value === 'operator');
  const canView = computed(() => true);

  function setRole(r: UserRole): void {
    role.value = r;
    try {
      localStorage.setItem(STORAGE_KEY, r);
    } catch {
      // ignore
    }
  }

  function canDoAction(action: 'view' | 'execute' | 'edit'): boolean {
    if (action === 'view') return canView.value;
    if (action === 'execute') return canExecute.value;
    return canEdit.value;
  }

  return { role, canEdit, canExecute, canView, setRole, canDoAction };
});
