/**
 * 奥克斯商用 VRF (ARV-X 系列) + CCM-270B Modbus TCP 网关 寄存器映射
 *
 * 网关型号: CCM-270B
 * 协议:    Modbus TCP, 默认端口 502, 单 slave_id (默认 1)
 * 容量:    最多 64 台内机, 本项目 10 台
 *
 * 寻址方式:
 *   - 网关本身是 1 个 Modbus slave (slaveId 默认 1)
 *   - 每台内机占用一个连续的 16-寄存器 块
 *   - 内机 N 的寄存器基地址 = INDOOR_BLOCK_SIZE × N (N 从 0 开始)
 *     内机 #1 → 0x0000
 *     内机 #2 → 0x0010
 *     内机 #3 → 0x0020
 *     ...
 *     内机 #10 → 0x0090
 *
 * 说明:
 *   下面寄存器偏移按奥克斯 CCM-270B 通用文档整理. 现场拿到具体批次的
 *   网关说明书后, 如 mode 顺序 / fan 顺序与本表不一致, 在此处一处修改即可.
 *   生产前必须用 Modbus Poll 工具校验 (见 docs/HVAC_FIELD_INSTALL.md).
 */

/** 每台内机占用的寄存器块大小 (×16-bit register) */
export const INDOOR_BLOCK_SIZE = 0x10;

/** 单台内机寄存器块内的偏移 */
export const HVAC_REG = {
  /** 开关机. 0=off, 1=on */
  POWER: 0x00,
  /** 运行模式. 见 AUX_MODE_MAP */
  MODE: 0x01,
  /** 设定温度, ×10 (例: 250 = 25.0℃), 范围 16-30℃ */
  SET_TEMP: 0x02,
  /** 风速. 见 AUX_FAN_MAP */
  FAN: 0x03,
  /** 摆风. 0=关 1=开 */
  SWING: 0x04,
  /** 故障代码. 0=正常, 非0=故障 (代码含义见网关手册附录) */
  FAULT: 0x05,
  /** 室内当前温度, ×10 (只读) */
  ROOM_TEMP: 0x06,
  /** 在线状态. 1=在线, 0=离线 (只读) */
  ONLINE: 0x07,
} as const;

/** 模式映射: 字符串 → 寄存器值 */
export const AUX_MODE_MAP = {
  cool: 0,
  heat: 1,
  dry: 2,
  fan: 3,
  auto: 4,
} as const;
export type AuxHvacMode = keyof typeof AUX_MODE_MAP;

/** 风速映射: 字符串 → 寄存器值 */
export const AUX_FAN_MAP = {
  auto: 0,
  low: 1,
  mid: 2,
  high: 3,
} as const;
export type AuxFanSpeed = keyof typeof AUX_FAN_MAP;

/** 反向查找模式名 */
export function modeFromRaw(raw: number): AuxHvacMode {
  for (const [k, v] of Object.entries(AUX_MODE_MAP)) {
    if (v === raw) return k as AuxHvacMode;
  }
  return 'auto';
}

/** 反向查找风速名 */
export function fanFromRaw(raw: number): AuxFanSpeed {
  for (const [k, v] of Object.entries(AUX_FAN_MAP)) {
    if (v === raw) return k as AuxFanSpeed;
  }
  return 'auto';
}

/**
 * 计算第 N 台内机的寄存器基地址
 * @param indoorIdx 1-based (1 = 第 1 台内机)
 */
export function indoorBaseAddr(indoorIdx: number): number {
  if (indoorIdx < 1 || indoorIdx > 64) {
    throw new RangeError(`indoorIdx 必须 1-64, got ${indoorIdx}`);
  }
  return (indoorIdx - 1) * INDOOR_BLOCK_SIZE;
}

/** 给单台内机的寄存器偏移加上基地址 */
export function regAddr(indoorIdx: number, regOffset: number): number {
  return indoorBaseAddr(indoorIdx) + regOffset;
}
