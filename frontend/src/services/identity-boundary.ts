// Monotonic generation: switching A -> B -> A must still invalidate A's old work.
let generation = 0;
const listeners = new Set<() => void>();
export const identityGeneration = () => generation;
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
