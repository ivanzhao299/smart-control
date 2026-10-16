import { computed, ref, onMounted, onScopeDispose } from 'vue';
import { api, getAdminToken, getClientToken } from './http';
import { onIdentityChange, invalidateIdentity } from './identity-boundary';
import type { MediaItem } from './media.service';

export interface CurrentActor { kind: 'user' | 'admin' | 'legacy'; userId: number | null; username: string; role: 'admin' | 'operator' | 'viewer' }
/** Server-authoritative, fail-closed role state for mounted UI. */
export function useCurrentActor() {
  const actor = ref<CurrentActor | null>(null);
  let revision = 0;
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  async function refreshActor() {
    const request = ++revision;
    if (!getAdminToken() && !getClientToken()) { actor.value = null; return; }
    try {
      const result = await api.get<CurrentActor>('/client-auth/me');
      if (!disposed && request === revision) {
        // Role revocation must also evict already-rendered administrator data,
        // not merely hide buttons while leaving the private list visible.
        if (actor.value && JSON.stringify(actor.value) !== JSON.stringify(result)) {
          invalidateIdentity();
          return;
        }
        actor.value = result;
      }
    } catch {
      if (!disposed && request === revision) {
        const hadIdentity = actor.value !== null;
        actor.value = null;
        if (hadIdentity) invalidateIdentity();
      }
    }
  }
  const unsubscribe = onIdentityChange(() => {
    revision++;
    actor.value = null;
    // A successful admin unlock/account change should refresh mounted controls
    // immediately rather than leave them read-only until the next 30s poll.
    if (!disposed) void refreshActor();
  });
  onMounted(() => { void refreshActor(); timer = setInterval(() => void refreshActor(), 30_000); });
  onScopeDispose(() => { disposed = true; revision++; actor.value = null; unsubscribe(); if (timer) clearInterval(timer); });
  const isAdmin = computed(() => actor.value?.role === 'admin');
  const canOperate = computed(() => isAdmin.value || actor.value?.role === 'operator');
  // 操作员个人账号（kind==='user'、带 userId），排除 legacy 共享令牌（对齐后端 resource-policy）。
  const isOperatorPersonal = computed(() => actor.value?.kind === 'user'
    && actor.value?.role === 'operator' && actor.value.userId !== null);
  // 改名/备注（2026-10-16 #65 放宽）：admin 或操作员个人账号可改任意非内置素材的文件名/备注，
  // 不再要求是上传者本人；但归属/公开状态仍仅管理员（由后端 updateOwned 拦截）。
  const canEditMedia = (media: MediaItem) => media.source !== 'system' && (isAdmin.value || isOperatorPersonal.value);
  // 删除/转码（对齐后端 assertWriteResource）：仅可管理「自己的私人资料」，
  // 即本人上传且非共享；公共素材与他人素材只有管理员能删/重转。
  const canDeleteMedia = (media: MediaItem) => {
    if (media.source === 'system') return false;
    if (isAdmin.value) return true;
    return isOperatorPersonal.value
      && media.ownerUserId === actor.value?.userId
      && media.visibility !== 'shared';
  };
  return { actor, isAdmin, canOperate, isOperatorPersonal, canEditMedia, canDeleteMedia, refreshActor };
}
