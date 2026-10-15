/**
 * em123 表计命名 → 分区/楼栋/区域/房间/角色 的归属解析 (纯函数, 可单测)。
 *
 * 现场命名规则 (用户确认, 2026-10-14):
 *   - A/B/C/D/E 等字母是分区名, 字母后紧跟的数字编号是楼栋号:
 *       E2-1 → E区2栋, B3-1楼 → B区3栋, A4-1 → A区4栋, C1大总 → C区1栋,
 *       D3大棚 → D区3栋, B2-2东/西水表 → B区2栋(东/西单元)。
 *   - 公寓配套区按区域前缀分组: F3公寓 / 北院 / 东板房 / 南板房 / 北沿街,
 *       名称里的 3 位数字是房间号 (F3公寓楼101 / 北院201 / 北沿街301房)。
 *
 * 角色 kind:
 *   - 电表: 三相表 (型号 DTZY*) = 楼栋/关口总表 master; 单相表 (DDZY*) = 分户表 household。
 *   - 水表: 字母分区楼栋水表 = 总表 master; 公寓配套区分户水表 = household。
 */

export type MeterKind = 'master' | 'household';
export type MeterType = 'E' | 'W';

export interface ParsedLocation {
  /** 分区 A/B/C/D/E, 公寓配套区为 null */
  zone: string | null;
  /** 公寓配套区域分组 F3公寓/北院/东板房/南板房/北沿街; 字母分区为 null */
  areaGroup: string | null;
  /** 楼栋键: 字母分区为 A4/B3/E2 等; 公寓配套区等于区域名; 无法识别为 "其他" */
  building: string | null;
  /** 楼栋展示名: "A区4栋" / "F3公寓" / "未命名" */
  buildingName: string;
  /** 房间号 101/201…, 仅分户表有 */
  room: string | null;
  kind: MeterKind;
}

/** 公寓配套区域前缀 (顺序无歧义: 互不包含)。 */
export const AREA_GROUPS = ['F3公寓', '北沿街', '北院', '东板房', '南板房'] as const;

/** 字母分区楼栋: 开头字母(A-E) + 首个数字编号。 */
const ZONE_RE = /^([A-Ea-e])\s*(\d{1,2})/;
/** 房间号: 3 位数字 (101~599 楼层房号)。 */
const ROOM_RE = /(\d{3})/;

export function parseMeterLocation(input: {
  meterType?: string;
  modelName?: string | null;
  houseName?: string | null;
}): ParsedLocation {
  const name = String(input.houseName ?? '').trim();
  const isWater = String(input.meterType ?? '').toUpperCase() === 'W';
  const isThreePhase = /DTZY/i.test(String(input.modelName ?? ''));

  // 1) 公寓配套区域分组
  for (const group of AREA_GROUPS) {
    if (name.includes(group)) {
      const roomMatch = name.match(ROOM_RE);
      return {
        zone: null,
        areaGroup: group,
        building: group,
        buildingName: group,
        room: roomMatch ? roomMatch[1] : null,
        kind: 'household',
      };
    }
  }

  // 2) 字母分区楼栋
  const zm = name.match(ZONE_RE);
  if (zm) {
    const zone = zm[1].toUpperCase();
    const building = `${zone}${zm[2]}`;
    return {
      zone,
      areaGroup: null,
      building,
      buildingName: `${zone}区${zm[2]}栋`,
      room: null,
      // 字母分区楼栋: 三相电表或楼栋水表均为总表
      kind: isWater || isThreePhase ? 'master' : 'household',
    };
  }

  // 3) 兜底: 无名表 / "水表311" 等无法判定归属
  const roomMatch = name.match(ROOM_RE);
  return {
    zone: null,
    areaGroup: '其他',
    building: '其他',
    buildingName: '未命名',
    room: roomMatch ? roomMatch[1] : null,
    kind: isThreePhase ? 'master' : 'household',
  };
}

/** 数字安全解析。 */
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 保留 1 位小数。 */
export const round1 = (n: number): number => Math.round(n * 10) / 10;
/** 保留 2 位小数。 */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * 从 houseName 提取同楼栋多表的方位/后缀标签 (楼栋水表东/西/南/北, 电表 -1/-2 序号等),
 * 用于下钻明细里区分同楼栋的多块总表; 无则 null。
 */
export function subMeterTag(name: string): string | null {
  const dir = name.match(/(东|西|南|北)(?:水表|电表|侧|单元)?/);
  if (dir) return dir[1];
  // A5栋-2楼 / A5栋-3层 这类后缀
  const tail = name.match(/[A-Ea-e]\d+栋?-?\s*(\d+)\s*[楼层]?/);
  if (tail) return `${tail[1]}#`;
  if (/大总/.test(name)) return '大总';
  return null;
}
