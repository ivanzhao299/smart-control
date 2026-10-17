import { ref } from 'vue';

/** Apply the saved application theme before mount to avoid a colour flash. */

/**
 * 主题方案（#38 起步，#107 收敛为 4 套）：
 * - dark/light 为原有两套；sunset 暖阳橙是唯一保留的亮色品牌主题。
 * - auto 为「车机风」暗色（参考理想/蔚来控制面板），与 dark 同属 dark mode。
 * - 车机风的形态（深蓝黑底 / 玻璃质感 / 大圆角 / Dock）固定，强调色（青蓝/橙/紫）
 *   通过 data-accent 二级切换，不增加主题总数。
 * - data-theme 取具体方案（决定整套配色）；data-theme-mode 只表明明度（dark|light），
 *   让"卡片阴影 / chip / 字体渲染 / 遮罩"等与具体品牌色无关的结构规则按明度复用。
 * - 已下线的 ocean/emerald 若残留在 localStorage，readStored 校验不通过会回退 dark。
 */
export type Theme = 'dark' | 'light' | 'sunset' | 'auto';

export const ALL_THEMES: Theme[] = ['dark', 'light', 'sunset', 'auto'];

/** dark / auto 为暗色方案，其余为亮色。 */
export function themeMode(t: Theme): 'dark' | 'light' {
  return t === 'dark' || t === 'auto' ? 'dark' : 'light';
}

/**
 * 车机风强调色（仅在 data-theme='auto' 时生效）：
 * 形态与底色不变，只换主按钮 / 发光 / 激活态 / 进度条 / 氛围光的颜色。
 */
export type Accent = 'cyan' | 'orange' | 'purple';

export const ALL_ACCENTS: Accent[] = ['cyan', 'orange', 'purple'];

export interface AccentOption {
  key: Accent;
  name: string;
  desc: string;
  sw: string;
  /** 落在强调色圆点上的勾选图标颜色（亮青/亮橙用深色，紫用白色） */
  ink: string;
}

/** 各主题给浏览器 UI 的顶栏色（meta theme-color，PWA 全屏无地址栏，浏览器直开兜底）。 */
const THEME_COLORS: Record<Theme, string> = {
  dark: '#070D14',
  light: '#F6F8FB',
  sunset: '#fff7ed',
  auto: '#05070d',
};

function syncThemeColor(t: Theme): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[t]);
}

const STORAGE_KEY = 'sc.theme';
const ACCENT_STORAGE_KEY = 'sc.accent';

/** 当前主题（响应式，给选择面板显示选中态用）。 */
export const theme = ref<Theme>('dark');

/** 当前车机强调色（响应式，给车机主题的强调色圆点显示选中态用）。 */
export const accent = ref<Accent>('cyan');

/** 主题选择面板的展示元数据（sw 为四色缩略：页面底 / 卡片 / 品牌主色 / 状态强调）。 */
export interface ThemeOption {
  key: Theme;
  name: string;
  desc: string;
  sw: [string, string, string, string];
}
export const THEME_OPTIONS: ThemeOption[] = [
  { key: 'dark', name: '深色', desc: '近黑底 + 靛蓝，适合展厅暗环境与大屏（默认）', sw: ['#0a0b0e', '#15181f', '#818cf8', '#34d399'] },
  { key: 'auto', name: '车机', desc: '深蓝黑 + 青蓝发光，大圆角玻璃卡片，可切换强调色', sw: ['#05070d', '#141a24', '#37b6ff', '#2ed4b4'] },
  { key: 'light', name: '浅色', desc: '冷灰白底 + 靛蓝，简洁中性、明亮通用', sw: ['#f4f6f9', '#ffffff', '#4f46e5', '#4338ca'] },
  { key: 'sunset', name: '暖阳橙', desc: '暖米白底 + 活力橙，热情迎客、氛围足', sw: ['#fff7ed', '#ffffff', '#ea580c', '#c2410c'] },
];

/** 车机风三个强调色（仅在选中车机主题时出现）。 */
export const ACCENT_OPTIONS: AccentOption[] = [
  { key: 'cyan', name: '青蓝', desc: '蔚来青蓝，科技、清冷（默认）', sw: '#37b6ff', ink: '#03141f' },
  { key: 'orange', name: '理想橙', desc: '暖色、迎客、性能感', sw: '#ff8a3d', ink: '#2a1305' },
  { key: 'purple', name: '星云紫', desc: '科技紫，深邃、未来感', sw: '#9d8bff', ink: '#ffffff' },
];

function persist(t: Theme): void {
  try { window.localStorage.setItem(STORAGE_KEY, t); } catch { /* 隐私模式 */ }
}
function persistAccent(a: Accent): void {
  try { window.localStorage.setItem(ACCENT_STORAGE_KEY, a); } catch { /* 隐私模式 */ }
}

function readStored(): Theme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && (ALL_THEMES as string[]).includes(v)) return v as Theme;
  } catch { /* 隐私模式 */ }
  return null;
}
function readStoredAccent(): Accent {
  try {
    const v = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    if (v && (ALL_ACCENTS as string[]).includes(v)) return v as Accent;
  } catch { /* 隐私模式 */ }
  return 'cyan';
}

function setAttributes(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.setAttribute('data-theme-mode', themeMode(t));
}
function setAccentAttribute(a: Accent): void {
  document.documentElement.setAttribute('data-accent', a);
}

/** 应用主题并记住（选择面板点选即调用）。 */
export function applyTheme(t: Theme): void {
  theme.value = t;
  setAttributes(t);
  setAccentAttribute(accent.value);
  syncThemeColor(t);
  persist(t);
}

/** 切换车机强调色并记住（仅在 auto 形态下视觉生效）。 */
export function applyAccent(a: Accent): void {
  accent.value = a;
  setAccentAttribute(a);
  persistAccent(a);
}

/** 只应用不记住 —— 给 kiosk 大屏强制深色用，不污染业主自己的选择。 */
export function forceThemeWithoutPersist(t: Theme): void {
  setAttributes(t);
  syncThemeColor(t);
}

/** 启动时调（main.ts，mount 之前）。 */
export function initTheme(): void {
  const t = readStored() ?? 'dark';
  const a = readStoredAccent();
  theme.value = t;
  accent.value = a;
  setAttributes(t);
  setAccentAttribute(a);
  syncThemeColor(t);
}

/** 深↔浅二选一（兼容旧入口；面板式选择请直接用 applyTheme）。 */
export function toggleTheme(): void {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark');
}

/** 回到业主记住的主题（kiosk 页离开时用）。 */
export function restoreStoredTheme(): void {
  const t = readStored() ?? 'dark';
  const a = readStoredAccent();
  theme.value = t;
  accent.value = a;
  setAttributes(t);
  setAccentAttribute(a);
  syncThemeColor(t);
}
