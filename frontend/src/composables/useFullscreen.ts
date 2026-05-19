import { onBeforeUnmount, onMounted, ref, computed } from 'vue';

/**
 * 终端全屏控制 (平板专用)
 *
 * 行为:
 * - PWA standalone/fullscreen 模式: 浏览器自动隐藏 chrome, 无需 JS
 * - 普通浏览器 tab: 提供 enter()/exit() 切换 Fullscreen API
 * - 首次用户交互后自动尝试进入全屏 (Fullscreen API 强制要求用户手势)
 * - 监听 fullscreenchange / visibilitychange, 实时反映状态
 *
 * 兼容: Chrome/Edge/Firefox + Safari (webkit 前缀)
 */
type DocAny = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type ElAny = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const STORAGE_KEY = 'sc.terminal.optedOut';

export function useFullscreen(opts: { autoEnter?: boolean } = {}) {
  const isSupported = ref<boolean>(false);
  const isActive = ref<boolean>(false);
  const isStandalone = ref<boolean>(false);
  const showPrompt = ref<boolean>(false);

  /** 用户手动取消过本次会话 → 不再弹提示 */
  const optedOut = ref<boolean>(false);

  const isTerminalMode = computed(() => isStandalone.value || isActive.value);

  function detectStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    // iOS Safari "添加到主屏幕"
    const navAny = window.navigator as Navigator & { standalone?: boolean };
    return Boolean(navAny.standalone);
  }

  function detectIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    // iPad iOS 13+ 默认 UA 含 'Macintosh', 需用 maxTouchPoints 区分
    const navAny = navigator as Navigator & { maxTouchPoints?: number };
    const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (navAny.maxTouchPoints ?? 0) > 1);
    const isIPhone = /iPhone|iPod/.test(ua);
    return isIPad || isIPhone;
  }

  function refreshState(): void {
    const d = document as DocAny;
    const el = d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
    isActive.value = el !== null;
    isStandalone.value = detectStandalone();
  }

  function loadOptOut(): void {
    try {
      optedOut.value = window.sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      optedOut.value = false;
    }
  }

  function persistOptOut(value: boolean): void {
    optedOut.value = value;
    try {
      if (value) window.sessionStorage.setItem(STORAGE_KEY, '1');
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  async function enter(): Promise<void> {
    if (!isSupported.value) {
      // 不支持时直接关 prompt, 避免 iPad / iPhone Safari 上 mask 永久盖屏
      showPrompt.value = false;
      return;
    }
    if (isActive.value || isStandalone.value) {
      showPrompt.value = false;
      return;
    }
    const root = document.documentElement as ElAny;
    try {
      if (typeof root.requestFullscreen === 'function') {
        await root.requestFullscreen();
      } else if (typeof root.webkitRequestFullscreen === 'function') {
        await root.webkitRequestFullscreen();
      }
    } catch {
      // 用户拒绝/浏览器不允许 (iPad Safari 常见情况)
    } finally {
      // 无论成功失败都关掉提示, 不能挡住后续操作
      showPrompt.value = false;
    }
    refreshState();
  }

  async function exit(): Promise<void> {
    if (!isActive.value) return;
    const d = document as DocAny;
    try {
      if (typeof d.exitFullscreen === 'function') {
        await d.exitFullscreen();
      } else if (typeof d.webkitExitFullscreen === 'function') {
        await d.webkitExitFullscreen();
      }
    } catch {
      // ignore
    }
    refreshState();
  }

  function toggle(): Promise<void> {
    return isActive.value ? exit() : enter();
  }

  /** 用户首次任意交互后尝试进入全屏 (一次性) */
  function setupAutoEnter(): () => void {
    const tryEnter = (): void => {
      if (optedOut.value || isActive.value || isStandalone.value) return;
      void enter();
    };
    const events: Array<keyof DocumentEventMap> = ['click', 'touchend', 'keydown'];
    const handler = (): void => {
      tryEnter();
      events.forEach((ev) => document.removeEventListener(ev, handler));
    };
    events.forEach((ev) => document.addEventListener(ev, handler, { once: false, passive: true }));
    return () => events.forEach((ev) => document.removeEventListener(ev, handler));
  }

  function dismissPrompt(): void {
    showPrompt.value = false;
    persistOptOut(true);
  }

  let removeAutoEnter: (() => void) | null = null;

  onMounted(() => {
    if (typeof window === 'undefined') return;
    const d = document as DocAny;
    isSupported.value =
      typeof d.documentElement.requestFullscreen === 'function' ||
      typeof (d.documentElement as ElAny).webkitRequestFullscreen === 'function';

    loadOptOut();
    refreshState();

    const onChange = (): void => refreshState();
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    document.addEventListener('visibilitychange', onChange);

    onBeforeUnmount(() => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      document.removeEventListener('visibilitychange', onChange);
      if (removeAutoEnter) removeAutoEnter();
    });

    // 决策: 已 PWA / 已退出过 / 不支持 / iOS (fullscreen 体验差) → 不弹
    // iOS Safari 上 requestFullscreen 经常静默失败, 弹了反而挡住操作, 跳过即可
    if (isStandalone.value || optedOut.value || !isSupported.value || detectIOS()) {
      showPrompt.value = false;
    } else {
      showPrompt.value = true;
      if (opts.autoEnter !== false) {
        removeAutoEnter = setupAutoEnter();
      }
    }
  });

  return {
    isSupported,
    isActive,
    isStandalone,
    isTerminalMode,
    showPrompt,
    optedOut,
    enter,
    exit,
    toggle,
    dismissPrompt,
    refreshState,
  };
}
