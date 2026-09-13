// Monotonic generation: switching A -> B -> A must still invalidate A's old work.
let generation = 0;
const listeners = new Set<() => void>();
const serverListeners = new Set<() => void>();
export function onServerChange(listener: () => void): () => void {
  serverListeners.add(listener);
  return () => serverListeners.delete(listener);
}
export function notifyServerChange(): void {
  for (const listener of serverListeners) {
    try { listener(); } catch { /* Continue clearing other identities. */ }
  }
}
export const identityGeneration = () => generation;
/** Recheck after dialogs and between sequential requests, before starting work. */
export function captureIdentityGuard(isActive: () => boolean = () => true): () => boolean {
  const expected = generation;
  return () => expected === generation && isActive();
}
/** Each new read invalidates older reads, including their late error handlers. */
export function createLatestIdentityRead(isActive: () => boolean = () => true): () => (() => boolean) {
  let revision = 0;
  return () => {
    const expected = ++revision;
    return captureIdentityGuard(() => expected === revision && isActive());
  };
}
export function invalidateIdentity(): void {
  generation += 1;
  for (const listener of listeners) {
    try { listener(); } catch { /* One component must not prevent other cleanup. */ }
  }
}
export function onIdentityChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function assertCurrentIdentity(expected: number): void {
  if (expected !== generation) throw new DOMException('账户或服务器已切换，请重新加载', 'AbortError');
}
