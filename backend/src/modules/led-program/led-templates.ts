/**
 * LED 节目内置模板库
 *
 * 6 套模板：日常宣传 / 春节 / 国庆 / 元旦 / 欢迎莅临 / 招商专题
 * 每套模板定义 segments 配置，前端 bin-builder 直接渲染。
 * 节日日历硬编码，每年可在后台微调。
 */

export interface TemplateSegment {
  kind: 'text' | 'video';
  text?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  animation?: string;
  bgColor?: string;
  bgAnimation?: string;
  durationSec?: number;
}

export interface LedTemplate {
  type: string;
  name: string;
  description: string;
  segments: TemplateSegment[];
}

/** 节日日历：date = M/D，label = 节日名，templateType = 对应模板 */
export interface FestivalEntry {
  month: number;
  day: number;
  endMonth: number;
  endDay: number;
  label: string;
  templateType: string;
}

// ============ 6 套内置模板 ============

export const LED_TEMPLATES: Record<string, LedTemplate> = {
  daily: {
    type: 'daily',
    name: '日常宣传',
    description: '深蓝底 + 园区名 + 滚动标语',
    segments: [
      {
        kind: 'text',
        text: '金湖科创产业园',
        color: '#FFFFFF',
        bold: true,
        animation: 'fade-in',
        bgColor: '#0B1A3A',
        durationSec: 5,
      },
      {
        kind: 'text',
        text: '智慧园区 · 创新未来',
        color: '#4C9AFF',
        animation: 'scroll-left',
        bgColor: '#0B1A3A',
        durationSec: 5,
      },
      {
        kind: 'text',
        text: '科创引领 · 筑梦金湖',
        color: '#4C9AFF',
        animation: 'scroll-left',
        bgColor: '#0B1A3A',
        durationSec: 5,
      },
      {
        kind: 'text',
        text: '产业集聚 · 共赢发展',
        color: '#4C9AFF',
        animation: 'scroll-left',
        bgColor: '#0B1A3A',
        durationSec: 5,
      },
      {
        kind: 'text',
        text: '宜居宜业 · 金湖科创',
        color: '#4C9AFF',
        animation: 'scroll-left',
        bgColor: '#0B1A3A',
        durationSec: 5,
      },
    ],
  },

  spring: {
    type: 'spring',
    name: '春节祝福',
    description: '深红金底 + 新春快乐 + 节日标语',
    segments: [
      {
        kind: 'text',
        text: '新春快乐',
        color: '#FFD700',
        bold: true,
        animation: 'fade-in',
        bgColor: '#8B0000',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '金湖科创产业园 恭祝全市人民新春大吉',
        color: '#FFD700',
        animation: 'scroll-left',
        bgColor: '#8B0000',
        durationSec: 8,
      },
      {
        kind: 'text',
        text: '瑞雪兆丰年 · 奋进新征程',
        color: '#FFFFFF',
        animation: 'scroll-left',
        bgColor: '#8B0000',
        durationSec: 8,
      },
      {
        kind: 'text',
        text: '开工大吉 · 再创辉煌',
        color: '#FFD700',
        animation: 'fade-in',
        bgColor: '#8B0000',
        durationSec: 8,
      },
    ],
  },

  national: {
    type: 'national',
    name: '国庆祝福',
    description: '深红底 + 欢度国庆 + 爱国标语',
    segments: [
      {
        kind: 'text',
        text: '欢度国庆',
        color: '#FFD700',
        bold: true,
        animation: 'fade-in',
        bgColor: '#B22222',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '祝福祖国 · 繁荣昌盛',
        color: '#FFFFFF',
        animation: 'scroll-left',
        bgColor: '#B22222',
        durationSec: 8,
      },
      {
        kind: 'text',
        text: '金湖科创产业园 祝祖国生日快乐',
        color: '#FFD700',
        animation: 'scroll-left',
        bgColor: '#B22222',
        durationSec: 8,
      },
      {
        kind: 'text',
        text: '家国同庆 · 砥砺前行',
        color: '#FFFFFF',
        animation: 'fade-in',
        bgColor: '#B22222',
        durationSec: 8,
      },
    ],
  },

  newyear: {
    type: 'newyear',
    name: '元旦新年',
    description: '深蓝紫底 + 新年快乐 + 新年标语',
    segments: [
      {
        kind: 'text',
        text: '新年快乐',
        color: '#FFD700',
        bold: true,
        animation: 'fade-in',
        bgColor: '#1A1A4E',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '新起点 · 新征程 · 新辉煌',
        color: '#FFFFFF',
        animation: 'scroll-left',
        bgColor: '#1A1A4E',
        durationSec: 8,
      },
      {
        kind: 'text',
        text: '金湖科创产业园 与您共赴新程',
        color: '#4C9AFF',
        animation: 'scroll-left',
        bgColor: '#1A1A4E',
        durationSec: 8,
      },
      {
        kind: 'text',
        text: '凝心聚力 · 再创佳绩',
        color: '#FFD700',
        animation: 'fade-in',
        bgColor: '#1A1A4E',
        durationSec: 8,
      },
    ],
  },

  welcome: {
    type: 'welcome',
    name: '欢迎莅临',
    description: '深蓝底 + 欢迎莅临 + 园区名',
    segments: [
      {
        kind: 'text',
        text: '欢迎莅临',
        color: '#FFFFFF',
        bold: true,
        animation: 'fade-in',
        bgColor: '#0B1A3A',
        durationSec: 5,
      },
      {
        kind: 'text',
        text: '金湖科创产业园',
        color: '#4C9AFF',
        animation: 'fade-in',
        bgColor: '#0B1A3A',
        durationSec: 5,
      },
    ],
  },

  invest: {
    type: 'invest',
    name: '招商专题',
    description: '深蓝科技底 + 招商标语',
    segments: [
      {
        kind: 'text',
        text: '招才引智 共创未来',
        color: '#FFFFFF',
        bold: true,
        animation: 'fade-in',
        bgColor: '#0D1B3E',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '金湖科创产业园 欢迎优质企业入驻',
        color: '#4C9AFF',
        animation: 'scroll-left',
        bgColor: '#0D1B3E',
        durationSec: 8,
      },
      {
        kind: 'text',
        text: '政策扶持 · 配套完善 · 区位优越',
        color: '#FFFFFF',
        animation: 'scroll-left',
        bgColor: '#0D1B3E',
        durationSec: 8,
      },
      {
        kind: 'text',
        text: '投资金湖 · 共赢未来',
        color: '#FFD700',
        animation: 'fade-in',
        bgColor: '#0D1B3E',
        durationSec: 8,
      },
    ],
  },
};

// ============ 节日日历（硬编码） ============

export const FESTIVAL_CALENDAR: FestivalEntry[] = [
  { month: 12, day: 31, endMonth: 1, endDay: 1, label: '元旦新年', templateType: 'newyear' },
  { month: 2, day: 17, endMonth: 2, endDay: 28, label: '春节', templateType: 'spring' }, // 2026 春节 2/17
  { month: 5, day: 1, endMonth: 5, endDay: 3, label: '五一', templateType: 'daily' },
  { month: 10, day: 1, endMonth: 10, endDay: 7, label: '国庆', templateType: 'national' },
];

/** 判断某天是否节日，返回对应模板类型（非节日返回 null） */
export function getFestivalTemplate(date: Date): string | null {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  for (const f of FESTIVAL_CALENDAR) {
    if (f.month === f.endMonth && f.day <= f.endDay) {
      // 同年同区间
      if (m === f.month && d >= f.day && d <= f.endDay) return f.templateType;
    } else if (f.month > f.endMonth) {
      // 跨年（如 12/31 → 1/1）
      if ((m === f.month && d >= f.day) || (m === f.endMonth && d <= f.endDay)) return f.templateType;
    }
  }
  return null;
}

/** 列出所有可用模板 */
export function listTemplates(): LedTemplate[] {
  return Object.values(LED_TEMPLATES);
}

/** 按类型获取模板 */
export function getTemplate(type: string): LedTemplate | null {
  return LED_TEMPLATES[type] ?? null;
}
