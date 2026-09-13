import { ref } from 'vue';

/**
 * 主题切换 (2026-07-22) —— 深色 / 浅色两套。
 *
 * 机制: 在 <html> 上挂 data-theme="light|dark", design-tokens.css 里
 * `:root[data-theme="light"]` 整套翻转 --v2-* token。页面不需要各写一份颜色,
 * 只要用 token (含 --v2-ov-* 叠加层) 就自动跟随。
 *
 * 默认深色: 展厅是暗环境, 而且大屏 kiosk 必须深色。
 * initTheme() 在 main.ts 里 **mount 之前**调, 避免先渲染一帧深色再跳浅色的闪烁。
 */

/** A4: 浏览器 UI 色跟随主题 (PWA 全屏无地址栏, 这是给浏览器直开的兜底) */
function syncThemeColor(t: string): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#EEF2F7' : '#0A0D12');
}

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'sc.theme';

/** 当前主题 (响应式, 给切换按钮显示用) */
export const theme = ref<Theme>('dark');

function persist(t: Theme): void {
  try { window.localStorage.setItem(STORAGE_KEY, t); } catch { /* 隐私模式 */ }
}

function readStored(): Theme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* 隐私模式 */ }
  return null;
}

/** 应用主题并记住 */
export function applyTheme(t: Theme): void {
  theme.value = t;
  document.documentElement.setAttribute('data-theme', t);
  syncThemeColor(t);
  persist(t);
}

/** 只应用不记住 —— 给 kiosk 大屏强制深色用, 不污染业主自己的选择 */
export function forceThemeWithoutPersist(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t);
  syncThemeColor(t);
}

/** 启动时调 (main.ts, mount 之前) */
export function initTheme(): void {
  const t = readStored() ?? 'dark';
  theme.value = t;
  document.documentElement.setAttribute('data-theme', t);
  syncThemeColor(t);
}

/** 切换 */
export function toggleTheme(): void {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark');
}

/** 回到业主记住的主题 (kiosk 页离开时用) */
export function restoreStoredTheme(): void {
  const __t = readStored() ?? 'dark';
  document.documentElement.setAttribute('data-theme', __t);
  syncThemeColor(__t);
}
