const identityKeys = new Set([
  'sc.client.token', 'sc.client.token.expiresAt', 'sc.client.authServer', 'sc.client.baseURL',
]);

/** Do not write localStorage here: another tab may just have committed a new login. */
export function installCrossTabIdentitySync(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  storage: Storage | (() => Storage),
  invalidate: () => void,
  reload: () => void,
): () => void {
  // Accessing window.localStorage itself can throw SecurityError in a restricted
  // browser. Resolve it here, not in the caller's setup expression. No shared
  // storage means no cross-tab channel; do not invent a persisted identity.
  let local: Storage;
  try { local = typeof storage === 'function' ? storage() : storage; }
  catch { return () => undefined; }
  let pending = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listener = (event: StorageEvent) => {
    if (disposed || event.storageArea !== local || (event.key !== null && !identityKeys.has(event.key))) return;
    if (event.key !== null && event.oldValue === event.newValue) return;
    if (pending) return;
    pending = true;
    // Immediately stop stale requests and discard displayed data, before reload.
    invalidate();
    // Login writes several keys synchronously. Let that batch finish, then rebuild
    // every store from one authoritative storage snapshot rather than merge users.
    timer = setTimeout(() => { if (!disposed) reload(); }, 50);
  };
  target.addEventListener('storage', listener as EventListener);
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    target.removeEventListener('storage', listener as EventListener);
  };
}
