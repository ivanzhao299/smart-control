import { ref } from 'vue';

/** Apply the saved application theme before mount to avoid a colour flash. */

/**
 * 主题方案（#38）：
 * - dark/light 为原有两套；ocean/sunset/emerald 为按展厅特点新增的三套亮色（对齐
 *   Tailwind CSS v3 标准色板 Blue/Orange/Emerald，并用 WCAG AA 校验白字对比）。
 * - data-theme 取具体方案（决定整套配色）；data-theme-mode 只表明明度（dark|light），
 *   让"卡片阴影 / chip / 字体渲染 / 遮罩"等与具体品牌色无关的浅色结构规则按明度复用，
 *   新增亮色主题时只需加一个颜色块，不必再重复这些结构规则。
 */
export type Theme = 'dark' | 'light' | 'ocean' | 'sunset' | 'emerald';

export const ALL_THEMES: Theme[] = ['dark', 'light', 'ocean', 'sunset', 'emerald'];

/** dark 是唯一暗色方案，其余均为亮色。 */
export function themeMode(t: Theme): 'dark' | 'light' {
  return t === 'dark' ? 'dark' : 'light';
}

/** 各主题给浏览器 UI 的顶栏色（meta theme-color，PWA 全屏无地址栏，浏览器直开兜底）。 */
const THEME_COLORS: Record<Theme, string> = {
  dark: '#070D14',
  light: '#F6F8FB',
  ocean: '#eff6ff',
  sunset: '#fff7ed',
  emerald: '#ecfdf5',
};

function syncThemeColor(t: Theme): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[t]);
}

const STORAGE_KEY = 'sc.theme';

/** 当前主题（响应式，给选择面板显示选中态用）。 */
export const theme = ref<Theme>('dark');

/** 主题选择面板的展示元数据（sw 为四色缩略：页面底 / 卡片 / 品牌主色 / 按钮深色）。 */
export interface ThemeOption {
  key: Theme;
  name: string;
  desc: string;
  sw: [string, string, string, string];
}
export const THEME_OPTIONS: ThemeOption[] = [
  { key: 'dark', name: '深色', desc: '近黑底 + 靛蓝，适合展厅暗环境与大屏（默认）', sw: ['#0a0b0e', '#15181f', '#818cf8', '#34d399'] },
  { key: 'light', name: '浅色', desc: '冷灰白底 + 靛蓝，简洁中性、明亮通用', sw: ['#f4f6f9', '#ffffff', '#4f46e5', '#4338ca'] },
  { key: 'ocean', name: '科技蓝', desc: '亮蓝白底 + 电光蓝，专业、科技、亮丽', sw: ['#eff6ff', '#ffffff', '#2563eb', '#1d4ed8'] },
  { key: 'sunset', name: '暖阳橙', desc: '暖米白底 + 活力橙，热情迎客、氛围足', sw: ['#fff7ed', '#ffffff', '#ea580c', '#c2410c'] },
  { key: 'emerald', name: '翡翠青', desc: '淡青绿底 + 翠绿，清新生态、舒适耐看', sw: ['#ecfdf5', '#ffffff', '#059669', '#047857'] },
];

function persist(t: Theme): void {
  try { window.localStorage.setItem(STORAGE_KEY, t); } catch { /* 隐私模式 */ }
}

function readStored(): Theme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && (ALL_THEMES as string[]).includes(v)) return v as Theme;
  } catch { /* 隐私模式 */ }
  return null;
}

function setAttributes(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.setAttribute('data-theme-mode', themeMode(t));
}

/** 应用主题并记住（选择面板点选即调用）。 */
export function applyTheme(t: Theme): void {
  theme.value = t;
  setAttributes(t);
  syncThemeColor(t);
  persist(t);
}

/** 只应用不记住 —— 给 kiosk 大屏强制深色用，不污染业主自己的选择。 */
export function forceThemeWithoutPersist(t: Theme): void {
  setAttributes(t);
  syncThemeColor(t);
}

/** 启动时调（main.ts，mount 之前）。 */
export function initTheme(): void {
  const t = readStored() ?? 'dark';
  theme.value = t;
  setAttributes(t);
  syncThemeColor(t);
}

/** 深↔浅二选一（兼容旧入口；面板式选择请直接用 applyTheme）。 */
export function toggleTheme(): void {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark');
}

/** 回到业主记住的主题（kiosk 页离开时用）。 */
export function restoreStoredTheme(): void {
  const t = readStored() ?? 'dark';
  theme.value = t;
  setAttributes(t);
  syncThemeColor(t);
}
