/**
 * LED 节目内置模板库
 *
 * 8 套模板：日常宣传 / 春节 / 国庆 / 元旦 / 欢迎莅临 / 招商专题 / 端午 / 中秋
 * 两行结构：大标题(18行高) + 副标题(8行高) = 27行 ≤ 30行屏高
 * 节日自动计算（农历+公历），无需每年手动维护日期。
 */

import { getLunarFestivalTemplate, getAutoYearSchedule } from './lunar-festival';

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
  /** 点阵行高（像素行），290×30屏：大标题16-18，副标题7-9，总高≤30 */
  size?: number;
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

// ============ 8 套内置模板（两行：大标题18 + 副标题8 = 27行） ============

/** 文案占位符：生成时自动替换，无需每年手改 */
const ZODIAC = ['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪'];
function resolvePlaceholders(text: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const anniversary = year - 1949;            // 国庆周年
  const zodiac = ZODIAC[(year - 4) % 12];     // 生肖
  return text
    .replace('{anniversary}', String(anniversary))
    .replace('{zodiac}', zodiac);
}

function deepResolve(tpl: LedTemplate): LedTemplate {
  return {
    ...tpl,
    segments: tpl.segments.map(s => ({
      ...s,
      text: s.text ? resolvePlaceholders(s.text) : s.text,
    })),
  };
}

export const LED_TEMPLATES: Record<string, LedTemplate> = {
  daily: {
    type: 'daily',
    name: '日常宣传',
    description: '深蓝底 + 金湖科创产业园(白大字) + 标语滚动(亮青)',
    segments: [
      {
        kind: 'text',
        text: '金湖科创产业园',
        color: '#FFFFFF',
        bold: true,
        size: 18,
        animation: 'fade-in',
        bgColor: '#001133',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '智慧园区 创新未来 产业集聚 共赢发展 招商热线0539-2911777',
        color: '#00FFFF',
        size: 8,
        animation: 'scroll-left',
        bgColor: '#001133',
        durationSec: 15,
      },
    ],
  },

  spring: {
    type: 'spring',
    name: '春节祝福',
    description: '深红底 + 新春快乐(亮黄大字) + 金湖集团拜年滚动',
    segments: [
      {
        kind: 'text',
        text: '新春快乐',
        color: '#FFFF00',
        bold: true,
        size: 18,
        animation: 'fade-in',
        bgColor: '#CC0000',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '金湖集团恭祝全市人民 {zodiac}年大吉 万事如意 阖家幸福 龙马精神',
        color: '#FFFF00',
        size: 8,
        animation: 'scroll-left',
        bgColor: '#CC0000',
        durationSec: 15,
      },
    ],
  },

  national: {
    type: 'national',
    name: '国庆祝福',
    description: '大红底 + 欢度国庆(亮黄大字) + 金湖集团祝福滚动',
    segments: [
      {
        kind: 'text',
        text: '欢度国庆',
        color: '#FFFF00',
        bold: true,
        size: 18,
        animation: 'fade-in',
        bgColor: '#CC0000',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '金湖集团热烈庆祝中华人民共和国成立{anniversary}周年 祝福祖国繁荣昌盛 国泰民安',
        color: '#FFFFFF',
        size: 8,
        animation: 'scroll-left',
        bgColor: '#CC0000',
        durationSec: 15,
      },
    ],
  },

  newyear: {
    type: 'newyear',
    name: '元旦新年',
    description: '深蓝底 + 新年快乐(亮黄大字) + 金湖集团新年寄语滚动',
    segments: [
      {
        kind: 'text',
        text: '新年快乐',
        color: '#FFFF00',
        bold: true,
        size: 18,
        animation: 'fade-in',
        bgColor: '#000066',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '金湖集团恭祝全市人民 新年快乐 万事如意 新起点 新征程 共创辉煌',
        color: '#00FFFF',
        size: 8,
        animation: 'scroll-left',
        bgColor: '#000066',
        durationSec: 15,
      },
    ],
  },

  welcome: {
    type: 'welcome',
    name: '欢迎莅临',
    description: '深蓝底 + 欢迎莅临(白大字) + 园区介绍滚动(亮青)',
    segments: [
      {
        kind: 'text',
        text: '欢迎莅临指导',
        color: '#FFFFFF',
        bold: true,
        size: 18,
        animation: 'fade-in',
        bgColor: '#001133',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '金湖科创产业园 欢迎各级领导莅临考察指导 招商热线0539-2911777',
        color: '#00FFFF',
        size: 8,
        animation: 'scroll-left',
        bgColor: '#001133',
        durationSec: 15,
      },
    ],
  },

  invest: {
    type: 'invest',
    name: '招商专题',
    description: '深蓝科技底 + 招才引智(白大字) + 入驻优势滚动(亮黄)',
    segments: [
      {
        kind: 'text',
        text: '招才引智 共创未来',
        color: '#FFFFFF',
        bold: true,
        size: 16,
        animation: 'fade-in',
        bgColor: '#001133',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '金湖科创产业园 欢迎优质企业入驻 政策扶持 配套完善 招商热线0539-2911777',
        color: '#FFFF00',
        size: 8,
        animation: 'scroll-left',
        bgColor: '#001133',
        durationSec: 15,
      },
    ],
  },

  dragon: {
    type: 'dragon',
    name: '端午佳节',
    description: '深绿底 + 端午安康(亮绿大字) + 金湖集团节日祝福滚动',
    segments: [
      {
        kind: 'text',
        text: '端午安康',
        color: '#00FF00',
        bold: true,
        size: 18,
        animation: 'fade-in',
        bgColor: '#004422',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '金湖集团恭祝全市人民 端午安康 阖家幸福 粽叶飘香 龙舟竞渡',
        color: '#FFFFFF',
        size: 8,
        animation: 'scroll-left',
        bgColor: '#004422',
        durationSec: 15,
      },
    ],
  },

  midautumn: {
    type: 'midautumn',
    name: '中秋团圆',
    description: '深蓝底 + 中秋快乐(亮黄大字) + 金湖集团团圆祝福滚动',
    segments: [
      {
        kind: 'text',
        text: '中秋快乐',
        color: '#FFFF00',
        bold: true,
        size: 18,
        animation: 'fade-in',
        bgColor: '#000044',
        durationSec: 6,
      },
      {
        kind: 'text',
        text: '金湖集团恭祝全市人民 中秋快乐 月圆人团圆 阖家幸福 花好月圆',
        color: '#FFFFFF',
        size: 8,
        animation: 'scroll-left',
        bgColor: '#000044',
        durationSec: 15,
      },
    ],
  },
};

// ============ 节日日历（自动农历计算，每年通用） ============

export const FESTIVAL_CALENDAR: FestivalEntry[] = [
  // 元旦/跨年
  { month: 12, day: 31, endMonth: 1, endDay: 1, label: '元旦新年', templateType: 'newyear' },
  // 春节（农历正月初一）
  { month: 2, day: 16, endMonth: 2, endDay: 23, label: '春节', templateType: 'spring' },
  // 劳动节
  { month: 5, day: 1, endMonth: 5, endDay: 5, label: '五一劳动节', templateType: 'daily' },
  // 端午节（农历五月初五）
  { month: 6, day: 19, endMonth: 6, endDay: 21, label: '端午节', templateType: 'dragon' },
  // 中秋节（农历八月十五）
  { month: 9, day: 25, endMonth: 9, endDay: 27, label: '中秋节', templateType: 'midautumn' },
  // 国庆节（10/1-10/7）
  { month: 10, day: 1, endMonth: 10, endDay: 7, label: '国庆节', templateType: 'national' },
  // 圣诞节
  { month: 12, day: 25, endMonth: 12, endDay: 25, label: '圣诞节', templateType: 'daily' },
];

/** 判断某天是否节日，返回对应模板类型（非节日返回 null）——自动农历计算 */
export function getFestivalTemplate(date: Date): string | null {
  const lunar = getLunarFestivalTemplate(date);
  if (lunar) return lunar.templateType;

  const m = date.getMonth() + 1;
  const d = date.getDate();
  const solar: Array<[number, number, number, string]> = [
    [1, 1, 1, 'newyear'],
    [5, 1, 5, 'daily'],
    [10, 1, 7, 'national'],
  ];
  for (const [sm, sd, ed, t] of solar) {
    if (m === sm && d >= sd && d <= ed) return t;
  }
  return null;
}

/**
 * 生成全年播放计划：自动计算农历+公历节日，每年通用
 */
export interface DaySchedule {
  date: string;
  month: number;
  day: number;
  weekday: number;
  isWeekend: boolean;
  templateType: string;
  label: string;
}

export function getYearSchedule(year: number): DaySchedule[] {
  return getAutoYearSchedule(year);
}

export function listTemplates(): LedTemplate[] {
  return Object.values(LED_TEMPLATES).map(deepResolve);
}

export function getTemplate(type: string): LedTemplate | null {
  const tpl = LED_TEMPLATES[type];
  return tpl ? deepResolve(tpl) : null;
}
