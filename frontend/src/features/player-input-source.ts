export const WELCOME_EDITABLE_NAME = '金湖欢迎页·动态(称谓可编辑)';
export const WELCOME_DEFAULT_NAMES = ['金湖欢迎页·LED大屏.png', '金湖欢迎页·投影.png'] as const;
export const PARK_DASHBOARD_NAME = '金湖科创产业园·智慧运营总览(DEMO)';
export const WELCOME_PICK_DEFAULT = '__default__';

export type PlayerInputSource =
  | 'content'
  | 'park-dashboard'
  | 'welcome-editable'
  | 'welcome-default';

export interface PlayerInputSourceChannel {
  currentMediaId?: number | null;
  currentMediaName?: string | null;
}

const SOURCE_HINTS: Record<PlayerInputSource, string> = {
  content: '正在播放列表内容',
  'park-dashboard': '园区综合态势与运营指标 · 点击即可投放到当前屏幕',
  'welcome-editable': '动态欢迎页 · 点「编辑欢迎页」改文字/底图, 保存即生效',
  'welcome-default': '内置静态欢迎页 (本屏专用尺寸, 不可编辑)',
};

export function detectPlayerInputSource(
  channel: PlayerInputSourceChannel | null | undefined,
): PlayerInputSource | null {
  const name = channel?.currentMediaName;
  if (!name || !channel?.currentMediaId) return null;
  if (name === PARK_DASHBOARD_NAME) return 'park-dashboard';
  if (name === WELCOME_EDITABLE_NAME) return 'welcome-editable';
  if (WELCOME_DEFAULT_NAMES.includes(name as (typeof WELCOME_DEFAULT_NAMES)[number])) {
    return 'welcome-default';
  }
  return 'content';
}

export function playerInputSourceHint(source: PlayerInputSource | null): string {
  return source
    ? SOURCE_HINTS[source]
    : '当前待机 · 点按钮选择本屏显示内容';
}

export function welcomePickerValue(
  source: PlayerInputSource | null,
  publishedSchemeId: string | null,
): string {
  if (source === 'welcome-default') return WELCOME_PICK_DEFAULT;
  if (source === 'welcome-editable') return publishedSchemeId ?? '';
  return '';
}
