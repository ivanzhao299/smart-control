/**
 * 得胜 TAKSTAR EPO-802P 8 路电源时序器 — 中控协议
 *
 * 来源: 厂家《EPO-802P 中控指令表》
 * 物理层: 串口 RS232/485, **波特率 19200**, 现场经串口服务器转 TCP.
 *
 * 帧格式 (定长 15 字节, 控制类命令):
 *   5a5a5a | addr | product | frameType | dataType | userId | chId | dataId | len(2B) | buf | checksum | aa
 *     3B      1B      1B         1B         1B        1B      1B      1B       2B      NB      1B      1B
 *
 * 校验官方例子 (通道1 关): 5a5a5a 00 00 b2 00 00 01 00 0100 00 00 aa  → 15 字节 ✓
 *
 * 几个坑 (文档里明写的):
 *   - **校验和固定 00** (不是真算出来的)
 *   - **数据长度是小端**: 发送 1 字节写 `0100`, 但设备**返回**时写 `0001` (前后两字节位置相反)
 *   - 帧头 5a5a5a / 帧尾 aa 固定
 */

/** 帧头 */
export const FRAME_HEAD = Buffer.from([0x5a, 0x5a, 0x5a]);
/** 帧尾 */
export const FRAME_TAIL = 0xaa;
/** 校验和 — 文档明确固定 00 */
export const CHECKSUM = 0x00;

/** 数据帧类型 (frameType) */
export const CMD = {
  /** a3 通道设置 (开/关延时) */
  CHANNEL_CONFIG: 0xa3,
  /** a5 时间设置 (日期/时钟/上电自启/定时) */
  TIME_CONFIG: 0xa5,
  /** a7 保护设置 (保护/过压/欠压) */
  PROTECT_CONFIG: 0xa7,
  /** a9 系统设置 (保存/调用/语言/ID) */
  SYSTEM_CONFIG: 0xa9,
  /** ac 中控模式读取机器 ID — 读回 8 路通道状态 + 全部参数 */
  READ_STATUS: 0xac,
  /** ae 级联 */
  CASCADE: 0xae,
  /** af 锁定 */
  LOCK: 0xaf,
  /** b1 单机总按键 */
  MASTER_KEY: 0xb1,
  /** b2 单通道控制 */
  CHANNEL_SWITCH: 0xb2,
  /** b3 单机全部通道 */
  ALL_CHANNELS: 0xb3,
} as const;

/** 通道号 1-8 */
export type PowerChannel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** 数据 ID — 通道设置时: 开延时=01 关延时=02 */
export const DATA_ID = {
  DELAY_ON: 0x01,
  DELAY_OFF: 0x02,
  /** 中控模式读 ID 时固定 03 */
  READ_STATUS: 0x03,
} as const;

/**
 * 组帧.
 * @param buf 接收缓冲区内容 (长度自动写进 len 字段, 小端)
 */
export function buildFrame(opts: {
  addr: number;
  frameType: number;
  dataType?: number;
  userId?: number;
  chId?: number;
  dataId?: number;
  buf?: Buffer;
  product?: number;
}): Buffer {
  const body = opts.buf ?? Buffer.alloc(0);
  return Buffer.concat([
    FRAME_HEAD,
    Buffer.from([
      opts.addr & 0xff,
      (opts.product ?? 0x00) & 0xff,
      opts.frameType & 0xff,
      (opts.dataType ?? 0x00) & 0xff,
      (opts.userId ?? 0x00) & 0xff,
      (opts.chId ?? 0x00) & 0xff,
      (opts.dataId ?? 0x00) & 0xff,
      // 数据长度 2B 小端: 1 字节 -> 0100
      body.length & 0xff,
      (body.length >> 8) & 0xff,
    ]),
    body,
    Buffer.from([CHECKSUM, FRAME_TAIL]),
  ]);
}

/**
 * 单通道开关 (b2).
 * 官方例: 通道1 关 5a5a5a0000b20000010001000000aa / 开 ...0100aa
 */
export function cmdChannelSwitch(addr: number, channel: PowerChannel, on: boolean): Buffer {
  return buildFrame({
    addr,
    frameType: CMD.CHANNEL_SWITCH,
    chId: channel,
    buf: Buffer.from([on ? 0x01 : 0x00]),
  });
}

/**
 * 单机全部通道 (b3) — 按时序依次通断, 这才是"时序器"的正经用法.
 * 官方例: 关 5a5a5a0000b30000000001000000aa / 开 ...0100aa
 */
export function cmdAllChannels(addr: number, on: boolean): Buffer {
  return buildFrame({
    addr,
    frameType: CMD.ALL_CHANNELS,
    buf: Buffer.from([on ? 0x01 : 0x00]),
  });
}

/**
 * 单机总按键 (b1) — 等效面板总开关.
 * 官方例: 关 5a5a5a0000b10000000001000000aa / 开 ...0100aa
 */
export function cmdMasterKey(addr: number, on: boolean): Buffer {
  return buildFrame({
    addr,
    frameType: CMD.MASTER_KEY,
    buf: Buffer.from([on ? 0x01 : 0x00]),
  });
}

/**
 * 中控模式读取机器状态 (ac) — 读回 8 路通道状态 + 全部参数.
 * 官方例: 5a5a5a0000ac0000000301000000aa
 * addr 处填要查询的机器 ID.
 */
export function cmdReadStatus(addr: number): Buffer {
  return buildFrame({
    addr,
    frameType: CMD.READ_STATUS,
    dataId: DATA_ID.READ_STATUS,
    buf: Buffer.from([0x00]),
  });
}

/**
 * 通道延时设置 (a3).
 * 官方例: 5a5a5a0000a30000080201000600aa = 通道8 关延时 6 秒
 * @param seconds 0x00~0x03e8 (0-1000)
 */
export function cmdChannelDelay(
  addr: number,
  channel: PowerChannel,
  kind: 'on' | 'off',
  seconds: number,
): Buffer {
  const s = Math.max(0, Math.min(1000, Math.round(seconds)));
  // 官方例子里 1 秒级延时用 1 字节 (数据长度 0100); >255 才需要 2 字节
  const body = s > 0xff ? Buffer.from([s & 0xff, (s >> 8) & 0xff]) : Buffer.from([s]);
  return buildFrame({
    addr,
    frameType: CMD.CHANNEL_CONFIG,
    chId: channel,
    dataId: kind === 'on' ? DATA_ID.DELAY_ON : DATA_ID.DELAY_OFF,
    buf: body,
  });
}

/** 解析出的机器状态 */
export interface Epo802pStatus {
  /** 8 路通道开关状态 (index 0 = 通道1) */
  channels: boolean[];
  /** 每路的开/关延时 (秒), index 0 = 通道1 */
  delays: Array<{ on: number; off: number }>;
  /** 过压保护阈值 (V) */
  overVoltage?: number;
  /** 欠压保护阈值 (V) */
  underVoltage?: number;
}

/**
 * 解析 ac 命令的返回.
 *
 * 文档: 接收缓冲区里
 *   前 8 字节 = 通道 1-8 状态 (01 开 / 00 关)
 *   第 9 字节起 = 参数: 通道1开延时(2B), 通道1关延时(2B), ... 通道8 (共 32B)
 *   接着 过压(2B), 欠压(2B)
 *   再接着 开机月日/关机月日/开机时分秒/关机时分秒/保护/机器ID/定时方式/上电自启 (各 1B)
 *
 * 设备回帧的整体结构跟发送一致 (5a5a5a ... aa), 这里做宽松解析: 找到帧头/帧尾后
 * 取出缓冲区。设备返回的长度字段是小端反的 (0001), 但我们直接按位置取, 不依赖它。
 */
export function parseStatus(resp: Buffer): Epo802pStatus | null {
  // 找帧头
  const start = resp.indexOf(FRAME_HEAD);
  if (start < 0) return null;
  // 帧头(3) + addr/product/frameType/dataType/userId/chId/dataId (7) + len(2) = 12 → 缓冲区起点
  const bufStart = start + 12;
  if (resp.length < bufStart + 8) return null;

  const channels: boolean[] = [];
  for (let i = 0; i < 8; i += 1) channels.push(resp[bufStart + i] === 0x01);

  const delays: Array<{ on: number; off: number }> = [];
  const paramStart = bufStart + 8;
  for (let ch = 0; ch < 8; ch += 1) {
    const o = paramStart + ch * 4;
    if (resp.length < o + 4) break;
    // 参数是 2 字节一个, 按小端读 (跟发送时一致)
    delays.push({
      on: resp[o] | (resp[o + 1] << 8),
      off: resp[o + 2] | (resp[o + 3] << 8),
    });
  }

  const vStart = paramStart + 32;
  let overVoltage: number | undefined;
  let underVoltage: number | undefined;
  if (resp.length >= vStart + 4) {
    overVoltage = resp[vStart] | (resp[vStart + 1] << 8);
    underVoltage = resp[vStart + 2] | (resp[vStart + 3] << 8);
  }

  return { channels, delays, overVoltage, underVoltage };
}
