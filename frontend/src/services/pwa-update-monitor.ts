/** Keep always-visible kiosk pages current after a frontend-only release. */
export function startPwaUpdateMonitor(onUpdate: () => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {};
  const workers = navigator.serviceWorker;
  const reloadKey = 'sc.pwa.updatedReload';
  let controller = workers.controller;
  let checking = false;
  let reloadScheduled = false;
  let pendingUpdate = false;
  let stopped = false;
  let reloadTimer: number | undefined;
  const unlockTimer = window.setTimeout(() => {
    try { sessionStorage.removeItem(reloadKey); } catch { /* Storage may be unavailable. */ }
    if (pendingUpdate) scheduleReload();
  }, 5000);

  const scheduleReload = (): void => {
    if (reloadScheduled || stopped) return;
    try {
      if (sessionStorage.getItem(reloadKey)) return;
      sessionStorage.setItem(reloadKey, '1');
    } catch { /* Per-document guard still prevents duplicate reloads. */ }
    reloadScheduled = true;
    onUpdate();
    reloadTimer = window.setTimeout(() => window.location.reload(), 300);
  };
  const controllerChanged = (): void => {
    const next = workers.controller;
    if (!next || next === controller) return;
    const wasControlled = !!controller;
    controller = next;
    // First installation may claim this document. Remember that controller so
    // a later deployment in the same long-lived session still triggers reload.
    if (!wasControlled) return;
    pendingUpdate = true;
    scheduleReload();
  };

  const check = (): void => {
    if (stopped || checking || document.visibilityState !== 'visible') return;
    checking = true;
    void workers.ready.then(registration => {
      if (!stopped) return registration.update();
    }).catch(() => {
      // Offline players retain their current content and retry on the next tick.
    }).finally(() => { checking = false; });
  };
  workers.addEventListener('controllerchange', controllerChanged);
  document.addEventListener('visibilitychange', check);
  // Kiosks do not normally leave the foreground, so visibilitychange alone
  // never detects a release while they keep rendering and sending heartbeats.
  const interval = window.setInterval(check, 60_000);
  check();
  return () => {
    stopped = true;
    window.clearInterval(interval);
    window.clearTimeout(unlockTimer);
    if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
    workers.removeEventListener('controllerchange', controllerChanged);
    document.removeEventListener('visibilitychange', check);
  };
}
