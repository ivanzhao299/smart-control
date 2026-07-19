/**
 * 得胜 EPO-802P 8 路电源时序器协议 — 金标准测试。
 *
 * 命令帧断言直接抄厂家《EPO-802P 中控指令表》里的官方例帧 (逐字节核对过)。
 * parseStatus 的布局是本项目踩坑后 **以真机实测反推** 的 (文档写的交错布局是错的):
 *   - 延时段从 buf+9 起 (中间夹了 1 个 00 填充), 少算一位会整体差 256 倍
 *   - 前 16B 是 8 路开延时, 后 16B 是 8 路关延时 (不是文档说的 on/off 交错)
 * 这里用一帧合成回包把这个真实布局钉死, 防有人"照文档改回去"再翻车。
 */
import {
  buildFrame, CHECKSUM, FRAME_TAIL, CMD, DATA_ID,
  cmdChannelSwitch, cmdAllChannels, cmdMasterKey, cmdReadStatus, cmdChannelDelay,
  parseStatus,
} from './epo802p-protocol';

const hex = (b: Buffer): string => b.toString('hex');

describe('EPO-802P 命令帧 (官方例帧逐字节对齐)', () => {
  it('单通道开关 b2: 通道1 关/开', () => {
    // 官方例: 通道1 关 5a5a5a0000b20000010001000000aa
    expect(hex(cmdChannelSwitch(0, 1, false))).toBe('5a5a5a0000b20000010001000000aa');
    expect(hex(cmdChannelSwitch(0, 1, true))).toBe('5a5a5a0000b20000010001000100aa');
  });
  it('单机全部通道 b3: 关 (按时序依次断电)', () => {
    expect(hex(cmdAllChannels(0, false))).toBe('5a5a5a0000b30000000001000000aa');
    expect(hex(cmdAllChannels(0, true))).toBe('5a5a5a0000b30000000001000100aa');
  });
  it('单机总按键 b1: 关', () => {
    expect(hex(cmdMasterKey(0, false))).toBe('5a5a5a0000b10000000001000000aa');
  });
  it('中控读状态 ac: dataId 固定 03', () => {
    // 官方例: 5a5a5a0000ac0000000301000000aa
    expect(hex(cmdReadStatus(0))).toBe('5a5a5a0000ac0000000301000000aa');
  });
  it('通道延时设置 a3: 通道8 关延时 6 秒', () => {
    // 官方例: 5a5a5a0000a30000080201000600aa
    expect(hex(cmdChannelDelay(0, 8, 'off', 6))).toBe('5a5a5a0000a30000080201000600aa');
  });
  it('延时 >255 秒用 2 字节 (数据长度字段跟着变 0200)', () => {
    const f = cmdChannelDelay(0, 1, 'on', 300); // 300 = 0x012C
    // len 字段 = 02 00 (2 字节 body), body = 2C 01 (小端)
    expect(hex(f)).toContain('02002c01');
  });
});

describe('EPO-802P 帧骨架常量', () => {
  it('帧头 5a5a5a / 帧尾 aa / 校验和固定 00', () => {
    expect(CHECKSUM).toBe(0x00);
    expect(FRAME_TAIL).toBe(0xaa);
    const f = buildFrame({ addr: 0, frameType: CMD.CHANNEL_SWITCH, buf: Buffer.from([1]) });
    expect(f.subarray(0, 3)).toEqual(Buffer.from([0x5a, 0x5a, 0x5a]));
    expect(f[f.length - 1]).toBe(0xaa);
    expect(f[f.length - 2]).toBe(0x00); // 校验和永远 00
  });
  it('数据长度是小端 (1 字节 body -> 0100)', () => {
    const f = buildFrame({ addr: 0, frameType: CMD.CHANNEL_SWITCH, buf: Buffer.from([1]) });
    // 长度字段在 body 前: ...chId, dataId, len_lo=01, len_hi=00, body...
    expect(hex(f)).toContain('0100'); // len 小端
  });
  it('DATA_ID: 开延时=01 关延时=02 读状态=03', () => {
    expect(DATA_ID).toEqual({ DELAY_ON: 0x01, DELAY_OFF: 0x02, READ_STATUS: 0x03 });
  });
});

describe('EPO-802P 状态回帧解析 parseStatus (真机实测布局, 非文档布局)', () => {
  // 合成一帧符合"实测布局"的回包:
  //   通道段 ch1开/ch3开; 开延时 1,3,5,7,9,11,13,15; 关延时 15,13,11,9,7,5,3,1
  //   过压 250V (FA 00), 欠压 150V (96 00)
  const resp = Buffer.from([
    0x5a, 0x5a, 0x5a,                               // 帧头 (idx0-2)
    0x00, 0x00, 0xac, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, // 头字段9B (idx3-11), bufStart=12
    0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // 通道1-8 状态 (idx12-19): ch1,ch3 开
    0x00,                                            // 夹在中间的 1B 填充 (idx20)
    0x01, 0x00, 0x03, 0x00, 0x05, 0x00, 0x07, 0x00, // 开延时 ch1-4 (idx21-)
    0x09, 0x00, 0x0b, 0x00, 0x0d, 0x00, 0x0f, 0x00, // 开延时 ch5-8 -> 1,3,5,7,9,11,13,15
    0x0f, 0x00, 0x0d, 0x00, 0x0b, 0x00, 0x09, 0x00, // 关延时 ch1-4
    0x07, 0x00, 0x05, 0x00, 0x03, 0x00, 0x01, 0x00, // 关延时 ch5-8 -> 15,13,11,9,7,5,3,1
    0xfa, 0x00, 0x96, 0x00,                          // 过压250 欠压150 (tail-9 起)
    0x07, 0x13, 0x00, 0x01, 0x00,                    // 开关机月日/时分等 5B 杂项
    0xaa,                                             // 帧尾 (校验和固定00, 解析侧不依赖它)
  ]);

  it('通道状态: ch1/ch3 开, 其余关', () => {
    const s = parseStatus(resp)!;
    expect(s.channels[0]).toBe(true);
    expect(s.channels[1]).toBe(false);
    expect(s.channels[2]).toBe(true);
    expect(s.channels).toHaveLength(8);
  });
  it('延时段: 前16B 开延时 / 后16B 关延时 (非交错), 且偏移对 (否则差256倍)', () => {
    const s = parseStatus(resp)!;
    expect(s.delays[0]).toEqual({ on: 1, off: 15 });
    expect(s.delays[7]).toEqual({ on: 15, off: 1 });
  });
  it('过压/欠压从帧尾倒推 (250V / 150V), 越界会被兜底丢弃', () => {
    const s = parseStatus(resp)!;
    expect(s.overVoltage).toBe(250);
    expect(s.underVoltage).toBe(150);
  });
  it('无帧头 → null', () => {
    expect(parseStatus(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
  });
  it('有帧头但长度不够 → null', () => {
    expect(parseStatus(Buffer.from([0x5a, 0x5a, 0x5a, 0x00, 0x00]))).toBeNull();
  });
});
