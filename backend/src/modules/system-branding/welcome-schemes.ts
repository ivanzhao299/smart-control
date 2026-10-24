import { BadRequestException } from '@nestjs/common';

export const WELCOME_SCHEMES_CONFIG_KEY = 'welcome.schemes';
export const WELCOME_SCHEMES_SCHEMA_VERSION = 2;
/** 保留 1 套系统默认方案，另允许用户维护最多 20 套方案。 */
export const MAX_WELCOME_SCHEMES = 21;
export const DEFAULT_WELCOME_SCHEME_ID = 'default';
export const DEFAULT_WELCOME_SCHEME_NAME = '默认欢迎页';

export const WELCOME_LAYOUTS = ['ceremony', 'editorial', 'minimal'] as const;
export const WELCOME_TONES = ['light', 'dark'] as const;
export const WELCOME_OVERLAYS = ['none', 'soft', 'strong'] as const;
export const WELCOME_CONTENT_POSITIONS = ['upper', 'center', 'lower'] as const;
export const WELCOME_LOGO_SIZES = ['small', 'medium', 'large'] as const;
// 主标题文字渲染效果: blue=科技蓝(默认) gold=鎏金 white=纯白描边(复杂照片底) ink=墨蓝(浅色底) neon=霓虹青(深色科技底)
export const WELCOME_TITLE_EFFECTS = ['blue', 'gold', 'white', 'ink', 'neon'] as const;

export interface WelcomePresentation {
  layout: (typeof WELCOME_LAYOUTS)[number];
  tone: (typeof WELCOME_TONES)[number];
  overlay: (typeof WELCOME_OVERLAYS)[number];
  contentPosition: (typeof WELCOME_CONTENT_POSITIONS)[number];
  logoSize: (typeof WELCOME_LOGO_SIZES)[number];
  titleEffect: (typeof WELCOME_TITLE_EFFECTS)[number];
}

export const DEFAULT_WELCOME_PRESENTATION: WelcomePresentation = {
  layout: 'ceremony',
  tone: 'light',
  overlay: 'soft',
  contentPosition: 'center',
  logoSize: 'medium',
  titleEffect: 'blue',
};

export interface WelcomeScheme {
  id: string;
  name: string;
  welcomeTitle: string | null;
  welcomeGuest: string | null;
  welcomeTagline: string | null;
  welcomeTitleSize: number | null;
  welcomeGuestSize: number | null;
  welcomeTaglineSize: number | null;
  // 场馆名/英文/两行落款, 三态: null=内置默认, ''(空串)=该行隐藏, 非空=自定义
  welcomeVenue: string | null;
  welcomeVenueEn: string | null;
  welcomeOrg1: string | null;
  welcomeOrg2: string | null;
  welcomeBgMediaId: number | null;
  welcomeLogoMediaId: number | null;
  presentation: WelcomePresentation;
}

export interface WelcomeSchemesDocument {
  version: 2;
  schemes: WelcomeScheme[];
}

export interface PublishedWelcomeFields {
  welcomeTitle: string | null;
  welcomeGuest: string | null;
  welcomeTagline: string | null;
  welcomeTitleSize: number | null;
  welcomeGuestSize: number | null;
  welcomeTaglineSize: number | null;
  welcomeVenue: string | null;
  welcomeVenueEn: string | null;
  welcomeOrg1: string | null;
  welcomeOrg2: string | null;
  welcomeBgMediaId: number | null;
  welcomeLogoMediaId: number | null;
  presentation: WelcomePresentation;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function objectValue(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException(`${label} 必须是对象`);
  }
  return input as Record<string, unknown>;
}

function optionalText(input: unknown, maxLength: number, label: string): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'string') throw new BadRequestException(`${label} 必须是文本或 null`);
  const value = input.trim();
  if (!value) return null;
  if (value.length > maxLength)
    throw new BadRequestException(`${label}不能超过 ${maxLength} 个字符`);
  return value;
}

/**
 * 可隐藏的展示文案 (场馆名/落款):
 * undefined/null = 未设置 → 渲染内置默认; 空串/纯空格 = 显式隐藏该行; 非空 = 自定义文本。
 */
function optionalDisplayText(input: unknown, maxLength: number, label: string): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'string') throw new BadRequestException(`${label} 必须是文本或 null`);
  const value = input.trim();
  if (!value) return '';
  if (value.length > maxLength)
    throw new BadRequestException(`${label}不能超过 ${maxLength} 个字符`);
  return value;
}

function imageMediaId(input: unknown, label: string): number | null {
  if (input === null || input === undefined) return null;
  if (!Number.isInteger(input) || Number(input) <= 0) {
    throw new BadRequestException(`${label}媒体 ID 必须是正整数或 null`);
  }
  return Number(input);
}

/** 可选字号: null/undefined = 内置默认; 必须是范围内整数, 否则拒绝。 */
function optionalFontSize(
  input: unknown,
  min: number,
  max: number,
  label: string,
): number | null {
  if (input === null || input === undefined) return null;
  if (!Number.isInteger(input) || Number(input) < min || Number(input) > max) {
    throw new BadRequestException(`${label}必须是 ${min}-${max} 之间的整数或 null`);
  }
  return Number(input);
}

function enumValue<T extends string>(
  input: unknown,
  allowed: readonly T[],
  fallback: T,
  label: string,
): T {
  if (input === undefined || input === null) return fallback;
  if (typeof input !== 'string' || !allowed.includes(input as T)) {
    throw new BadRequestException(`${label}不受支持`);
  }
  return input as T;
}

export function normalizeWelcomePresentation(
  input: unknown,
  fallback: WelcomePresentation = DEFAULT_WELCOME_PRESENTATION,
): WelcomePresentation {
  if (input === undefined || input === null) return { ...fallback };
  const raw = objectValue(input, '欢迎页版式');
  return {
    layout: enumValue(raw.layout, WELCOME_LAYOUTS, fallback.layout, '欢迎页版式'),
    tone: enumValue(raw.tone, WELCOME_TONES, fallback.tone, '欢迎页文字色调'),
    overlay: enumValue(raw.overlay, WELCOME_OVERLAYS, fallback.overlay, '欢迎页背景遮罩'),
    contentPosition: enumValue(
      raw.contentPosition,
      WELCOME_CONTENT_POSITIONS,
      fallback.contentPosition,
      '欢迎页内容位置',
    ),
    logoSize: enumValue(raw.logoSize, WELCOME_LOGO_SIZES, fallback.logoSize, '欢迎页 Logo 尺寸'),
    titleEffect: enumValue(
      raw.titleEffect,
      WELCOME_TITLE_EFFECTS,
      fallback.titleEffect,
      '主标题文字效果',
    ),
  };
}

export function normalizeWelcomeSchemes(
  input: unknown,
  fallback?: WelcomeSchemesDocument,
): WelcomeSchemesDocument {
  const document = objectValue(input, '欢迎方案配置');
  if (document.version !== 1 && document.version !== 2) {
    throw new BadRequestException('欢迎方案配置版本必须为 1 或 2');
  }
  if (!Array.isArray(document.schemes)) throw new BadRequestException('欢迎方案列表必须是数组');
  if (document.schemes.length < 1 || document.schemes.length > MAX_WELCOME_SCHEMES) {
    throw new BadRequestException(`欢迎方案数量必须为 1-${MAX_WELCOME_SCHEMES} 套`);
  }

  const ids = new Set<string>();
  const schemes = document.schemes.map((item, index): WelcomeScheme => {
    const raw = objectValue(item, `第 ${index + 1} 套欢迎方案`);
    if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) {
      throw new BadRequestException(`第 ${index + 1} 套欢迎方案 ID 格式不正确`);
    }
    if (ids.has(raw.id)) throw new BadRequestException(`欢迎方案 ID 重复: ${raw.id}`);
    ids.add(raw.id);

    if (typeof raw.name !== 'string' || !raw.name.trim()) {
      throw new BadRequestException(`第 ${index + 1} 套欢迎方案名称不能为空`);
    }
    const name = raw.name.trim();
    if (name.length > 40) throw new BadRequestException('欢迎方案名称不能超过 40 个字符');
    const fallbackPresentation = fallback?.schemes.find((scheme) => scheme.id === raw.id)?.presentation;

    return {
      id: raw.id,
      name,
      welcomeTitle: optionalText(raw.welcomeTitle, 32, '主标题'),
      welcomeGuest: optionalText(raw.welcomeGuest, 120, '嘉宾行'),
      welcomeTagline: optionalText(raw.welcomeTagline, 64, '底部标语'),
      welcomeTitleSize: optionalFontSize(raw.welcomeTitleSize, 40, 400, '主标题字号'),
      welcomeGuestSize: optionalFontSize(raw.welcomeGuestSize, 24, 240, '嘉宾行字号'),
      welcomeTaglineSize: optionalFontSize(raw.welcomeTaglineSize, 18, 160, '底部标语字号'),
      welcomeVenue: optionalDisplayText(raw.welcomeVenue, 40, '场馆名称'),
      welcomeVenueEn: optionalDisplayText(raw.welcomeVenueEn, 96, '场馆英文名'),
      welcomeOrg1: optionalDisplayText(raw.welcomeOrg1, 40, '落款单位一'),
      welcomeOrg2: optionalDisplayText(raw.welcomeOrg2, 40, '落款单位二'),
      welcomeBgMediaId: imageMediaId(raw.welcomeBgMediaId, '欢迎页底图'),
      welcomeLogoMediaId: imageMediaId(raw.welcomeLogoMediaId, '欢迎页 Logo'),
      presentation: normalizeWelcomePresentation(
        raw.presentation,
        fallbackPresentation ?? DEFAULT_WELCOME_PRESENTATION,
      ),
    };
  });

  return { version: 2, schemes };
}

export function buildDefaultWelcomeSchemes(
  current: PublishedWelcomeFields,
): WelcomeSchemesDocument {
  return {
    version: 2,
    schemes: [
      { ...current, id: DEFAULT_WELCOME_SCHEME_ID, name: DEFAULT_WELCOME_SCHEME_NAME },
      { id: 'current', name: '当前接待', ...current },
      {
        id: 'business-visit',
        name: '企业来访',
        welcomeTitle: '热烈欢迎',
        welcomeGuest: '各位领导嘉宾',
        welcomeTagline: '欢迎莅临参观指导',
        welcomeTitleSize: null,
        welcomeGuestSize: null,
        welcomeTaglineSize: null,
        welcomeVenue: null,
        welcomeVenueEn: null,
        welcomeOrg1: null,
        welcomeOrg2: null,
        welcomeBgMediaId: null,
        welcomeLogoMediaId: null,
        presentation: { ...DEFAULT_WELCOME_PRESENTATION },
      },
      {
        id: 'conference',
        name: '会议活动',
        welcomeTitle: '欢迎参加',
        welcomeGuest: '各位会议嘉宾',
        welcomeTagline: '同心聚力 · 共创未来',
        welcomeTitleSize: null,
        welcomeGuestSize: null,
        welcomeTaglineSize: null,
        welcomeVenue: null,
        welcomeVenueEn: null,
        welcomeOrg1: null,
        welcomeOrg2: null,
        welcomeBgMediaId: null,
        welcomeLogoMediaId: null,
        presentation: {
          ...DEFAULT_WELCOME_PRESENTATION,
          layout: 'editorial',
          contentPosition: 'center',
        },
      },
      {
        id: 'signing',
        name: '签约仪式',
        welcomeTitle: '合作共赢',
        welcomeGuest: '各位领导嘉宾',
        welcomeTagline: '携手同行 · 共启新程',
        welcomeTitleSize: null,
        welcomeGuestSize: null,
        welcomeTaglineSize: null,
        welcomeVenue: null,
        welcomeVenueEn: null,
        welcomeOrg1: null,
        welcomeOrg2: null,
        welcomeBgMediaId: null,
        welcomeLogoMediaId: null,
        presentation: { ...DEFAULT_WELCOME_PRESENTATION, layout: 'minimal' },
      },
    ],
  };
}

/**
 * 旧版本已保存的方案配置没有系统默认方案。读取时补入内存快照，用户下一次保存
 * 即会把它持久化；不在 GET 路径写库，避免打开编辑器产生隐式配置变更。
 */
export function ensureDefaultWelcomeScheme(
  document: WelcomeSchemesDocument,
  current: PublishedWelcomeFields,
): WelcomeSchemesDocument {
  if (document.schemes.some((scheme) => scheme.id === DEFAULT_WELCOME_SCHEME_ID)) {
    return document;
  }
  return {
    version: 2,
    schemes: [
      { ...current, id: DEFAULT_WELCOME_SCHEME_ID, name: DEFAULT_WELCOME_SCHEME_NAME },
      ...document.schemes,
    ],
  };
}

export function matchesPublishedWelcome(
  scheme: WelcomeScheme,
  published: PublishedWelcomeFields,
): boolean {
  return (
    scheme.welcomeTitle === published.welcomeTitle &&
    scheme.welcomeGuest === published.welcomeGuest &&
    scheme.welcomeTagline === published.welcomeTagline &&
    (scheme.welcomeTitleSize ?? null) === (published.welcomeTitleSize ?? null) &&
    (scheme.welcomeGuestSize ?? null) === (published.welcomeGuestSize ?? null) &&
    (scheme.welcomeTaglineSize ?? null) === (published.welcomeTaglineSize ?? null) &&
    scheme.welcomeVenue === published.welcomeVenue &&
    scheme.welcomeVenueEn === published.welcomeVenueEn &&
    scheme.welcomeOrg1 === published.welcomeOrg1 &&
    scheme.welcomeOrg2 === published.welcomeOrg2 &&
    scheme.welcomeBgMediaId === published.welcomeBgMediaId &&
    scheme.welcomeLogoMediaId === published.welcomeLogoMediaId &&
    JSON.stringify(scheme.presentation) === JSON.stringify(published.presentation)
  );
}
