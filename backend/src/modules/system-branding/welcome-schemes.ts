import { BadRequestException } from '@nestjs/common';

export const WELCOME_SCHEMES_CONFIG_KEY = 'welcome.schemes';
export const WELCOME_SCHEMES_SCHEMA_VERSION = 1;
export const MAX_WELCOME_SCHEMES = 20;

export interface WelcomeScheme {
  id: string;
  name: string;
  welcomeTitle: string | null;
  welcomeGuest: string | null;
  welcomeTagline: string | null;
  welcomeBgMediaId: number | null;
  welcomeLogoMediaId: number | null;
}

export interface WelcomeSchemesDocument {
  version: 1;
  schemes: WelcomeScheme[];
}

export interface PublishedWelcomeFields {
  welcomeTitle: string | null;
  welcomeGuest: string | null;
  welcomeTagline: string | null;
  welcomeBgMediaId: number | null;
  welcomeLogoMediaId: number | null;
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

function imageMediaId(input: unknown, label: string): number | null {
  if (input === null || input === undefined) return null;
  if (!Number.isInteger(input) || Number(input) <= 0) {
    throw new BadRequestException(`${label}媒体 ID 必须是正整数或 null`);
  }
  return Number(input);
}

export function normalizeWelcomeSchemes(input: unknown): WelcomeSchemesDocument {
  const document = objectValue(input, '欢迎方案配置');
  if (document.version !== 1) throw new BadRequestException('欢迎方案配置版本必须为 1');
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

    return {
      id: raw.id,
      name,
      welcomeTitle: optionalText(raw.welcomeTitle, 32, '主标题'),
      welcomeGuest: optionalText(raw.welcomeGuest, 64, '嘉宾称谓'),
      welcomeTagline: optionalText(raw.welcomeTagline, 64, '底部标语'),
      welcomeBgMediaId: imageMediaId(raw.welcomeBgMediaId, '欢迎页底图'),
      welcomeLogoMediaId: imageMediaId(raw.welcomeLogoMediaId, '欢迎页 Logo'),
    };
  });

  return { version: 1, schemes };
}

export function buildDefaultWelcomeSchemes(
  current: PublishedWelcomeFields,
): WelcomeSchemesDocument {
  return {
    version: 1,
    schemes: [
      { id: 'current', name: '当前接待', ...current },
      {
        id: 'business-visit',
        name: '企业来访',
        welcomeTitle: '热烈欢迎',
        welcomeGuest: '各位领导嘉宾',
        welcomeTagline: '欢迎莅临参观指导',
        welcomeBgMediaId: null,
        welcomeLogoMediaId: null,
      },
      {
        id: 'conference',
        name: '会议活动',
        welcomeTitle: '欢迎参加',
        welcomeGuest: '各位会议嘉宾',
        welcomeTagline: '同心聚力 · 共创未来',
        welcomeBgMediaId: null,
        welcomeLogoMediaId: null,
      },
      {
        id: 'signing',
        name: '签约仪式',
        welcomeTitle: '合作共赢',
        welcomeGuest: '各位领导嘉宾',
        welcomeTagline: '携手同行 · 共启新程',
        welcomeBgMediaId: null,
        welcomeLogoMediaId: null,
      },
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
    scheme.welcomeBgMediaId === published.welcomeBgMediaId &&
    scheme.welcomeLogoMediaId === published.welcomeLogoMediaId
  );
}
