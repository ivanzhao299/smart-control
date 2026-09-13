/**
 * CY-DALI64A 灯光网关寄存器 — 金标准测试。
 *
 * 断言来自厂家手册《单路DALI网关模块说明资料 v1.04》的寄存器地址表和数值范围表:
 *   - 组地址表 (手册 4): 组1 渐变寄存器 0x0001, 组2 0x0009, ... 组16 0x0079
 *   - 短地址表 (手册 5): 短1 0x0081, ... 短64 0x0279
 *   - 场景调用 0x028A (高字节渐变码, 低字节场景号)
 *   - 亮度 0-254, 色温 25-65 (K/100), 渐变 16 级
 * 改错寄存器地址 / 步长 / 换算, 现场就是"调错了灯 / 亮度色温不对", 这里先拦住。
 */
import {
  groupBaseReg, shortBaseReg,
  fadeSecToCode, FADE_TIMES_SEC,
  brightnessPctToRaw, brightnessRawToPct,
  kelvinToCode, codeToKelvin,
  sceneRegisterValue,
  parseOnlineMatrix, parseFaultMatrix,
} from './cy-dali64a-registers';

describe('DALI 组/短地址寄存器计算 (手册地址表)', () => {
  it('组地址: 每组间隔 8 个寄存器 (渐变/亮度/色温/RGBWA)', () => {
    expect(groupBaseReg(1)).toBe(0x0001);
    expect(groupBaseReg(2)).toBe(0x0009);
    expect(groupBaseReg(16)).toBe(0x0079);
  });
  it('短地址: 从 0x0081 起, 每灯 8 个寄存器', () => {
    expect(shortBaseReg(1)).toBe(0x0081);
    expect(shortBaseReg(2)).toBe(0x0089);
    expect(shortBaseReg(64)).toBe(0x0279);
  });
  it('组号 1-16 / 短地址 1-64 之外抛 RangeError', () => {
    expect(() => groupBaseReg(0)).toThrow(RangeError);
    expect(() => groupBaseReg(17)).toThrow(RangeError);
    expect(() => shortBaseReg(0)).toThrow(RangeError);
    expect(() => shortBaseReg(65)).toThrow(RangeError);
  });
});

describe('DALI 渐变时间码 fadeSecToCode (16 级, 最近邻)', () => {
  it('精确档位命中自己', () => {
    expect(fadeSecToCode(0)).toBe(0);
    expect(fadeSecToCode(0.7)).toBe(1);
    expect(fadeSecToCode(90.5)).toBe(15);
  });
  it('非精确值取最近档 (3s 更近 2.8s 而非 4s)', () => {
    expect(fadeSecToCode(3)).toBe(FADE_TIMES_SEC.indexOf(2.8));
  });
  it('负数/0 归 0, 超大值封顶到最慢档 15', () => {
    expect(fadeSecToCode(-5)).toBe(0);
    expect(fadeSecToCode(1000)).toBe(15);
  });
  it('16 级表长度正确', () => {
    expect(FADE_TIMES_SEC).toHaveLength(16);
  });
});

describe('DALI 亮度百分比 <-> 原始值 (0-254)', () => {
  it('端点与中点', () => {
    expect(brightnessPctToRaw(0)).toBe(0);
    expect(brightnessPctToRaw(100)).toBe(254);
    expect(brightnessPctToRaw(50)).toBe(127);
  });
  it('越界 clamp', () => {
    expect(brightnessPctToRaw(-10)).toBe(0);
    expect(brightnessPctToRaw(200)).toBe(254);
  });
  it('原始值反算百分比', () => {
    expect(brightnessRawToPct(0)).toBe(0);
    expect(brightnessRawToPct(254)).toBe(100);
    expect(brightnessRawToPct(127)).toBe(50);
  });
});

describe('DALI 色温 K <-> 码 (码 = K/100, 手册范围 2500-6500)', () => {
  it('端点与中间', () => {
    expect(kelvinToCode(2500)).toBe(25);
    expect(kelvinToCode(6500)).toBe(65);
    expect(kelvinToCode(4000)).toBe(40);
  });
  it('越界 clamp 到 25-65', () => {
    expect(kelvinToCode(1000)).toBe(25);
    expect(kelvinToCode(10000)).toBe(65);
  });
  it('码反算 K', () => {
    expect(codeToKelvin(25)).toBe(2500);
    expect(codeToKelvin(65)).toBe(6500);
  });
});

describe('DALI 场景调用寄存器值 (0x028A: 高字节渐变, 低字节场景号)', () => {
  it('手册范例: 调用场景2 渐变0.7s(码1) = 0x0102', () => {
    expect(sceneRegisterValue(2, 1)).toBe(0x0102);
  });
  it('场景1 无渐变 = 0x0001; 场景16 最慢渐变(码15) = 0x0F10', () => {
    expect(sceneRegisterValue(1, 0)).toBe(0x0001);
    expect(sceneRegisterValue(16, 15)).toBe(0x0f10);
  });
  it('场景号 1-16 之外抛错', () => {
    expect(() => sceneRegisterValue(0, 0)).toThrow(RangeError);
    expect(() => sceneRegisterValue(17, 0)).toThrow(RangeError);
  });
  it('渐变码 clamp 到 0-15', () => {
    expect(sceneRegisterValue(1, 99)).toBe((15 << 8) | 1);
  });
});

describe('DALI 在线/故障位矩阵解析 (4 个 16-bit 字 -> 64 灯)', () => {
  it('word0 bit0 = 短地址1, 位序正确', () => {
    const m = parseOnlineMatrix([0x0001, 0, 0, 0]);
    expect(m).toHaveLength(64);
    expect(m[0]).toBe(true);   // 短地址1
    expect(m[1]).toBe(false);
  });
  it('word3 bit15 = 短地址64', () => {
    const m = parseOnlineMatrix([0, 0, 0, 0x8000]);
    expect(m[63]).toBe(true);
    expect(m[62]).toBe(false);
  });
  it('全 0xFFFF = 64 灯全在线', () => {
    const m = parseOnlineMatrix([0xffff, 0xffff, 0xffff, 0xffff]);
    expect(m.every((x) => x)).toBe(true);
  });
  it('字数不是 4 抛错', () => {
    expect(() => parseOnlineMatrix([0, 0, 0])).toThrow(RangeError);
  });
  it('故障矩阵与在线同解析 (1=故障)', () => {
    expect(parseFaultMatrix([0x0002, 0, 0, 0])[1]).toBe(true);
  });
});
