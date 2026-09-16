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
  const canEditMedia = (media: MediaItem) => media.source !== 'system' && (isAdmin.value ||
    (actor.value?.role === 'operator' && actor.value.userId !== null && media.ownerUserId === actor.value.userId && media.visibility === 'private'));
  return { actor, isAdmin, canOperate, canEditMedia, refreshActor };
}
