declare const __FRONTEND_BUILD_ID__: string;
declare const __FRONTEND_VERSION_URL__: string;

const listeners = new Set<(build: string) => void>();
let latestBuild: string | undefined;

/** Existing authenticated sockets deliver both publication and reconnect hello. */
export function notifyFrontendBuild(build: unknown): void {
  if (typeof build !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(build)) return;
  latestBuild = build;
  listeners.forEach(listener => listener(build));
}

export function startPwaUpdateMonitor(onUpdate: () => void): () => void {
  const workers = navigator.serviceWorker;
  let target: string | undefined;
  let verified: string | undefined;
  let checking = false, stopped = false, reloading = false, attempts = 0;
  let retryTimer: number | undefined, reloadTimer: number | undefined;
  let request: AbortController | undefined;
  let detachInstallation: (() => void) | undefined;
  const retryDelays = [1000, 5000, 15000];

  const retry = () => {
    if (!stopped && target && retryTimer === undefined && attempts < retryDelays.length) {
      retryTimer = window.setTimeout(() => { retryTimer = undefined; void check(); }, retryDelays[attempts++]);
    }
  };

  const reload = () => {
    if (stopped || reloading || !verified || verified !== target) return;
    // A broken/intercepting cache must not cause an endless reload cycle.
    try {
      if (sessionStorage.getItem('sc.pwa.reloadBuild') === verified) return;
      sessionStorage.setItem('sc.pwa.reloadBuild', verified);
    } catch { /* Storage can be unavailable on restricted clients. */ }
    reloading = true;
    onUpdate();
    reloadTimer = window.setTimeout(() => window.location.reload(), 300);
  };

  const check = async () => {
    if (stopped || checking || reloading || !target || target === __FRONTEND_BUILD_ID__) return;
    checking = true;
    const expected = target;
    request = new AbortController();
    const timeout = window.setTimeout(() => request?.abort(), 5000);
    try {
      // Verify the served build, not just the API version. This origin may still
      // have old assets during publication or point to another environment.
      const response = await fetch(__FRONTEND_VERSION_URL__, { cache: 'no-store', signal: request.signal });
      if (!response.ok || (await response.json()).frontendBuildId !== expected) throw new Error('Build not ready');
      if (stopped || target !== expected) return;
      verified = expected;
      const registration = await workers?.getRegistration();
      if (stopped || target !== expected) return;
      if (!registration) { reload(); return; } // HTTP LAN browsers without SW.
      await registration.update();
      if (stopped || target !== expected) return;
      // If already activated before the notification, no controllerchange will
      // follow. Otherwise wait for activation before reloading into the new SW.
      const installing = registration.installing ?? registration.waiting;
      if (!installing) reload();
      else {
        detachInstallation?.();
        const stateChanged = () => {
          if (stopped || target !== expected) return;
          if (installing.state === 'activated') { detachInstallation?.(); reload(); }
          else if (installing.state === 'redundant') { detachInstallation?.(); verified = undefined; retry(); }
        };
        installing.addEventListener('statechange', stateChanged);
        detachInstallation = () => installing.removeEventListener('statechange', stateChanged);
        stateChanged();
      }
    } catch {
      verified = undefined;
      retry();
    } finally {
      window.clearTimeout(timeout);
      checking = false;
      if (!stopped && target !== expected) void check();
    }
  };

  const receive = (build: string) => {
    if (build === __FRONTEND_BUILD_ID__) {
      target = undefined;
      verified = undefined;
      detachInstallation?.();
      request?.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      return;
    }
    if (build !== target) { detachInstallation?.(); verified = undefined; attempts = 0; }
    target = build;
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    retryTimer = undefined;
    void check();
  };
  const resume = () => {
    if (document.visibilityState === 'visible' && target) { attempts = 0; void check(); }
  };
  listeners.add(receive);
  workers?.addEventListener('controllerchange', reload);
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  if (latestBuild) receive(latestBuild);
  return () => {
    stopped = true;
    request?.abort();
    detachInstallation?.();
    listeners.delete(receive);
    workers?.removeEventListener('controllerchange', reload);
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', resume);
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
  };
}
