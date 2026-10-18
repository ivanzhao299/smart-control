import { defineStore } from 'pinia';
import { computed, ref, onScopeDispose } from 'vue';
import { api, getAdminToken, getClientToken } from '@/services/http';
import { identityGeneration, onIdentityChange } from '@/services/identity-boundary';
import {
  canAccessAdminModuleByPerms,
  canWriteAdminModuleByPerms,
  type AdminModule,
} from '@/router/admin-rbac';

/** 前台 /me 身份（动态 RBAC）。 */
interface MeIdentity {
  role: string;
  roleName?: string;
  permissions?: string[];
  canFront?: boolean;
  canBack?: boolean;
}

/** UI permissions follow the verified server identity, never a local role selector. */
export const usePermissionStore = defineStore('permission', () => {
  // 角色 code 支持动态自定义角色；默认 viewer（fail-closed）。
  const role = ref<string>('viewer');
  // 角色显示名（后端 /me 返回，自定义角色也有中文名）。
  const roleName = ref<string>('');
  // 当前角色持有的原子权限点集合（admin 为全集，由后端返回）。
  const permissions = ref<ReadonlySet<string>>(new Set());
  // 登录方向。
  const canFront = ref(false);
  const canBack = ref(false);
  // 是否已完成一次身份拉取。role 默认 'viewer'，不能用 !role 判断是否加载过；
  // 后台路由守卫据此决定是否 await refresh, 否则会把后台角色误判为 viewer 而拦截。
  const loaded = ref(false);
  let revision = 0;

  const isAdmin = computed(() => role.value === 'admin');
  // 前台 PWA 的编辑/执行维持原语义（过渡别名，P3 起逐步由权限点取代）：
  // canEdit 仅 admin；canExecute 为 admin / operator。
  const canEdit = computed(() => role.value === 'admin');
  const canExecute = computed(() => role.value === 'admin' || role.value === 'operator');
  const canView = computed(() => true);
  // 可登录后台的角色（动态：以后端 /me 的 canBack 为准）。
  const isBackend = computed(() => canBack.value);

  /** 是否拥有某原子权限点；admin 恒为真（后端返回全集，双保险）。 */
  function hasPermission(code: string): boolean {
    if (role.value === 'admin') return true;
    return permissions.value.has(code);
  }

  /** 拥有任一权限点即可（多码 OR）。 */
  function hasAnyPermission(codes: readonly string[]): boolean {
    if (role.value === 'admin') return true;
    return codes.some((c) => permissions.value.has(c));
  }

  async function refresh(): Promise<void> {
    const request = ++revision;
    // fail-closed：拉取瞬间先回到最小权限。
    role.value = 'viewer';
    roleName.value = '';
    permissions.value = new Set();
    canFront.value = false;
    canBack.value = false;
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
        const actor = await api.get<MeIdentity>('/client-auth/me');
        if (request === revision && identityGeneration() === generation && actor.role) {
          role.value = actor.role;
          roleName.value = actor.roleName ?? actor.role;
          permissions.value = new Set(actor.permissions ?? []);
          canFront.value = actor.canFront ?? false;
          canBack.value = actor.canBack ?? false;
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

  /** 后台某分域菜单/页面是否可见（内置角色走旧矩阵，自定义角色走权限点）。 */
  function canAccessModule(module: AdminModule): boolean {
    return canAccessAdminModuleByPerms(role.value, permissions.value, module);
  }

  /** 后台某分域是否可写。 */
  function canWriteModule(module: AdminModule): boolean {
    return canWriteAdminModuleByPerms(role.value, permissions.value, module);
  }

  return {
    role,
    roleName,
    permissions,
    canFront,
    canBack,
    loaded,
    isAdmin,
    canEdit,
    canExecute,
    canView,
    isBackend,
    hasPermission,
    hasAnyPermission,
    refresh,
    canDoAction,
    canAccessModule,
    canWriteModule,
  };
});
