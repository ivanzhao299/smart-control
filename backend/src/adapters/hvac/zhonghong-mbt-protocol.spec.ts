/**
 * 中弘 B 集控网关 Modbus-TCP (MBT) 协议 — 金标准测试。
 *
 * 断言来自《对接协议-B集控网关》V3.2 的寄存器地址布局和值映射。
 * 这层最阴的坑是 **室温有符号解码** 和 **内机号 -> 寄存器基址** 的算术: 算错基址会
 * 读/控到隔壁那台内机 (业主投诉"我开的不是这台"), 室温符号弄反会把 -1℃ 显示成 255℃。
 */
import {
  stateBaseAddr, ctrlBaseAddr, CTRL_BASE, STATE_REGS_PER_INDOOR, CTRL_REGS_PER_INDOOR,
  MODE_TO_REG, decodeMode, FAN_TO_REG, decodeFan,
  tempToReg, regToTemp, regToRoomTemp,
  decodeIndoorState, STATE_OFFSET,
  parseIndoorAddress,
} from './zhonghong-mbt-protocol';

describe('中弘 内机号 -> 寄存器基址', () => {
  it('状态基址 = 6*n (每内机 6 个只读寄存器)', () => {
    expect(stateBaseAddr(0)).toBe(0);
    expect(stateBaseAddr(1)).toBe(6);
    expect(stateBaseAddr(63)).toBe(378);
    expect(STATE_REGS_PER_INDOOR).toBe(6);
  });
  it('控制基址 = 4000 + 4*n (每内机 4 个可写寄存器)', () => {
    expect(ctrlBaseAddr(0)).toBe(4000);
    expect(ctrlBaseAddr(1)).toBe(4004);
    expect(ctrlBaseAddr(63)).toBe(4252);
    expect(CTRL_BASE).toBe(4000);
    expect(CTRL_REGS_PER_INDOOR).toBe(4);
  });
  it('内机号 0-63 之外抛 RangeError', () => {
    expect(() => stateBaseAddr(-1)).toThrow(RangeError);
    expect(() => stateBaseAddr(64)).toThrow(RangeError);
    expect(() => ctrlBaseAddr(-1)).toThrow(RangeError);
    expect(() => ctrlBaseAddr(64)).toThrow(RangeError);
  });
});

describe('中弘 模式位掩码 (制热1/制冷2/送风4/除湿8)', () => {
  it('MODE_TO_REG 编码', () => {
    expect(MODE_TO_REG.heat).toBe(0x01);
    expect(MODE_TO_REG.cool).toBe(0x02);
    expect(MODE_TO_REG.fan).toBe(0x04);
    expect(MODE_TO_REG.dry).toBe(0x08);
    expect(MODE_TO_REG.auto).toBe(0x02); // 网关无 auto, fallback 制冷
  });
  it('decodeMode 解码 (未知值归 auto)', () => {
    expect(decodeMode(0x01)).toBe('heat');
    expect(decodeMode(0x02)).toBe('cool');
    expect(decodeMode(0x04)).toBe('fan');
    expect(decodeMode(0x08)).toBe('dry');
    expect(decodeMode(0x00)).toBe('auto');
    expect(decodeMode(0x99)).toBe('auto'); // 高位被 &0x0f 忽略, 0x9→非法→auto
  });
});

describe('中弘 风速 (0自动/1低/2中/3高)', () => {
  it('FAN_TO_REG 编码', () => {
    expect(FAN_TO_REG).toEqual({ auto: 0, low: 1, mid: 2, high: 3 });
  });
  it('decodeFan 解码 (未知值归 auto)', () => {
    expect(decodeFan(0)).toBe('auto');
    expect(decodeFan(1)).toBe('low');
    expect(decodeFan(2)).toBe('mid');
    expect(decodeFan(3)).toBe('high');
    expect(decodeFan(9)).toBe('auto');
  });
});

describe('中弘 设定温度 (16-32℃, 直接十六进制=摄氏)', () => {
  it('tempToReg clamp 16-32', () => {
    expect(tempToReg(20)).toBe(0x14);
    expect(tempToReg(10)).toBe(16); // 下限
    expect(tempToReg(40)).toBe(32); // 上限
    expect(tempToReg(25)).toBe(25);
  });
  it('regToTemp 反算', () => {
    expect(regToTemp(0x14)).toBe(20);
    expect(regToTemp(26)).toBe(26);
  });
});

describe('中弘 室温有符号解码 (0-50℃正, 0xCE-0xFF 负, 中间非法)', () => {
  it('正温区 0x00-0x32', () => {
    expect(regToRoomTemp(0x00)).toBe(0);
    expect(regToRoomTemp(0x1a)).toBe(26);
    expect(regToRoomTemp(0x32)).toBe(50);
  });
  it('负温区 0xCE-0xFF (补码)', () => {
    expect(regToRoomTemp(0xff)).toBe(-1);
    expect(regToRoomTemp(0xce)).toBe(-50);
  });
  it('0x33-0xCD 为非法, 返回 NaN (而不是当成高温度报出去)', () => {
    expect(regToRoomTemp(0x33)).toBeNaN();
    expect(regToRoomTemp(0xcd)).toBeNaN();
  });
});

describe('中弘 整机状态解码 decodeIndoorState', () => {
  it('6 寄存器 -> 完整状态 [开机, 制冷, 20℃, 高风, 室温26, 无故障]', () => {
    // [POWER, MODE, TEMP, FAN, ROOM_TEMP, FAULT]
    const s = decodeIndoorState([1, 0x02, 0x14, 3, 0x1a, 0]);
    expect(s).toEqual({
      on: true, mode: 'cool', temperature: 20, fan: 'high',
      roomTemp: 26, faultCode: 0, online: true,
    });
  });
  it('室温非法时 roomTemp 缺省 (undefined), 不误报', () => {
    const s = decodeIndoorState([1, 0x02, 0x14, 3, 0x80, 0]); // 0x80 在非法区
    expect(s.roomTemp).toBeUndefined();
  });
  it('全 0 寄存器 -> online=false (协议: 温度/模式全 0 视为不在线)', () => {
    expect(decodeIndoorState([0, 0, 0, 0, 0, 0]).online).toBe(false);
  });
  it('寄存器不足 6 个抛错', () => {
    expect(() => decodeIndoorState([1, 2, 3])).toThrow();
  });
  it('STATE_OFFSET 字段序与协议一致', () => {
    expect(STATE_OFFSET).toEqual({ POWER: 0, MODE: 1, TEMP: 2, FAN: 3, ROOM_TEMP: 4, FAULT: 5 });
  });
});

describe('中弘 device.address JSON 解析 parseIndoorAddress', () => {
  it('合法 JSON, 补默认端口 502 / slaveId 1', () => {
    expect(parseIndoorAddress('{"gwHost":"192.168.50.66","n":3}')).toEqual({
      gwHost: '192.168.50.66', gwPort: 502, slaveId: 1, n: 3,
    });
  });
  it('显式端口/slaveId 覆盖默认', () => {
    expect(parseIndoorAddress('{"gwHost":"10.0.0.1","gwPort":5020,"slaveId":2,"n":0}')).toEqual({
      gwHost: '10.0.0.1', gwPort: 5020, slaveId: 2, n: 0,
    });
  });
  it('null / 坏 JSON / 缺字段 → null (不抛异常炸调用方)', () => {
    expect(parseIndoorAddress(null)).toBeNull();
    expect(parseIndoorAddress('not json')).toBeNull();
    expect(parseIndoorAddress('{"gwHost":"x"}')).toBeNull(); // 缺 n
    expect(parseIndoorAddress('{"n":1}')).toBeNull(); // 缺 gwHost
  });
});
