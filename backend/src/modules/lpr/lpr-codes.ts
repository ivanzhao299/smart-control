/**
 * 臻识车牌识别一体机 HTTP 推送协议系统码表 (协议 V1.9.7 第 4 章)。
 * 纯常量 + 查表, 便于单测; 未知码统一回退 "未知(code)"。
 */

export const TRIGGER_TYPE: Record<number, string> = {
  1: '自动触发',
  2: '外部输入(IO)',
  4: '软件触发(SDK)',
  8: '虚拟线圈',
  64: '车滞留',
  65: '滞留恢复',
  66: '车折返',
  67: '机动车通行',
  68: '跟车',
  69: '车辆拥堵',
  70: '拥堵解除',
  71: '人滞留',
  72: '人滞留解除',
  73: '人员拥堵',
  74: '人员拥堵解除',
  75: '非机动车滞留',
  76: '非机动车滞留解除',
  77: '道闸正常',
  78: '道闸异常',
  79: '道闸回落',
  80: '道闸抬升',
  85: '车头车尾号牌不一致',
  86: '车牌识别',
  87: '非机动车拥堵',
  88: '非机动车拥堵解除',
};

export const PLATE_TYPE: Record<number, string> = {
  0: '未知车牌',
  1: '蓝牌小汽车',
  2: '黑牌小汽车',
  3: '单排黄牌',
  4: '双排黄牌',
  5: '警车',
  6: '武警车牌',
  7: '个性化车牌',
  8: '单排军车',
  9: '双排军车',
  10: '使馆车牌',
  11: '香港进出大陆',
  12: '农用车',
  13: '教练车',
  14: '澳门进出大陆',
  15: '双层武警',
  16: '武警总队',
  17: '双层武警总队',
  18: '民航车牌',
  19: '新能源小车',
  20: '大型新能源',
  21: '应急车',
  22: '领事馆',
  23: '新标燃油车',
  24: '新标新能源',
  25: '机场车牌',
  26: '海外车牌',
  29: '假车牌',
  30: '车标',
  31: '无牌车',
};

export const PLATE_COLOR: Record<number, string> = {
  0: '未知',
  1: '蓝色',
  2: '黄色',
  3: '白色',
  4: '黑色',
  5: '绿色',
  6: '黄绿色',
};

export const CAR_COLOR: Record<number, string> = {
  0: '白',
  1: '银灰',
  2: '黄',
  3: '粉',
  4: '红',
  5: '绿',
  6: '蓝',
  7: '棕',
  8: '黑',
  9: '灰',
  10: '米',
  11: '橙',
  12: '紫',
  255: '未知',
};

export const DIRECTION: Record<number, string> = {
  0: '未知',
  1: '左',
  2: '右',
  3: '上',
  4: '下',
};

export const CAR_TYPE: Record<number, string> = {
  0xff: '未知',
  0x00: '轿车',
  0x01: 'SUV',
  0x02: 'MPV',
};

/** 道闸状态: barr_gate_status_notify.gate_status */
export const GATE_STATUS: Record<number, string> = {
  0: '关到位',
  1: '开到位',
  2: '中间',
};

export const GROUP_LABEL: Record<string, string> = {
  staff: '员工',
  visitor: '访客',
  freight: '货运',
  black: '黑名单',
};

function labelOf(map: Record<number, string>, code: number | null | undefined): string | null {
  if (code === null || code === undefined || Number.isNaN(code)) return null;
  return map[code] ?? `未知(${code})`;
}

export const triggerTypeLabel = (c: number | null | undefined): string | null => labelOf(TRIGGER_TYPE, c);
export const plateTypeLabel = (c: number | null | undefined): string | null => labelOf(PLATE_TYPE, c);
export const plateColorLabel = (c: number | null | undefined): string | null => labelOf(PLATE_COLOR, c);
export const carColorLabel = (c: number | null | undefined): string | null => labelOf(CAR_COLOR, c);
export const directionLabel = (c: number | null | undefined): string | null => labelOf(DIRECTION, c);
export const carTypeLabel = (c: number | null | undefined): string | null => labelOf(CAR_TYPE, c);
export const gateStatusLabel = (c: number | null | undefined): string | null => labelOf(GATE_STATUS, c);

/** 规范化车牌: 去空白/点/星号遮挡, 转大写 (匹配前调用) */
export function normalizePlate(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\s+/g, '')
    .replace(/[.*·•]/g, '')
    .toUpperCase()
    .trim();
}
