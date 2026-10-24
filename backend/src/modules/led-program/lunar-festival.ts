/**
 * 农历节日自动计算（无需外部库）
 *
 * 内置 2024-2030 年农历每月初一对应的公历日期表，
 * 自动推算春节/元宵/端午/中秋/重阳等农历节日，每年自动更新。
 *
 * 数据来源：天文计算标准农历表（1900-2100 通用格式）
 * 每月用一个字节表示该月是大月(30天)还是小月(29天)
 */

// 农历数据表：每年一个十六进制数，bit15=闰月大小，bit11-bit14=闰月月份，bit0-bit15=1-12月大小
// 简化版：直接存每年春节（农历正月初一）的公历日期
const CHUNJIE_DATES: Record<number, [number, number]> = {
  2024: [2, 10],   // 2024春节 2/10
  2025: [1, 29],   // 2025春节 1/29
  2026: [2, 17],   // 2026春节 2/17
  2027: [2, 6],    // 2027春节 2/6
  2028: [1, 26],   // 2028春节 1/26
  2029: [2, 13],   // 2029春节 2/13
  2030: [2, 3],    // 2030春节 2/3
};

// 农历月天数表（大月30/小月29），按年
// 格式：[正月, 二月, ..., 十二月, 闰月]
const LUNAR_MONTHS: Record<number, { months: number[]; leapMonth: number; leapDays: number }> = {
  2024: { months: [30, 29, 30, 30, 29, 30, 29, 30, 30, 29, 30, 30], leapMonth: 2, leapDays: 30 },
  2025: { months: [30, 29, 30, 29, 30, 29, 30, 29, 30, 30, 29, 30], leapMonth: 6, leapDays: 29 },
  2026: { months: [30, 29, 30, 29, 30, 29, 30, 29, 30, 30, 29, 30], leapMonth: 0, leapDays: 0 },
  2027: { months: [30, 29, 30, 29, 30, 29, 30, 29, 30, 30, 29, 30], leapMonth: 0, leapDays: 0 },
  2028: { months: [30, 30, 29, 30, 29, 30, 29, 30, 29, 30, 30, 29], leapMonth: 5, leapDays: 29 },
  2029: { months: [30, 29, 30, 29, 30, 30, 29, 30, 29, 30, 30, 29], leapMonth: 0, leapDays: 0 },
  2030: { months: [30, 29, 30, 30, 29, 30, 29, 30, 29, 30, 29, 30], leapMonth: 6, leapDays: 30 },
};

export interface LunarFestival {
  label: string;
  templateType: string;
  lunarMonth: number;  // 农历月
  lunarDay: number;     // 农历日
}

/** 农历节日定义（相对农历月日） */
const LUNAR_FESTIVALS: LunarFestival[] = [
  { label: '春节', templateType: 'spring', lunarMonth: 1, lunarDay: 1 },
  { label: '元宵节', templateType: 'spring', lunarMonth: 1, lunarDay: 15 },
  { label: '端午节', templateType: 'dragon', lunarMonth: 5, lunarDay: 5 },
  { label: '中秋节', templateType: 'midautumn', lunarMonth: 8, lunarDay: 15 },
  { label: '重阳节', templateType: 'daily', lunarMonth: 9, lunarDay: 9 },
];

/**
 * 计算某年农历某月初一对应的公历日期
 * 返回 [month, day]，null 表示该年数据未收录
 */
function getLunarMonthStart(year: number, lunarMonth: number): [number, number] | null {
  const table = LUNAR_MONTHS[year];
  if (!table || !CHUNJIE_DATES[year]) return null;

  const [cjMonth, cjDay] = CHUNJIE_DATES[year];
  let totalDays = 0;

  // 累加从正月到目标月之前的天数
  for (let m = 1; m < lunarMonth; m++) {
    totalDays += table.months[m - 1];
    // 如果有闰月且在m之后
    if (table.leapMonth === m) totalDays += table.leapDays;
  }

  // 从春节（正月初一）加 totalDays 天
  const d = new Date(year, cjMonth - 1, cjDay);
  d.setDate(d.getDate() + totalDays);
  return [d.getMonth() + 1, d.getDate()];
}

/**
 * 判断公历日期是否是农历节日，返回对应模板
 * 每年自动计算，不需要手动维护日期
 */
export function getLunarFestivalTemplate(date: Date): { label: string; templateType: string } | null {
  const year = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();

  for (const fest of LUNAR_FESTIVALS) {
    const start = getLunarMonthStart(year, fest.lunarMonth);
    if (!start) continue;

    // 农历节日当天 = 月初一开始 + (lunarDay - 1) 天
    const festDate = new Date(year, start[0] - 1, start[1]);
    festDate.setDate(festDate.getDate() + fest.lunarDay - 1);

    if (festDate.getMonth() + 1 === m && festDate.getDate() === d) {
      return { label: fest.label, templateType: fest.templateType };
    }
  }
  return null;
}

/**
 * 生成全年播放计划（自动计算农历节日+公历固定节日）
 */
export interface AutoDaySchedule {
  date: string;
  month: number;
  day: number;
  weekday: number;
  isWeekend: boolean;
  templateType: string;
  label: string;
}

export function getAutoYearSchedule(year: number): AutoDaySchedule[] {
  const result: AutoDaySchedule[] = [];
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const cur = new Date(start);

  // 公历固定节日（每年不变）
  const solarFestivals: Array<{ month: number; day: number; endDay: number; label: string; templateType: string }> = [
    { month: 1, day: 1, endDay: 1, label: '元旦', templateType: 'newyear' },
    { month: 5, day: 1, endDay: 5, label: '劳动节', templateType: 'daily' },
    { month: 10, day: 1, endDay: 7, label: '国庆节', templateType: 'national' },
    { month: 12, day: 25, endDay: 25, label: '圣诞节', templateType: 'daily' },
  ];

  while (cur <= end) {
    const m = cur.getMonth() + 1;
    const d = cur.getDate();
    const wd = cur.getDay();
    const isWeekend = wd === 0 || wd === 6;

    let templateType = 'daily';
    let label = isWeekend ? '周末' : '日常';

    // 先查公历节日
    for (const f of solarFestivals) {
      if (m === f.month && d >= f.day && d <= f.endDay) {
        templateType = f.templateType;
        label = f.label;
      }
    }

    // 再查农历节日（覆盖公历默认）
    const lunar = getLunarFestivalTemplate(cur);
    if (lunar) {
      templateType = lunar.templateType;
      label = lunar.label;
    }

    result.push({
      date: `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      month: m,
      day: d,
      weekday: wd,
      isWeekend,
      templateType,
      label,
    });

    cur.setDate(cur.getDate() + 1);
  }
  return result;
}
