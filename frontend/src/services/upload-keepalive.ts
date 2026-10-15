/**
 * 上传保活（大文件）：
 *  1. 请求 Screen Wake Lock，上传期间保持屏幕常亮，防止手机自动锁屏/熄屏
 *     挂起网络导致大文件中断（页面被用户主动切到后台时仍会释放，无法阻止）。
 *  2. 维护"是否有上传进行中"计数，供全局 401 兜底判断：上传进行中时，
 *     其它并发请求的 401（隧道忙/网络抖动）不立即把用户踢回登录页，避免误杀。
 *
 * Wake Lock 在页面回到前台时会自动重新请求（sentine 在 hidden 时被浏览器释放）。
 */

let activeCount = 0;
let sentinel: { release?: () => Promise<void> } | null = null;
let listenerBound = false;

function supportsWakeLock(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

async function requestLock(): Promise<void> {
  if (!supportsWakeLock() || sentinel) return;
  try {
    // navigator.wakeLock 在不支持/非安全上下文时可能缺失；忽略任何失败。
    const nav = navigator as unknown as {
      wakeLock?: { request: (kind: 'screen') => Promise<{ release?: () => Promise<void> }> };
    };
    if (!nav.wakeLock) return;
    sentinel = await nav.wakeLock.request('screen');
  } catch {
    sentinel = null;
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible' && activeCount > 0) {
    void requestLock();
  }
}

export function beginUploadKeepAlive(): void {
  activeCount += 1;
  void requestLock();
  if (!listenerBound && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
    listenerBound = true;
  }
}

export async function endUploadKeepAlive(): Promise<void> {
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount === 0 && sentinel) {
    try { await sentinel.release?.(); } catch { /* ignore */ }
    sentinel = null;
  }
}

export function isUploadActive(): boolean {
  return activeCount > 0;
}
