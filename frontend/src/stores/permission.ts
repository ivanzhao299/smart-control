import { defineStore } from 'pinia';
import { computed, ref, onScopeDispose } from 'vue';
import type { UserRole } from '@/types/api';
import { api, getAdminToken, getClientToken } from '@/services/http';
import { identityGeneration, onIdentityChange } from '@/services/identity-boundary';

/** UI permissions follow the verified server identity, never a local role selector. */
export const usePermissionStore = defineStore('permission', () => {
  const role = ref<UserRole>('viewer');
  let revision = 0;

  const canEdit = computed(() => role.value === 'admin');
  const canExecute = computed(() => role.value === 'admin' || role.value === 'operator');
  const canView = computed(() => true);

  async function refresh(): Promise<void> {
    const request = ++revision;
    const identity = identityGeneration();
    role.value = 'viewer';
    if (!getAdminToken() && !getClientToken()) return;
    try {
      const actor = await api.get<{ role: UserRole }>('/client-auth/me');
      if (request === revision && identity === identityGeneration() && ['admin', 'operator', 'viewer'].includes(actor.role)) role.value = actor.role;
    } catch { /* Remain read-only when identity cannot be verified. */ }
  }
  onScopeDispose(onIdentityChange(() => { void refresh(); }));

  function canDoAction(action: 'view' | 'execute' | 'edit'): boolean {
    if (action === 'view') return canView.value;
    if (action === 'execute') return canExecute.value;
    return canEdit.value;
  }

  return { role, canEdit, canExecute, canView, refresh, canDoAction };
});
