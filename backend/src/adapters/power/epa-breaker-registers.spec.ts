/**
 * 智能断路器 / 远程空开 (ePa · RS485 Modbus) — 金标准测试。
 *
 * 断言取自厂家《485 协议 Modbus 三版》的寄存器表与实测报文:
 *   - 分合闸实测帧: 合 FF 06 01 01 00 01 0D E8 / 分 FF 06 01 01 00 02 4D E9
 *   - 电压实测: A相 00 03 59 89 = 219.529V; 电流 00 00 00 0B = 0.011A
 *   - 开关状态: 0x0027 低字节 0 分 / 1 合 / 2 锁
 * 改错寄存器地址 / 操作值 / U32 大小端 / 换算, 现场就是"控错闸 / 读数不对", 这里先拦住。
 */
import {
  CTRL, MOTOR_OP, DATA_WORD_COUNT, WORD,
  u32, toInt16, decodeSwitchState, decodeElectricStatus, decodeMeasurements,
} from './epa-breaker-registers';
import { ModbusRtuClient } from '../transports/modbus-rtu';

const hex = (b: Buffer): string => b.toString('hex').toUpperCase();

/** 复用运行时同一个 CRC16 + PDU 布局, 构造 FC 0x06 写单寄存器的完整帧 (仅金标准/诊断用) */
function writeSingleFrame(slaveId: number, reg: number, value: number): Buffer {
  const pdu = Buffer.from([
    slaveId & 0xff, 0x06,
    (reg >> 8) & 0xff, reg & 0xff,
    (value >> 8) & 0xff, value & 0xff,
  ]);
  return Buffer.concat([pdu, ModbusRtuClient.crc16(pdu)]);
}

describe('ePa 空开 · 分合闸命令 (锚文档实测帧, 含 CRC)', () => {
  it('合闸 = 写 0x0101 值 0x0001 → FF 06 01 01 00 01 0D E8', () => {
    // 一次性锁死: CTRL.MOTOR_OP 地址 + MOTOR_OP.CLOSE 值 + CRC16 算法
    expect(hex(writeSingleFrame(0xff, CTRL.MOTOR_OP, MOTOR_OP.CLOSE))).toBe('FF06010100010DE8');
  });
  it('分闸 = 写 0x0101 值 0x0002 → FF 06 01 01 00 02 4D E9', () => {
    expect(hex(writeSingleFrame(0xff, CTRL.MOTOR_OP, MOTOR_OP.OPEN))).toBe('FF06010100024DE9');
  });
  it('操作值: 合1 / 分2 / 锁3 / 解锁4', () => {
    expect(MOTOR_OP.CLOSE).toBe(0x0001);
    expect(MOTOR_OP.OPEN).toBe(0x0002);
    expect(MOTOR_OP.LOCK).toBe(0x0003);
    expect(MOTOR_OP.UNLOCK).toBe(0x0004);
  });
  it('控制寄存器地址表', () => {
    expect(CTRL.MOTOR_OP).toBe(0x0101);
    expect(CTRL.CLEAR_ENERGY).toBe(0x0102);
    expect(CTRL.SLAVE_ID).toBe(0x0103);
    expect(CTRL.REMOTE_ENABLE).toBe(0x010b);
  });
});

describe('ePa 空开 · U32 组合 (高前低后, 无符号)', () => {
  it('A相电压实测: u32(0x0003, 0x5989) = 219529 (mV) → 219.529V', () => {
    expect(u32(0x0003, 0x5989)).toBe(219529);
    expect(u32(0x0003, 0x5989) / 1000).toBeCloseTo(219.529, 3);
  });
  it('满量程不溢出 (用乘法而非 <<16)', () => {
    expect(u32(0xffff, 0xffff)).toBe(4294967295);
  });
});

describe('ePa 空开 · 有符号温度寄存器 toInt16', () => {
  it('正温: 0x0C82 = 3202 → 32.02℃', () => {
    expect(toInt16(0x0c82)).toBe(3202);
    expect(toInt16(0x0c82) / 100).toBeCloseTo(32.02, 2);
  });
  it('负温补码: 0xFFFF = -1, 0x8000 = -32768', () => {
    expect(toInt16(0xffff)).toBe(-1);
    expect(toInt16(0x8000)).toBe(-32768);
  });
});

describe('ePa 空开 · 开关状态解码 (0x0027 低字节)', () => {
  it('0 分 / 1 合 / 2 锁 / 其他 unknown', () => {
    expect(decodeSwitchState(0x0000)).toBe('open');
    expect(decodeSwitchState(0x0001)).toBe('closed');
    expect(decodeSwitchState(0x0002)).toBe('locked');
    expect(decodeSwitchState(0x0009)).toBe('unknown');
  });
  it('只看低字节 (高字节是工作模式, 不干扰)', () => {
    expect(decodeSwitchState(0x0101)).toBe('closed'); // mode=1, switch=1
  });
});

describe('ePa 空开 · 电气状态报警位', () => {
  it('位映射: 过压A=bit0 / 漏电=bit11 / 过热A=bit16 / 过能量总=bit23', () => {
    expect(decodeElectricStatus(1 << 0).overVoltage[0]).toBe(true);
    expect(decodeElectricStatus(1 << 11).leakage).toBe(true);
    expect(decodeElectricStatus(1 << 16).overHeat[0]).toBe(true);
    expect(decodeElectricStatus(1 << 23).overEnergy[3]).toBe(true);
  });
  it('全 0 → 无报警; any 汇总', () => {
    expect(decodeElectricStatus(0).any).toBe(false);
    expect(decodeElectricStatus(1 << 8).any).toBe(true); // 过流A
    expect(decodeElectricStatus(1 << 8).overCurrent[0]).toBe(true);
  });
});

describe('ePa 空开 · 全量测量解码 decodeMeasurements', () => {
  // 构造一帧 40 寄存器: A相电压 219.529V / A相电流 0.011A / A接线柱 32.02℃ /
  // 功率因数 0.99 / 频率 50Hz / 开关合闸 / 无报警
  const words = new Array(DATA_WORD_COUNT).fill(0);
  words[WORD.V] = 0x0003; words[WORD.V + 1] = 0x5989;   // V_A = 219.529
  words[WORD.I] = 0x0000; words[WORD.I + 1] = 0x000b;   // I_A = 0.011
  words[WORD.T] = 0x0c82;                                // T_A = 32.02
  words[WORD.PF_FREQ] = 0x6332;                          // PF=0x63/100=0.99, freq=0x32=50
  words[WORD.MODE_SW] = 0x0001;                          // mode=0, switch=closed

  it('电压/电流/温度换算与单位正确', () => {
    const m = decodeMeasurements(words);
    expect(m.voltages[0]).toBeCloseTo(219.529, 3);
    expect(m.currents[0]).toBeCloseTo(0.011, 3);
    expect(m.temperatures[0]).toBeCloseTo(32.02, 2);
  });
  it('功率因数 / 频率 / 开关状态', () => {
    const m = decodeMeasurements(words);
    expect(m.powerFactor).toBeCloseTo(0.99, 2);
    expect(m.frequency).toBe(50);
    expect(m.switchState).toBe('closed');
    expect(m.alarms.any).toBe(false);
  });
  it('漏电电流单独拆出 (I3)', () => {
    const w = [...words];
    w[WORD.I + 6] = 0x0000; w[WORD.I + 7] = 0x001e; // I3 = 30 mA = 0.03A
    expect(decodeMeasurements(w).leakageCurrent).toBeCloseTo(0.03, 3);
  });
  it('寄存器不足 40 个抛错', () => {
    expect(() => decodeMeasurements([0, 0, 0])).toThrow(RangeError);
  });
});
