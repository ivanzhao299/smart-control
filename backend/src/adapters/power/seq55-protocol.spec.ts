/**
 * "55…AA" 6 字节时序器协议 — 厂家协议单例帧逐字节金标准 (2026-07-29)。
 * 图片原件: 业主拍的串口协议页 (波特率 9600, 6 小节帧)。
 */
import {
  cmdChannelSwitch, cmdSequentialAll, cmdSyncAll,
  cmdReadStatus, cmdReadAddr, cmdWriteAddr, cmdExitControl,
  tryParseReply,
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
