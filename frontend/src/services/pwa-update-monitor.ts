import { recoverFromStalePwa } from './pwa-recovery';

declare const __FRONTEND_BUILD_ID__: string;
declare const __FRONTEND_VERSION_URL__: string;

/**
 * PWA 更新监控（prompt 模式）
 *
 * 检测来源（多路，任一命中即可）：
 *   - 冷启动后立即主动核对；
 *   - 页面从后台回到前台（visibilitychange）/ 重新联网（online）；
 *   - WebSocket 推送 hello / frontend_release（仅作即时触发，版本仍以 fetch 为准）。
 *
 * 检测方式：fetch 根目录 deployment-version.json（不进 SW precache、cache:no-store），
 * 与当前构建 __FRONTEND_BUILD_ID__ 比较；不同则 registration.update() 拉取 waiting SW，
 * 就绪后通过 onReady 把 apply 交给全局横幅。用户点“立即更新”才 postMessage
 * SKIP_WAITING 激活并 reload；点“稍后”则本次不提示，回前台后再提示。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

/**
 * 硬兜底标记（2026-10-17 #139）：iOS 独立壳 WKWebView 中，Service Worker 在 App
 * 被杀、同一原生版本未升级时不会清理，且 SKIP_WAITING/controllerchange 偶发不触发，
 * 导致现场长期停在旧版（普通 reload 仍被旧 SW 劫持）。
 * 当检测到新版本但 SW 正常激活路径走不通时，注销 SW + 清 precache 后硬重载。
 * 对同一个目标 build 只硬清一次，防止极端网络下反复注销/刷新；一旦成功加载到新版，
 * detect 会删除全部历史标记，下次部署仍可再次兜底。
 */
const HARD_RECOVER_PREFIX = 'sc.pwa.hardRecover.';
function hardRecoverFor(target: string): boolean {
  const key = HARD_RECOVER_PREFIX + target;
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
  } catch {
    if (sessionStorage.getItem(key)) return false;
    try { sessionStorage.setItem(key, '1'); } catch { /* restricted */ }
  }
  void recoverFromStalePwa();
  return true;
}
function clearHardRecoverMarks(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(HARD_RECOVER_PREFIX)) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch { /* restricted */ }
}

// WebSocket 通知的最新 build（保留对外能力）。
const buildListeners = new Set<(build: string) => void>();
let latestBuild: string | undefined;

/** Existing authenticated sockets deliver both publication and reconnect hello. */
export function notifyFrontendBuild(build: unknown): void {
  if (!isUuid(build)) return;
  latestBuild = build;
  buildListeners.forEach((listener) => listener(build));
}

export function latestFrontendBuild(): string | undefined {
  return latestBuild;
}

export interface PwaUpdateHandlers {
  /** 新版本已就绪（SW waiting）；参数 apply 由用户点击后调用以激活并刷新。 */
  onReady: (apply: () => void) => void;
  /** 用户确认、即将刷新时回调（用于 UI 状态）。 */
  onApplying?: () => void;
}

export interface PwaUpdateHandle {
  stop: () => void;
  /** 用户点“稍后”：本次关闭提示，回前台/再次通知后才重新提示。 */
  dismiss: () => void;
}

export function startPwaUpdateMonitor(handlers: PwaUpdateHandlers): PwaUpdateHandle {
  const workers = navigator.serviceWorker;
  let stopped = false;
  let target: string | undefined; // 待应用的 build
  let dismissed = false; // 用户点了“稍后”
  let checking = false;

  const reloadFallback = new Set<number>();

  // 防刷新循环：同一 build 已 reload 过就不再自动刷。
  const beginReload = (): void => {
    if (!target) return;
    try {
      if (sessionStorage.getItem('sc.pwa.reloadBuild') === target) return;
      sessionStorage.setItem('sc.pwa.reloadBuild', target);
    } catch {
      /* Storage can be unavailable on restricted clients. */
    }
    handlers.onApplying?.();
    window.setTimeout(() => window.location.reload(), 150);
  };

  // 让 waiting SW 跳过等待，接管后刷新。
  const activateWaiting = (waiting: ServiceWorker): (() => void) => {
    let done = false;
    const onController = (): void => {
      if (done || stopped) return;
      done = true;
      cleanup();
      beginReload();
    };
    const cleanup = (): void => {
      workers?.removeEventListener('controllerchange', onController);
      reloadFallback.forEach((t) => window.clearTimeout(t));
      reloadFallback.clear();
    };
    workers?.addEventListener('controllerchange', onController);
    const timer = window.setTimeout(() => {
      if (!done) {
        done = true;
        cleanup();
        handlers.onApplying?.();
        // controllerchange 迟迟不来(典型 iOS 独立壳: 旧 SW 不主动让位): 普通 reload 仍被
        // 旧 SW 劫持, 改为注销 SW + 清 precache 后硬重载; 已对该版本硬清过则退回普通 reload。
        if (!target || !hardRecoverFor(target)) beginReload();
      }
    }, 4000);
    reloadFallback.add(timer);
    try {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      cleanup();
      beginReload();
    }
    return cleanup;
  };

  const present = (apply: () => void): void => {
    if (dismissed) return;
    handlers.onReady(apply);
  };

  // 新 SW 就绪后给出提示。
  const offer = async (): Promise<void> => {
    if (!target) return;
    const expected = target;

    if (!workers) {
      present(beginReload); // 无 SW 的 LAN 浏览器：刷新即可。
      return;
    }
    let registration: ServiceWorkerRegistration | undefined;
    try {
      registration = await workers.getRegistration();
    } catch {
      registration = undefined;
    }
    if (!registration) {
      present(beginReload);
      return;
    }
    try {
      await registration.update();
    } catch {
      /* 可能已有 waiting，继续判断。 */
    }
    if (stopped || target !== expected) return;

    const waiting = registration.waiting;
    if (waiting) {
      present(() => activateWaiting(waiting));
      return;
    }
    const installing = registration.installing;
    if (installing) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve();
        };
        const timer = window.setTimeout(finish, 9000);
        const onState = (): void => {
          if (installing.state === 'installed' || installing.state === 'redundant') finish();
        };
        installing.addEventListener('statechange', onState);
        onState();
      });
      if (stopped || target !== expected) return;
      const next = registration.waiting;
      if (next) present(() => activateWaiting(next));
      else if (registration.active) present(() => { if (!hardRecoverFor(expected)) beginReload(); });
      return;
    }
    // 既无 waiting 也无 installing: 新 SW 未装上(旧环境卡住/安装失败), 普通 reload 仍会
    // 被旧 SW 劫持, 注销 SW + 清 precache 硬重载兜底; 已对该版本硬清过则退回普通 reload。
    present(() => { if (!hardRecoverFor(expected)) beginReload(); });
  };

  // 主动核对线上版本（不依赖 WS）。
  const detect = async (): Promise<void> => {
    if (stopped || checking) return;
    checking = true;
    try {
      const response = await fetch(__FRONTEND_VERSION_URL__, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      const served = data.frontendBuildId;
      if (!isUuid(served)) return;
      if (served === __FRONTEND_BUILD_ID__) {
        target = undefined;
        // 已成功加载到最新版: 清掉历史硬兜底标记, 保证下次部署仍可触发一次硬清。
        clearHardRecoverMarks();
        return;
      }
      target = served;
      await offer();
    } catch {
      /* 离线/超时：静默，等 visible/online 再核对。 */
    } finally {
      checking = false;
    }
  };

  const onVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    dismissed = false; // 回前台后允许再次提示。
    void detect();
  };
  const onWsBuild = (build: string): void => {
    if (build !== __FRONTEND_BUILD_ID__) {
      dismissed = false;
      void detect();
    }
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onVisible);
  buildListeners.add(onWsBuild);
  void detect(); // 冷启动立即主动核对。

  return {
    stop: () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      buildListeners.delete(onWsBuild);
      reloadFallback.forEach((t) => window.clearTimeout(t));
      reloadFallback.clear();
    },
    dismiss: () => {
      dismissed = true;
    },
  };
}
