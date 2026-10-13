import { defineStore } from 'pinia';
import { computed, ref, onScopeDispose } from 'vue';
import type { UserRole } from '@/types/api';
import { api, getAdminToken, getClientToken } from '@/services/http';
import { identityGeneration, onIdentityChange } from '@/services/identity-boundary';
import {
  BACKEND_ROLES,
  canAccessAdminModule,
  canWriteAdminModule,
  type AdminModule,
} from '@/router/admin-rbac';

const ALL_ROLES: readonly UserRole[] = ['admin', 'hardware', 'config', 'operator', 'viewer'];

/** UI permissions follow the verified server identity, never a local role selector. */
export const usePermissionStore = defineStore('permission', () => {
  const role = ref<UserRole>('viewer');
  // 是否已完成一次角色拉取。role 默认值是 'viewer'，不能用 !role 判断是否加载过；
  // 后台路由守卫据此决定是否 await refresh, 否则会把后台角色误判为 viewer 而拦截。
  const loaded = ref(false);
  let revision = 0;

  // 前台 PWA 的编辑/执行维持原语义：hardware/config 为后台角色, 日常入口在后台。
  const canEdit = computed(() => role.value === 'admin');
  const canExecute = computed(() => role.value === 'admin' || role.value === 'operator');
  const canView = computed(() => true);
  // 可登录后台的角色。
  const isBackend = computed(() => BACKEND_ROLES.includes(role.value));

  async function refresh(): Promise<void> {
    const request = ++revision;
    role.value = 'viewer';
    if (!getAdminToken() && !getClientToken()) {
      loaded.value = true;
      return;
    }
    // 整页启动/登录瞬间, token 注入会触发一次 identity 边界切换, 第一个 /me
    // 请求可能被判定为"账户已切换"而 abort。对 AbortError 重试一次(与 admin
    // 登录态校验一致), 避免角色停留在默认 viewer 而把后台用户误拦在登录页。
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (request !== revision) return; // 已被更新的一次 refresh 取代
      const generation = identityGeneration();
      try {
        const actor = await api.get<{ role: UserRole }>('/client-auth/me');
        if (request === revision && identityGeneration() === generation && ALL_ROLES.includes(actor.role)) {
          role.value = actor.role;
        }
        break;
      } catch (error) {
        const aborted = (error as Error)?.name === 'AbortError';
        if (aborted && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 60));
          continue;
        }
        break;
      }
    }
    loaded.value = true;
  }
  onScopeDispose(onIdentityChange(() => { void refresh(); }));

  function canDoAction(action: 'view' | 'execute' | 'edit'): boolean {
    if (action === 'view') return canView.value;
    if (action === 'execute') return canExecute.value;
    return canEdit.value;
  }

  /** 后台某分域菜单/页面是否可见。 */
  function canAccessModule(module: AdminModule): boolean {
    return canAccessAdminModule(role.value, module);
  }

  /** 后台某分域是否可写。 */
  function canWriteModule(module: AdminModule): boolean {
    return canWriteAdminModule(role.value, module);
  }

  return {
    role,
    loaded,
    canEdit,
    canExecute,
    canView,
    isBackend,
    refresh,
    canDoAction,
    canAccessModule,
    canWriteModule,
  };
});
