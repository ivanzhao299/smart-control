/**
 * 智能断路器 / 远程空开 (ePa 系列) — RS485 标准 Modbus-RTU 寄存器语义编解码。
 *
 * 数据源: 厂家《485 协议 Modbus 三版》。
 * 用途: 给 LED 大屏做远程物理总闸 (远程分合闸 + 计量 + 保护), 走本地 485,
 *       经有人 RTU-TCP 转换器接入 50 网段, 与现有 DALI 网关同一套路。
 *
 * 通信: 115200 · 8N1 · 无校验 · CRC16 低前高后 (标准 Modbus, 由 transports/ModbusRtuClient 收发)。
 *
 * 本文件只做"寄存器 <-> 物理量"的纯函数换算, 不碰 TCP / CRC / 帧 (那是 ModbusRtuClient 的事)。
 * 分合闸: FC 0x06 写 CTRL.MOTOR_OP; 读状态+计量: FC 0x03 读 DATA_BASE 起 DATA_WORD_COUNT 个寄存器。
 */

// ============ 控制寄存器 (FC 0x06 写单寄存器) ============

export const CTRL = {
  /** 电机操作 — 分合闸, 写 MOTOR_OP 的值 */
  MOTOR_OP: 0x0101,
  /** 清除用电量 */
  CLEAR_ENERGY: 0x0102,
  /** 485 从站地址 */
  SLAVE_ID: 0x0103,
  /** 恢复出厂设置 (删配置 + 重启) */
  RESTORE_DEFAULT: 0x0105,
  /** 重启断路器 */
  REBOOT: 0x0106,
  /** 漏电保护器自检 */
  LEAK_SELFTEST: 0x0108,
  /** 串口协议选择 (0 = modbus) */
  PROTOCOL_SEL: 0x0109,
  /** 远程功能开关 */
  REMOTE_ENABLE: 0x010b,
  /** 过欠压自恢复开关 */
  UV_AUTORECOVER: 0x010c,
} as const;

/** 分合闸操作值 (写 CTRL.MOTOR_OP) */
export const MOTOR_OP = {
  /** 合闸 (开 / 送电) */
  CLOSE: 0x0001,
  /** 分闸 (关 / 断电) */
  OPEN: 0x0002,
  /** 上锁 */
  LOCK: 0x0003,
  /** 解锁 */
  UNLOCK: 0x0004,
} as const;
export type MotorOp = (typeof MOTOR_OP)[keyof typeof MOTOR_OP];

// ============ 数据区 (FC 0x03 读, 0x0000 起 40 个寄存器 = 80 字节) ============

export const DATA_BASE = 0x0000;
/** 一次读全套: 40 个寄存器 (文档: 至少 2 个, 全量 40) */
export const DATA_WORD_COUNT = 40;

/**
 * word 索引 (readHoldingRegisters 返回的 16-bit 值数组下标)。
 * 每个电量 U32 占 2 个寄存器 (高前低后); 温度各占 1 个寄存器。
 */
export const WORD = {
  V: 0, //  0..7  : A/B/C/预留 电压 (U32, mV)
  I: 8, //  8..15 : A/B/C/漏电   电流 (U32, mA; I3 = 漏电/零序)
  P: 16, // 16..23 : A/B/C/总     功率 (U32, W)
  E: 24, // 24..31 : A/B/C/总     电量 (U32, W·h)
  T: 32, // 32..35 : 4 路接线柱温度 (int16, /100 = ℃)
  STATUS: 36, // 36..37 : 电气状态 (U32, 报警位)
  PF_FREQ: 38, // 38 : 高字节 功率因数(/100) · 低字节 频率
  MODE_SW: 39, // 39 : 高字节 工作模式 · 低字节 开关状态
} as const;

// ============ 数值换算 ============

/** 两个 16-bit 寄存器 (高前低后) 组成无符号 U32 */
export function u32(hi: number, lo: number): number {
  return (hi & 0xffff) * 0x10000 + (lo & 0xffff);
}

/** 单寄存器按有符号 16-bit 解释 (温度用, 可为负) */
export function toInt16(word: number): number {
  const w = word & 0xffff;
  return w >= 0x8000 ? w - 0x10000 : w;
}

// ============ 开关状态 ============

export type SwitchState = 'open' | 'closed' | 'locked' | 'unknown';

/** 从 MODE_SW 寄存器 (0x0027) 低字节解开关状态: 0 分 / 1 合 / 2 锁 */
export function decodeSwitchState(modeSwWord: number): SwitchState {
  switch (modeSwWord & 0xff) {
    case 0:
      return 'open';
    case 1:
      return 'closed';
    case 2:
      return 'locked';
    default:
      return 'unknown';
  }
}

// ============ 电气状态报警位 (寄存器 0x0024-25, 低 24 位有效) ============

export interface ElectricAlarms {
  overVoltage: [boolean, boolean, boolean]; // A B C
  underVoltage: [boolean, boolean, boolean];
  overCurrent: [boolean, boolean, boolean];
  leakage: boolean;
  overPower: [boolean, boolean, boolean, boolean]; // A B C 总
  overHeat: [boolean, boolean, boolean, boolean]; // A B C N
  overEnergy: [boolean, boolean, boolean, boolean]; // A B C 总
  /** 任一报警置位 */
  any: boolean;
}

/**
 * 解 32 位电气状态。位定义 (厂家文档):
 *  0-2 过压ABC · 4-6 欠压ABC · 8-10 过流ABC · 11 漏电 · 12-15 过功率ABC/总 ·
 *  16-19 过热ABCN · 20-23 过能量ABC/总
 */
export function decodeElectricStatus(status: number): ElectricAlarms {
  const b = (n: number): boolean => (status & (1 << n)) !== 0;
  return {
    overVoltage: [b(0), b(1), b(2)],
    underVoltage: [b(4), b(5), b(6)],
    overCurrent: [b(8), b(9), b(10)],
    leakage: b(11),
    overPower: [b(12), b(13), b(14), b(15)],
    overHeat: [b(16), b(17), b(18), b(19)],
    overEnergy: [b(20), b(21), b(22), b(23)],
    any: (status & 0x00ffffff) !== 0,
  };
}

// ============ 全量测量解码 ============

export interface BreakerMeasurements {
  /** 相电压 V (A/B/C); 单相取 A */
  voltages: [number, number, number];
  /** 相电流 A (A/B/C) */
  currents: [number, number, number];
  /** 漏电 / 零序电流 A */
  leakageCurrent: number;
  /** 功率 W (A/B/C/总) */
  powers: [number, number, number, number];
  /** 电量 kWh / 度 (A/B/C/总) */
  energies: [number, number, number, number];
  /** 接线柱温度 ℃ (A/B/C/N) */
  temperatures: [number, number, number, number];
  /** 功率因数 0-1 */
  powerFactor: number;
  /** 电网频率 Hz */
  frequency: number;
  /** 工作模式 (0 自动 / 1 手动) */
  mode: number;
  /** 开关状态 */
  switchState: SwitchState;
  /** 报警 */
  alarms: ElectricAlarms;
}

/**
 * 把 FC 0x03 读回的 40 个寄存器值解成物理量。
 * 单位: 电压 V, 电流 A, 功率 W, 电量 kWh, 温度 ℃, 频率 Hz。
 */
export function decodeMeasurements(words: number[]): BreakerMeasurements {
  if (words.length < DATA_WORD_COUNT) {
    throw new RangeError(`需要 ${DATA_WORD_COUNT} 个寄存器, got ${words.length}`);
  }
  const grp = (base: number, i: number): number => u32(words[base + i * 2], words[base + i * 2 + 1]);
  const pfFreq = words[WORD.PF_FREQ] & 0xffff;
  const modeSw = words[WORD.MODE_SW] & 0xffff;

  return {
    voltages: [grp(WORD.V, 0) / 1000, grp(WORD.V, 1) / 1000, grp(WORD.V, 2) / 1000],
    currents: [grp(WORD.I, 0) / 1000, grp(WORD.I, 1) / 1000, grp(WORD.I, 2) / 1000],
    leakageCurrent: grp(WORD.I, 3) / 1000,
    powers: [grp(WORD.P, 0), grp(WORD.P, 1), grp(WORD.P, 2), grp(WORD.P, 3)],
    energies: [
      grp(WORD.E, 0) / 1000,
      grp(WORD.E, 1) / 1000,
      grp(WORD.E, 2) / 1000,
      grp(WORD.E, 3) / 1000,
    ],
    temperatures: [
      toInt16(words[WORD.T]) / 100,
      toInt16(words[WORD.T + 1]) / 100,
      toInt16(words[WORD.T + 2]) / 100,
      toInt16(words[WORD.T + 3]) / 100,
    ],
    powerFactor: ((pfFreq >> 8) & 0xff) / 100,
    frequency: pfFreq & 0xff,
    mode: (modeSw >> 8) & 0xff,
    switchState: decodeSwitchState(modeSw),
    alarms: decodeElectricStatus(u32(words[WORD.STATUS], words[WORD.STATUS + 1])),
  };
}
