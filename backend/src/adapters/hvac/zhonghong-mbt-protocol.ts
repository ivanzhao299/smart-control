/**
 * 中弘 ZHONGHONG B 集控网关 (TCP 款) Modbus-TCP 协议封装
 *
 * 数据源: 《对接协议-B集控网关》V3.2
 *
 * 通讯参数:
 *   - 物理层: 网口 (RJ45)
 *   - 应用层: Modbus TCP, 默认 502 端口 (Web 页面可改)
 *   - 协议代号: MBT (MODBUS-TCP)
 *   - 寄存器值与 RS485 版协议相同, 仅帧格式不同
 *
 * 单台网关挂 1 台外机, 最多 64 台内机, 内机号 0-63 平铺 (无外机层).
 *
 * 本项目部署:
 *   - 2 台中弘 B 集控网关 TCP 款 (一台/外机)
 *   - 1F 网关 IP 192.168.50.66:502 → 1F 外机 (10 内机, n=1..10)
 *   - 2F 网关 IP 192.168.50.67:502 → 2F 外机 (12 内机, n=1..12)
 *   - 都接交换机, 不需要 USR-TCP232 转换器
 *   - SlaveID 默认 = 1 (网关旋转拨码, 0-15)
 */

// ============ 寄存器地址 ============

/** 性能信息 (网关级, 每网关 1 套) */
export const PERF_BASE = 2000;
export const PERF_REG_COUNT = 6;
export const PERF_OFFSET = {
  BRAND: 0, // 2000: 空调品牌 (见 ZH_BRAND)
  PRODUCT_TYPE: 1, // 2001: 产品类型, 2=集控网关
  INDOOR_COUNT: 2, // 2002: 内机数量
  TEMP_MIN: 3, // 2003: 温度下限 (℃)
  TEMP_MAX: 4, // 2004: 温度上限 (℃)
  RESERVED: 5, // 2005: 备用
} as const;

/** 单内机状态 (每内机 6 寄存器, FC 0x03 读). 起始 = 6*n */
export const STATE_REGS_PER_INDOOR = 6;
export function stateBaseAddr(indoorN: number): number {
  if (indoorN < 0 || indoorN > 63) {
    throw new RangeError(`内机号 n 必须 0-63, got ${indoorN}`);
  }
  return STATE_REGS_PER_INDOOR * indoorN;
}

export const STATE_OFFSET = {
  POWER: 0, // 开关查询: 0=关 / 1=开
  MODE: 1, // 模式查询: 1=制热 / 2=制冷 / 4=送风 / 8=除湿
  TEMP: 2, // 温度查询: 设定温度 (无符号, 0x14=20)
  FAN: 3, // 风速查询: 0=自动 / 1=低 / 2=中 / 3=高
  ROOM_TEMP: 4, // 室温查询: **有符号** 0x00-0x32=0-50℃, 0xce-0xff=-50~-1℃
  FAULT: 5, // 故障代码: 品牌相关 (见附录)
} as const;

/** 单内机控制 (每内机 4 寄存器, FC 0x06/0x10 写). 起始 = 4000 + 4*n */
export const CTRL_BASE = 4000;
export const CTRL_REGS_PER_INDOOR = 4;
export function ctrlBaseAddr(indoorN: number): number {
  if (indoorN < 0 || indoorN > 63) {
    throw new RangeError(`内机号 n 必须 0-63, got ${indoorN}`);
  }
  return CTRL_BASE + CTRL_REGS_PER_INDOOR * indoorN;
}

export const CTRL_OFFSET = {
  POWER: 0, // 0=关 / 1=开
  MODE: 1, // 1=制热 / 2=制冷 / 4=送风 / 8=除湿
  TEMP: 2, // 16-32 (0x10-0x20)
  FAN: 3, // 0=自动 / 1=低 / 2=中 / 3=高
} as const;

/** 全部内机控制 (5000-5003), 同 CTRL_OFFSET 的 4 字段, 但作用于该网关所有内机 */
export const CTRL_ALL_BASE = 5000;

// ============ 值映射 ============

export type HvacMode = 'cool' | 'heat' | 'fan' | 'dry' | 'auto';
export type HvacFan = 'auto' | 'low' | 'mid' | 'high';

/** 模式 (位掩码, 控制和状态都用同一套) */
export const MODE_TO_REG: Record<HvacMode, number> = {
  heat: 0x01,
  cool: 0x02,
  fan: 0x04,
  dry: 0x08,
  auto: 0x02, // 协议无独立 auto, fallback 制冷 (B 集控网关无 auto 模式)
};

export function decodeMode(raw: number): HvacMode {
  switch (raw & 0x0f) {
    case 0x01:
      return 'heat';
    case 0x02:
      return 'cool';
    case 0x04:
      return 'fan';
    case 0x08:
      return 'dry';
    default:
      return 'auto';
  }
}

/** 风速 (B 集控 v3.2: 0=自动 / 1=低 / 2=中 / 3=高) */
export const FAN_TO_REG: Record<HvacFan, number> = {
  auto: 0,
  low: 1,
  mid: 2,
  high: 3,
};

export function decodeFan(raw: number): HvacFan {
  switch (raw & 0xff) {
    case 1:
      return 'low';
    case 2:
      return 'mid';
    case 3:
      return 'high';
    case 0:
    default:
      return 'auto';
  }
}

/** 设定温度 (16-32℃, 直接十六进制 = 摄氏值) */
export function tempToReg(celsius: number): number {
  return Math.max(16, Math.min(32, Math.round(celsius))) & 0xff;
}
export function regToTemp(reg: number): number {
  return reg & 0xff;
}

/** 室温 (有符号: 0x00-0x32=0-50℃, 0xce-0xff=-50~-1℃) */
export function regToRoomTemp(reg: number): number {
  const v = reg & 0xff;
  if (v <= 0x32) return v; // 0-50℃ (正)
  if (v >= 0xce) return v - 0x100; // -50~-1℃ (有符号补码)
  return NaN; // 0x33-0xcd 非法
}

// ============ 内机解码后的完整状态 ============

export interface IndoorState {
  on: boolean;
  mode: HvacMode;
  temperature: number; // 设定温度
  fan: HvacFan;
  roomTemp?: number; // 室温 (有效则有值)
  faultCode: number; // 0=无故障
  online: boolean; // 通过 mode/temp 非 0 推断 (协议建议)
}

export function decodeIndoorState(regs: number[]): IndoorState {
  if (regs.length < STATE_REGS_PER_INDOOR) {
    throw new Error(`需要 ${STATE_REGS_PER_INDOOR} 个寄存器, got ${regs.length}`);
  }
  const mode = regs[STATE_OFFSET.MODE];
  const temp = regs[STATE_OFFSET.TEMP];
  const room = regToRoomTemp(regs[STATE_OFFSET.ROOM_TEMP]);
  return {
    on: regs[STATE_OFFSET.POWER] === 1,
    mode: decodeMode(mode),
    temperature: regToTemp(temp),
    fan: decodeFan(regs[STATE_OFFSET.FAN]),
    roomTemp: Number.isNaN(room) ? undefined : room,
    faultCode: regs[STATE_OFFSET.FAULT],
    // 协议建议: 温度非 0 即在线
    online: temp !== 0 || mode !== 0,
  };
}

// ============ 空调品牌码 (D2000 低字节) ============

export const ZH_BRAND = {
  simulator: 0, // 模拟器 (调试用, 无实物可测)
  daikin: 1,
  hitachi: 2,
  toshiba: 3,
  mitsubishi_heavy: 4,
  mitsubishi_electric: 5,
  gree: 6,
  midea: 7,
  haier: 8,
  panasonic: 9,
  trane: 11,
  mcquay: 12,
  samsung: 13,
  fujitsu: 14,
  /** 奥克斯 AUX */
  aux: 15,
  lg: 16,
  midea_v3: 17,
  hisense: 18,
  carrier: 19,
  tianjia: 20,
  york: 21,
  chigo: 22,
  bosch: 23,
  casarte: 24,
  vaillant: 25,
} as const;

// ============ device.address JSON 格式 ============

export interface IndoorAddress {
  /** 网关 IP (区分 1F vs 2F) */
  gwHost: string;
  /** 网关 Modbus TCP 端口, 默认 502 */
  gwPort?: number;
  /** 网关 SlaveID, 默认 1 */
  slaveId?: number;
  /** 该网关内的内机号 (0-63) */
  n: number;
}

export function parseIndoorAddress(addressJson: string | null): IndoorAddress | null {
  if (!addressJson) return null;
  try {
    const j = JSON.parse(addressJson);
    if (typeof j.gwHost !== 'string' || typeof j.n !== 'number') return null;
    return {
      gwHost: j.gwHost,
      gwPort: typeof j.gwPort === 'number' ? j.gwPort : 502,
      slaveId: typeof j.slaveId === 'number' ? j.slaveId : 1,
      n: j.n,
    };
  } catch {
    return null;
  }
}
