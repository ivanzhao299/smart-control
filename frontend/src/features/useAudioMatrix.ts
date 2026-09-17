import { onScopeDispose, ref } from 'vue';
import { audioService } from '@/services/audio.service';
import { captureIdentityGuard, onIdentityChange } from '@/services/identity-boundary';

const POLL_MS = 8000;
const RECONCILE_MS = 1200;

/** Owns only matrix reads/writes. Presets, faders and playlist playback stay separate. */
export function useAudioMatrix(reportError: (message: string) => void) {
  const matrixOn = ref<Record<string, boolean>>({});
  const matrixStale = ref(false);
  const matrixOffline = ref(false);
  const matrixErrMsg = ref('');
  const pendingWrites = ref(0);
  let active = true;
  let disposed = false;
  let polling = false;
  let epoch = 0;
  let readRevision = 0;
  let writeRevision = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  type Write = { desired: boolean | undefined; confirmed: boolean };
  const writes = new Map<string, Write>();
  const capture = () => {
    const expected = epoch;
    return captureIdentityGuard(() => active && !disposed && expected === epoch);
  };
  const clearTimers = () => {
    if (pollTimer !== null) clearTimeout(pollTimer);
    if (reconcileTimer !== null) clearTimeout(reconcileTimer);
    pollTimer = null;
    reconcileTimer = null;
  };

  async function loadMatrixState(): Promise<void> {
    const current = capture();
    if (!current() || pendingWrites.value > 0) return;
    const read = ++readRevision;
    const write = writeRevision;
    const canApply = () => current() && read === readRevision && write === writeRevision && pendingWrites.value === 0;
    try {
      const result = await audioService.getLiveMatrix();
      if (!canApply()) return;
      if (!result.ok || !result.data?.matrix) throw new Error(result.error || '读矩阵失败');
      const next: Record<string, boolean> = {};
      result.data.matrix.forEach((row, out) => row.forEach((on, input) => { next[`${out}_${input}`] = on; }));
      matrixOn.value = next;
      matrixStale.value = false;
      matrixOffline.value = false;
      matrixErrMsg.value = '';
    } catch (error) {
      if (!canApply()) return;
      matrixStale.value = true;
      matrixErrMsg.value = (error as Error).message || '';
      matrixOffline.value = /离线|连不上|offline|timed?\s*out|timeout/i.test(matrixErrMsg.value);
    }
  }

  function schedulePoll(): void {
    if (!active || disposed || !polling || pollTimer !== null) return;
    const current = capture();
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (!current()) return;
      if (!document.hidden && pendingWrites.value === 0 && reconcileTimer === null) await loadMatrixState();
      // A leave/re-enter cycle cannot let an old awaited read start a second loop.
      if (current()) schedulePoll();
    }, POLL_MS);
  }

  function scheduleReconcile(): void {
    if (!active || disposed) return;
    if (reconcileTimer !== null) clearTimeout(reconcileTimer);
    const current = capture();
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      if (current() && !document.hidden && pendingWrites.value === 0) void loadMatrixState();
    }, RECONCILE_MS);
  }

  function startMatrixPolling(): void {
    if (disposed) return;
    active = true;
    polling = true;
    schedulePoll();
  }

  function stopMatrixPolling(): void {
    active = false;
    polling = false;
    epoch += 1;
    clearTimers();
    if (pendingWrites.value > 0) matrixStale.value = true;
    writes.clear();
    pendingWrites.value = 0;
  }

  function isMatrixOn(out: number, input: number): boolean {
    return !!matrixOn.value[`${out}_${input}`];
  }

  async function toggleMatrix(out: number, input: number): Promise<void> {
    const current = capture();
    if (!current()) return;
    const key = `${out}_${input}`;
    const before = isMatrixOn(out, input);
    const desired = !before;
    writeRevision += 1; // Invalidates reads issued before this user intent, even after writes settle.
    matrixOn.value = { ...matrixOn.value, [key]: desired };
    const running = writes.get(key);
    if (running) { running.desired = desired; return; }
    const operation: Write = { desired, confirmed: before };
    writes.set(key, operation);
    pendingWrites.value += 1;
    let failed = false;
    try {
      while (current() && operation.desired !== undefined) {
        const value = operation.desired;
        operation.desired = undefined;
        const result = await audioService.setMatrix(out, input, value);
        if (!current()) return;
        if (!result.ok) throw new Error(result.error || '设备未确认');
        operation.confirmed = value;
      }
    } catch (error) {
      if (!current()) return;
      failed = true;
      matrixOn.value = { ...matrixOn.value, [key]: operation.confirmed };
      matrixStale.value = true;
      reportError(`路由 OUT${out + 1}←IN${input + 1} 失败: ${(error as Error).message}`);
    } finally {
      // Late completions must not remove a new account/activation's write of the same key.
      if (current() && writes.get(key) === operation) {
        writes.delete(key);
        pendingWrites.value -= 1;
        if (failed && pendingWrites.value === 0) {
          if (reconcileTimer !== null) clearTimeout(reconcileTimer);
          reconcileTimer = null;
          if (!document.hidden) void loadMatrixState();
        } else scheduleReconcile();
      }
    }
  }

  const unsubscribe = onIdentityChange(() => {
    const resume = active && polling;
    const wasActive = active;
    stopMatrixPolling();
    active = wasActive;
    matrixOn.value = {};
    matrixStale.value = true;
    matrixOffline.value = false;
    matrixErrMsg.value = '';
    if (resume) startMatrixPolling();
  });
  onScopeDispose(() => { stopMatrixPolling(); disposed = true; unsubscribe(); });

  return { matrixOn, matrixStale, matrixOffline, matrixErrMsg, pendingWrites,
    isMatrixOn, loadMatrixState, toggleMatrix, startMatrixPolling, stopMatrixPolling };
}
