/**
 * 通用 8 路电源时序器 "55…AA" 6 字节协议 (2026-07-29 业主拍的厂家协议单, 计划
 * 加装第二台时序器用 — 与在用的得胜 EPO-802P **不是**一个协议体系, 不能混用):
 *
 * 物理层: 串口, **波特率 9600** (EPO 是 19200, 两台不能共用一条串口线)。
 * 帧格式 (固定 6 字节):
 *   55 | 机器地址(01-FF, 出厂01) | 00 | 通道 | 动作 | AA
 * 通道: 01-08 单路 / 0D 时序控制(顺序开关) / 10 全部同步
 * 动作: F0 开 / F1 关 / F2 写地址 / F3 退出控制 / FA 读状态 / FB 读地址 / F5 返回数据
 *
 * 厂家例帧 (spec 逐字节金标准):
 *   第一路开   55 01 00 01 F0 AA      8路顺序开  55 01 00 0D F0 AA
 *   第一路关   55 01 00 01 F1 AA      8路同步全关 55 01 00 10 F1 AA
 *   改地址为02 55 02 00 00 F2 AA      读地址     55 01 00 00 FB AA
 *
 * 读状态 (FA) 返回帧已实测（2026-10-18, COM4@9600）：
 *   `55 | addr | bitmap | 00 | F5 | AA`，第 3 字节为 8 路状态位图；
 *   8 路全亮时回 `55 01 FF 00 F5 AA`。解析见 parseStatusReply。
 *   （bit0 对应 CH1 还是 CH8 暂按 bit0=CH1，待一次单路对照最终锁定。）
 * ⚠️ 面板按键电源开关必须处于关闭状态, 设备才接受串口控制 (厂家注明)。
 */

export const SEQ55_HEAD = 0x55;
export const SEQ55_TAIL = 0xaa;
export const SEQ55_DEFAULT_BAUD = 9600;
export const SEQ55_DEFAULT_ADDR = 0x01;

export const SEQ55_ACTION = {
  ON: 0xf0,
  OFF: 0xf1,
  WRITE_ADDR: 0xf2,
  EXIT: 0xf3,
  DATA: 0xf5,
  READ_STATUS: 0xfa,
  READ_ADDR: 0xfb,
} as const;

export const SEQ55_CH = {
  /** 时序控制 (按面板设定的顺序逐路开/关) */
  SEQ: 0x0d,
  /** 全部通道同步 */
  ALL: 0x10,
} as const;

export type Seq55Channel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

function frame(addr: number, channel: number, action: number): Buffer {
  return Buffer.from([SEQ55_HEAD, addr & 0xff, 0x00, channel & 0xff, action & 0xff, SEQ55_TAIL]);
}

/** 单路开/关: 55 addr 00 ch F0/F1 AA */
export function cmdChannelSwitch(addr: number, channel: Seq55Channel, on: boolean): Buffer {
  return frame(addr, channel, on ? SEQ55_ACTION.ON : SEQ55_ACTION.OFF);
}

/** 8 路顺序开/关 (0D) — 设备按自身时序逐路动作, 保护后级 */
export function cmdSequentialAll(addr: number, on: boolean): Buffer {
  return frame(addr, SEQ55_CH.SEQ, on ? SEQ55_ACTION.ON : SEQ55_ACTION.OFF);
}

/** 8 路同步全开/全关 (10) — 无时序, 全部一起动 */
export function cmdSyncAll(addr: number, on: boolean): Buffer {
  return frame(addr, SEQ55_CH.ALL, on ? SEQ55_ACTION.ON : SEQ55_ACTION.OFF);
}

/** 读状态 (FA) — 返回 `55 addr bitmap 00 F5 AA`，用 parseStatusReply 解析位图 */
export function cmdReadStatus(addr: number): Buffer {
  return frame(addr, 0x00, SEQ55_ACTION.READ_STATUS);
}

/** 读机器地址 (FB): 55 01 00 00 FB AA */
export function cmdReadAddr(addr: number): Buffer {
  return frame(addr, 0x00, SEQ55_ACTION.READ_ADDR);
}

/** 写机器地址 (F2): 新地址直接放第二字节 — 厂家例: 改成02 = 55 02 00 00 F2 AA */
export function cmdWriteAddr(newAddr: number): Buffer {
  return frame(newAddr, 0x00, SEQ55_ACTION.WRITE_ADDR);
}

/** 退出控制 (F3): 55 01 00 00 F3 AA */
export function cmdExitControl(addr: number): Buffer {
  return frame(addr, 0x00, SEQ55_ACTION.EXIT);
}

/**
 * 尝试解析设备回帧。目前只识别"像一帧"的回应 (55 开头 / F5 动作码), 具体数据
 * 布局等到货抓包后补 —— 别猜着写解析, 猜错了会把假状态当真 (电源时序器的
 * parseStatus 偏移方向修反过一次, 教训见 114c6e4)。
 */
export function tryParseReply(buf: Buffer): { valid: boolean; isData: boolean; raw: string } {
  const valid = buf.length >= 6 && buf[0] === SEQ55_HEAD;
  const isData = valid && buf[4] === SEQ55_ACTION.DATA;
  return { valid, isData, raw: buf.toString('hex') };
}

/** 8 路通道数（SEQ55 固定 8 路）。 */
export const SEQ55_CHANNEL_COUNT = 8;

/** 8 路状态位图在数据帧中的字节下标：帧结构 `55 | addr | bitmap | 00 | F5 | AA`。 */
const STATUS_BITMAP_INDEX = 2;

/** 8 路实时状态（与 EPO-802P 的 readStatus 结构对齐，channels[0]=CH1 … [7]=CH8）。 */
export interface Seq55ChannelStatus {
  /** 8 路开关状态，true=该路通电；下标 0 对应第 1 路。 */
  channels: boolean[];
}

/**
 * 解析 FA「读状态」返回的 6 字节数据帧 `55 | addr | bitmap | 00 | F5 | AA`。
 *
 * 第 3 字节即 8 路状态位图：bit=1 该路通电。
 * 现场实测（2026-10-18，COM4@9600）：8 路指示灯全亮时回 `55 01 FF 00 F5 AA`，
 * 与 bitmap=0xFF（11111111）完全吻合。
 *
 * ⚠️ 位序约定：暂按 bit0=CH1 … bit7=CH8（LSB 对应第 1 路）这一常见约定解析。
 * 全亮帧无法区分正反方向，最终顺序需在一次授权的单路 F0/F1 开关 + FA 对照后
 * 锁定；若实测相反，只需翻转本函数的位序（parseStatus 是唯一出口，金标准单测覆盖）。
 */
export function parseStatusReply(buf: Buffer): {
  ok: boolean;
  channels?: boolean[];
  error?: string;
} {
  const parsed = tryParseReply(buf);
  if (!parsed.valid) {
    return { ok: false, error: `无效回帧: ${parsed.raw}` };
  }
  if (!parsed.isData) {
    return { ok: false, error: `非数据(状态)回帧: ${parsed.raw}` };
  }
  if (buf.length < STATUS_BITMAP_INDEX + 1) {
    return { ok: false, error: `状态帧长度不足: ${parsed.raw}` };
  }
  const bitmap = buf[STATUS_BITMAP_INDEX];
  const channels = Array.from(
    { length: SEQ55_CHANNEL_COUNT },
    (_, i) => ((bitmap >> i) & 0x01) === 1,
  );
  return { ok: true, channels };
}
