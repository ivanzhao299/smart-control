/**
 * 得胜 TAKSTAR EKX-808 通信协议封装
 *
 * 数据源: 《EKX-808说明书_220421》(2022-04-28 版)
 * 详见: docs/AUDIO_PROTOCOL_EKX808.md
 *
 * 帧格式 (固定 9 字节, 无校验和):
 *   [DLE 0x7B][STX 0x7D][DevAddr 1-254][CMD 0x40+][D1][D2][D3][STX 0x7D][DLE 0x7B]
 *
 * 物理接口:
 *   - 以太网 TCP (本项目使用, IP 默认 192.168.1.101)
 *   - RS232 / RS485 (备用)
 *
 * 本项目部署: DSP IP = 192.168.50.61, DevAddr = 1
 */

// ============ 帧边界 ============

export const DLE = 0x7b;
export const STX = 0x7d;
export const FRAME_LEN = 9;

// ============ 命令字 ============

export const CMD = {
  RECALL_MATRIX_PRESET: 0x40,  // 调用预设矩阵
  GAIN_STEP: 0x41,             // 增益 +/-
  MUTE: 0x42,                  // 静音控制
  RECALL_PRESET: 0x43,         // 调用预设
  INPUT_VOLUME: 0x44,          // 输入音量绝对值
  OUTPUT_VOLUME: 0x45,         // 输出音量绝对值
  GROUP_VOLUME: 0x46,          // 编组音量 (0-100%)
  GROUP_GAIN_STEP: 0x47,       // 编组增益 +/-
  READ_GAIN: 0x48,             // 读取增益
  READ_MUTE: 0x49,             // 读取静音状态
  READ_PRESET: 0x4a,           // 读取当前预设号
  READ_GROUP: 0x4b,            // 读取编组参数
  GROUP_MUTE: 0x4c,            // 编组静音
  READ_LEVEL: 0x4d,            // 读取实时电平
  MATRIX: 0x4e,                // 矩阵控制 (8x8 任意路由)
  READ_MATRIX_CELL: 0x4f,      // 读取单点矩阵
  AUX_GAIN_STEP: 0x51,         // AUX 增益 +/-
  AUX_MUTE: 0x52,              // AUX 静音
  AUX_VOLUME: 0x53,            // AUX 音量绝对值
  VOLUME_STEP: 0x54,           // 通用音量 +/-
  AUX_SWITCH: 0x55,            // 辅助开关 (效果/摄像/自动混音/AEC/降噪)
  AUX_INPUT_SELECT: 0x56,      // AUX 输入选择 (位掩码)
  FEEDBACK_SUPPRESS: 0x57,     // 输入反馈抑制
  READ_AUX_GAIN: 0x58,         // 读取 AUX 增益
  READ_AUX_MUTE: 0x59,         // 读取 AUX 静音
  READ_AUX_SWITCH: 0x5b,       // 读取辅助开关状态
  READ_AUX_INPUT_SELECT: 0x5c, // 读取 AUX 输入选择
  READ_FEEDBACK: 0x5e,         // 读取反馈抑制
  READ_FULL_MATRIX: 0x61,      // 读取全矩阵 (返回 160 字节)
  READ_GROUP_DETAIL: 0x63,     // 读取群组参数
  GROUP_CTRL_VOLUME: 0x66,     // 群组音量 (4 路独立群组)
  GROUP_CTRL_GAIN_STEP: 0x67,  // 群组增益 +/-
} as const;

// ============ 枚举 ============

/** In/Out 通道方向 */
export const IO_IN = 0;
export const IO_OUT = 1;
export type IODirection = typeof IO_IN | typeof IO_OUT;

/** 通道号 (0-15, 但 EKX-808 实际只有 8 路, 用 0-7) */
export type ChannelIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 预设类型 */
export const PRESET_FACTORY = 0;
export const PRESET_USER = 1;
export type PresetType = typeof PRESET_FACTORY | typeof PRESET_USER;

/** 辅助开关 (0x55 命令) */
export const AUX_SW = {
  EFFECT: 0,    // 效果器
  CAMERA: 1,    // 摄像头跟踪
  AUTO_MIX: 2,  // 自动混音
  AEC: 3,       // AEC 回声消除
  NR: 4,        // 降噪
} as const;
export type AuxSwitchKind = (typeof AUX_SW)[keyof typeof AUX_SW];

/** 群组号 (4 个独立群组, 输入/输出各 4) */
export type GroupIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ============ 帧构造 ============

/**
 * 构造 9 字节命令帧
 */
export function buildFrame(
  devAddr: number,
  cmd: number,
  d1 = 0,
  d2 = 0,
  d3 = 0,
): Buffer {
  if (devAddr < 1 || devAddr > 254) {
    throw new RangeError(`DeviceAddr 必须 1-254, got ${devAddr}`);
  }
  return Buffer.from([DLE, STX, devAddr & 0xff, cmd & 0xff, d1 & 0xff, d2 & 0xff, d3 & 0xff, STX, DLE]);
}

/**
 * 校验响应帧完整性
 * 返回 { devAddr, cmd, payload } 或 null (帧无效)
 */
export function parseFrame(buf: Buffer): { devAddr: number; cmd: number; payload: Buffer } | null {
  if (buf.length < FRAME_LEN) return null;
  if (buf[0] !== DLE || buf[1] !== STX) return null;
  if (buf[FRAME_LEN - 2] !== STX || buf[FRAME_LEN - 1] !== DLE) return null;
  return {
    devAddr: buf[2],
    cmd: buf[3],
    payload: buf.subarray(4, 7),
  };
}

// ============ 音量码值换算 ============

/**
 * 实际 dB 值 → 2 字节码值 (HI, LO)
 *
 * 码值范围 0-400:
 *   0-80    → -60 ~ -20 dB (0.5dB/Step)
 *   80-280  → -20 ~ 0 dB   (0.1dB/Step)
 *   280-400 → 0 ~ +12 dB   (0.1dB/Step)
 */
export function dbToCode(db: number): { hi: number; lo: number } {
  let code: number;
  if (db <= -20) {
    code = Math.round((db + 60) / 0.5);
  } else if (db <= 0) {
    code = Math.round(80 + (db + 20) / 0.1);
  } else {
    code = Math.round(280 + db / 0.1);
  }
  code = Math.max(0, Math.min(400, code));
  return { hi: (code >> 8) & 0xff, lo: code & 0xff };
}

/** 反向: 2 字节码值 → 实际 dB */
export function codeToDb(hi: number, lo: number): number {
  const code = ((hi & 0xff) << 8) | (lo & 0xff);
  if (code <= 80) return -60 + code * 0.5;
  if (code <= 280) return -20 + (code - 80) * 0.1;
  return 0 + (code - 280) * 0.1;
}

/**
 * 单字节增益码 (读取增益命令 0x48 返回的第 3 字节用):
 *   0-80   → -60 ~ -20 dB (0.5dB/Step)
 *   80-280 → -20 ~ 0 dB   (0.1dB/Step)
 *   280-400 → 0 ~ +12 dB   (0.1dB/Step)
 *
 * 与 dbToCode 相同的换算, 这里直接复用 codeToDb 但只用低字节.
 * (说明书原文用 3 字节, 但实测多数实现是 1 字节, 等联调时确认)
 */
export function singleByteCodeToDb(code: number): number {
  return codeToDb(0, code);
}

/** 实时电平字节 → dB (-128 ~ +127, 用 8 位有符号) */
export function levelByteToDb(byte: number): number {
  const b = byte & 0xff;
  return b >= 0x80 ? b - 256 : b;
}

// ============ 单条命令封装 ============

/** 调用用户预设 (U01-U12) */
export function cmdRecallUserPreset(devAddr: number, presetNum: number): Buffer {
  if (presetNum < 0 || presetNum > 12) throw new RangeError('预设号 0-12');
  return buildFrame(devAddr, CMD.RECALL_PRESET, PRESET_USER, presetNum, 0);
}

/** 调用出厂预设 (F00-F12) */
export function cmdRecallFactoryPreset(devAddr: number, presetNum: number): Buffer {
  if (presetNum < 0 || presetNum > 12) throw new RangeError('预设号 0-12');
  return buildFrame(devAddr, CMD.RECALL_PRESET, PRESET_FACTORY, presetNum, 0);
}

/** 调用用户矩阵预设 */
export function cmdRecallUserMatrixPreset(devAddr: number, presetNum: number): Buffer {
  if (presetNum < 0 || presetNum > 12) throw new RangeError('预设号 0-12');
  return buildFrame(devAddr, CMD.RECALL_MATRIX_PRESET, PRESET_USER, presetNum, 0);
}

/** 设置输入音量 (绝对值 dB) */
export function cmdSetInputVolume(devAddr: number, channel: ChannelIndex, db: number): Buffer {
  const { hi, lo } = dbToCode(db);
  return buildFrame(devAddr, CMD.INPUT_VOLUME, channel, hi, lo);
}

/** 设置输出音量 (绝对值 dB) */
export function cmdSetOutputVolume(devAddr: number, channel: ChannelIndex, db: number): Buffer {
  const { hi, lo } = dbToCode(db);
  return buildFrame(devAddr, CMD.OUTPUT_VOLUME, channel, hi, lo);
}

/** 静音 / 解除 */
export function cmdMute(devAddr: number, io: IODirection, channel: ChannelIndex, muted: boolean): Buffer {
  return buildFrame(devAddr, CMD.MUTE, io, channel, muted ? 1 : 0);
}

/** 音量步进 (-60~-20: 2dB, -20~+12: 1dB) */
export function cmdVolumeStep(devAddr: number, io: IODirection, channel: ChannelIndex, up: boolean): Buffer {
  return buildFrame(devAddr, CMD.VOLUME_STEP, io, channel, up ? 0 : 1);
}

/** 矩阵路由开关 (Out X ← In Y) */
export function cmdSetMatrix(devAddr: number, outCh: ChannelIndex, inCh: ChannelIndex, on: boolean): Buffer {
  return buildFrame(devAddr, CMD.MATRIX, outCh, inCh, on ? 1 : 0);
}

/** 编组音量 (整层输入或输出统一拉) */
export function cmdGroupVolume(devAddr: number, io: IODirection, percent: number): Buffer {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return buildFrame(devAddr, CMD.GROUP_VOLUME, io, p, 0);
}

/** 4 路独立群组音量 */
export function cmdGroupCtrlVolume(devAddr: number, group: GroupIndex, percent: number): Buffer {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return buildFrame(devAddr, CMD.GROUP_CTRL_VOLUME, group, p, 0);
}

/** 辅助开关 (效果/摄像/自动混音/AEC/降噪) */
export function cmdAuxSwitch(devAddr: number, kind: AuxSwitchKind, on: boolean): Buffer {
  return buildFrame(devAddr, CMD.AUX_SWITCH, 0x02, kind, on ? 1 : 0);
}

/** 反馈抑制等级 (0=OFF, 1-4=Level) */
export function cmdFeedbackSuppress(devAddr: number, channel: ChannelIndex, level: 0 | 1 | 2 | 3 | 4): Buffer {
  return buildFrame(devAddr, CMD.FEEDBACK_SUPPRESS, 0x00, channel, level);
}

// ============ 读取命令封装 (双向) ============

/** 读取增益 (返回 3 Byte: In/Out, Channel, code) */
export function cmdReadGain(devAddr: number, io: IODirection, channel: ChannelIndex): Buffer {
  return buildFrame(devAddr, CMD.READ_GAIN, io, channel, 0);
}

/** 读取静音状态 (返回 1 Byte: 0/1) */
export function cmdReadMute(devAddr: number, io: IODirection, channel: ChannelIndex): Buffer {
  return buildFrame(devAddr, CMD.READ_MUTE, io, channel, 0);
}

/** 读取当前预设号 (返回 1 Byte: 0x00-0x0C = F00, U01-U12) */
export function cmdReadPreset(devAddr: number): Buffer {
  // ⚠️ D1=0x00 (不是手册表格写的 0x30). 手册自相矛盾: 表格写 0x30, 但官方范例
  // 报文是 "7B7D014A0000007D7B" (D1=0x00). 2026-06-13 现场实测: D1=0x00 才读到
  // 真实预设号, D1=0x30 读不到 (返 0). 以官方范例 + 实测为准.
  return buildFrame(devAddr, CMD.READ_PRESET, 0x00, 0, 0);
}

/** 读取实时电平 (返回 3 Byte: In/Out/Aux, Channel, signed dB) */
export function cmdReadLevel(devAddr: number, type: 0 | 1 | 2, channel: ChannelIndex): Buffer {
  return buildFrame(devAddr, CMD.READ_LEVEL, type, channel, 0);
}

/** 读取全矩阵 (返回 160 字节, 5x32 完整路由表) */
export function cmdReadFullMatrix(devAddr: number): Buffer {
  return buildFrame(devAddr, CMD.READ_FULL_MATRIX, 0, 0, 0);
}

/**
 * 解析全矩阵回帧 → matrix[out][in] (0-based).
 *
 * ⚠️ 手册说"返回 160 字节 (5x32 完整路由表)" —— **不对**. 2026-07-16 真机实测
 * (EKX-808 @192.168.50.61, devAddr=1) 只回 **24 字节**:
 *
 *   00 00 07 | 01 00 05 | 02 00 05 | 03 00 05 | 04 00 0e | 05 00 04 | 06 00 05 | 07 00 05
 *   └OUT0     └OUT1      └OUT2      └OUT3      └OUT4      └OUT5      └OUT6      └OUT7
 *
 * 即 8 组 × 3 字节 = [输出号, 掩码高字节, 掩码低字节], 掩码的 bit N = IN(N+1) 接到
 * 该输出。EPO-802P 那次也是文档布局跟真机对不上, 一律以实测为准。
 *
 * 这个布局不是猜的: 用 0x4F 逐点读了全部 64 个交叉点做独立参照, **64/64 完全一致**.
 * (OUT5←IN2/IN3/IN4 也跟现场接线对得上 —— OUT5 走 LED 大屏功放, IN4 是 HDMI
 * 分离器提取的那一路.)
 */
export function parseFullMatrix(resp: Buffer): boolean[][] | null {
  // 回帧可能带包头/包尾, 找到 8 组 3 字节的数据段: 首字节应是递增的 0..7
  const bytes = Array.from(resp);
  let start = -1;
  for (let i = 0; i + 24 <= bytes.length; i += 1) {
    let ok = true;
    for (let g = 0; g < 8; g += 1) {
      if (bytes[i + g * 3] !== g) { ok = false; break; }
    }
    if (ok) { start = i; break; }
  }
  if (start < 0) return null;

  const matrix: boolean[][] = [];
  for (let out = 0; out < 8; out += 1) {
    const mask = (bytes[start + out * 3 + 1] << 8) | bytes[start + out * 3 + 2];
    matrix.push(Array.from({ length: 8 }, (_, inCh) => !!(mask & (1 << inCh))));
  }
  return matrix;
}

/** 读取单点矩阵 (Out X ← In Y 的开/关) */
export function cmdReadMatrixCell(devAddr: number, outCh: ChannelIndex, inCh: ChannelIndex): Buffer {
  return buildFrame(devAddr, CMD.READ_MATRIX_CELL, outCh, inCh, 0);
}
