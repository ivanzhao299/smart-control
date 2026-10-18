/**
 * "55…AA" 6 字节时序器协议 — 厂家协议单例帧逐字节金标准 (2026-07-29)。
 * 图片原件: 业主拍的串口协议页 (波特率 9600, 6 小节帧)。
 */
import {
  cmdChannelSwitch, cmdSequentialAll, cmdSyncAll,
  cmdReadStatus, cmdReadAddr, cmdWriteAddr, cmdExitControl,
  tryParseReply, parseStatusReply, SEQ55_CHANNEL_COUNT,
} from './seq55-protocol';

const hex = (b: Buffer): string => b.toString('hex');

describe('seq55 协议 — 厂家例帧金标准', () => {
  it('单路开: 第一路开 55 01 00 01 F0 AA / 第八路开 55 01 00 08 F0 AA', () => {
    expect(hex(cmdChannelSwitch(0x01, 1, true))).toBe('55010001f0aa');
    expect(hex(cmdChannelSwitch(0x01, 8, true))).toBe('55010008f0aa');
  });

  it('单路关: 第三路关 55 01 00 03 F1 AA', () => {
    expect(hex(cmdChannelSwitch(0x01, 3, false))).toBe('55010003f1aa');
  });

  it('8路顺序开/关 (0D): 55 01 00 0D F0/F1 AA', () => {
    expect(hex(cmdSequentialAll(0x01, true))).toBe('5501000df0aa');
    expect(hex(cmdSequentialAll(0x01, false))).toBe('5501000df1aa');
  });

  it('8路同步全开/全关 (10): 55 01 00 10 F0/F1 AA', () => {
    expect(hex(cmdSyncAll(0x01, true))).toBe('55010010f0aa');
    expect(hex(cmdSyncAll(0x01, false))).toBe('55010010f1aa');
  });

  it('改地址为02 (F2): 新地址放第二字节 — 55 02 00 00 F2 AA', () => {
    expect(hex(cmdWriteAddr(0x02))).toBe('55020000f2aa');
  });

  it('退出控制 (F3): 55 01 00 00 F3 AA', () => {
    expect(hex(cmdExitControl(0x01))).toBe('55010000f3aa');
  });

  it('读地址 (FB): 55 01 00 00 FB AA', () => {
    expect(hex(cmdReadAddr(0x01))).toBe('55010000fbaa');
  });

  it('读状态 (FA): 55 01 00 00 FA AA', () => {
    expect(hex(cmdReadStatus(0x01))).toBe('55010000faaa');
  });

  it('非默认机器地址跟着走: 地址 02 的第五路关 55 02 00 05 F1 AA', () => {
    expect(hex(cmdChannelSwitch(0x02, 5, false))).toBe('55020005f1aa');
  });

  it('回帧识别: 55 开头算有效帧, 动作 F5 标记为数据帧; 其余不误判', () => {
    expect(tryParseReply(Buffer.from([0x55, 0x01, 0x00, 0x01, 0xf5, 0xaa]))).toEqual(
      { valid: true, isData: true, raw: '55010001f5aa' });
    expect(tryParseReply(Buffer.from([0x55, 0x01, 0x00, 0x01, 0xf0, 0xaa])).isData).toBe(false);
    expect(tryParseReply(Buffer.from([0x00, 0x01])).valid).toBe(false);
  });
});

describe('seq55 FA 状态位图解析 (parseStatusReply, 2026-10-18 COM4 实测)', () => {
  const statusFrame = (bitmap: number) => Buffer.from([0x55, 0x01, bitmap, 0x00, 0xf5, 0xaa]);

  it('现场全亮 55 01 FF 00 F5 AA → 8 路全 true (与现场 8 灯全亮一致)', () => {
    const r = parseStatusReply(statusFrame(0xff));
    expect(r.ok).toBe(true);
    expect(r.channels).toHaveLength(SEQ55_CHANNEL_COUNT);
    expect(r.channels).toEqual([true, true, true, true, true, true, true, true]);
  });

  it('位图 0x00 → 8 路全 false', () => {
    const r = parseStatusReply(statusFrame(0x00));
    expect(r.ok).toBe(true);
    expect(r.channels).toEqual([false, false, false, false, false, false, false, false]);
  });

  it('位图 0x01 → bit0 即 CH1 开 (其余关)', () => {
    expect(parseStatusReply(statusFrame(0x01)).channels).toEqual(
      [true, false, false, false, false, false, false, false]);
  });

  it('位图 0x80 → bit7 即 CH8 开 (其余关)', () => {
    expect(parseStatusReply(statusFrame(0x80)).channels).toEqual(
      [false, false, false, false, false, false, false, true]);
  });

  it('位图 0x05 → CH1 与 CH3 同时开 (bit0 + bit2)', () => {
    expect(parseStatusReply(statusFrame(0x05)).channels).toEqual(
      [true, false, true, false, false, false, false, false]);
  });

  it('取的是第 3 字节(index=2)位图, 而不是第 2 字节地址', () => {
    const r = parseStatusReply(Buffer.from([0x55, 0x01, 0x02, 0x00, 0xf5, 0xaa]));
    expect(r.channels?.[1]).toBe(true); // 0x02 = bit1 = CH2
    expect(r.channels?.[0]).toBe(false);
  });

  it('FB 读地址回帧 (动作位 FB 而非 F5) 不算状态帧 → ok:false', () => {
    const r = parseStatusReply(Buffer.from([0x55, 0x01, 0xff, 0x00, 0xfb, 0xaa]));
    expect(r.ok).toBe(false);
    expect(r.channels).toBeUndefined();
  });

  it('非 55 头 / 过短帧 / 空帧 → ok:false', () => {
    expect(parseStatusReply(Buffer.from([0x00, 0x01, 0xff, 0x00, 0xf5, 0xaa])).ok).toBe(false);
    expect(parseStatusReply(Buffer.from([0x55, 0x01, 0xff])).ok).toBe(false);
    expect(parseStatusReply(Buffer.alloc(0)).ok).toBe(false);
  });

  it('偶发多发 1 字节尾噪 (长度 7) 仍能解析出 8 路, 不判失败', () => {
    const r = parseStatusReply(Buffer.from([0x55, 0x01, 0xff, 0x00, 0xf5, 0xaa, 0x00]));
    expect(r.ok).toBe(true);
    expect(r.channels).toHaveLength(SEQ55_CHANNEL_COUNT);
  });
});
