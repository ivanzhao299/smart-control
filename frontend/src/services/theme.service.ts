import { ref } from 'vue';

/** Apply the saved application theme before mount to avoid a colour flash. */

/** A4: 浏览器 UI 色跟随主题 (PWA 全屏无地址栏, 这是给浏览器直开的兜底) */
function syncThemeColor(t: string): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#F6F8FB' : '#070D14');
}

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'sc.theme';

/** 当前主题 (响应式, 给切换按钮显示用) */
export const theme = ref<Theme>('light');

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
  const t = readStored() ?? 'light';
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
  const __t = readStored() ?? 'light';
  document.documentElement.setAttribute('data-theme', __t);
  syncThemeColor(__t);
}
