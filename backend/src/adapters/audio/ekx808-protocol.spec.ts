/**
 * EKX-808 音频矩阵协议 — 金标准测试。
 *
 * 断言用的报文来自两处权威源, 不是我编的:
 *   1) 《EKX-808说明书》官方范例 + docs/AUDIO_PROTOCOL_EKX808.md
 *   2) 2026-07 现场对真机 (@192.168.50.61, devAddr=1) 实测抓到的回包
 * 谁改错一个命令字 / 大小端 / dB 换算, 这里立刻变红 —— 而不是等现场"音量不对"。
 */
import {
  buildFrame, parseFrame,
  dbToCode, codeToDb, levelByteToDb, percentToDb,
  cmdReadGain, cmdReadMute, cmdReadPreset, cmdReadFullMatrix,
  cmdSetOutputVolume, cmdSetInputVolume, cmdSetMatrix, cmdReadMatrixCell,
  cmdRecallUserPreset, cmdRecallFactoryPreset, cmdMute, cmdGroupVolume,
  cmdAuxSwitch, cmdReadLevel,
  parseFullMatrix,
  AUX_SW, IO_IN, IO_OUT, type ChannelIndex,
} from './ekx808-protocol';

const hex = (b: Buffer): string => b.toString('hex').toUpperCase();

describe('EKX-808 帧构造 buildFrame', () => {
  it('固定 9 字节 [7B 7D addr cmd d1 d2 d3 7D 7B]', () => {
    // 官方范例: 读预设 = 7B7D014A0000007D7B
    expect(hex(buildFrame(1, 0x4a, 0, 0, 0))).toBe('7B7D014A0000007D7B');
  });

  it('devAddr 越界抛 RangeError (合法 1-254)', () => {
    expect(() => buildFrame(0, 0x40)).toThrow(RangeError);
    expect(() => buildFrame(255, 0x40)).toThrow(RangeError);
    expect(() => buildFrame(1, 0x40)).not.toThrow();
    expect(() => buildFrame(254, 0x40)).not.toThrow();
  });

  it('各字节按 &0xff 截断, 不溢出到相邻字节', () => {
    // d1=0x1FF 只应留低字节 0xFF, 不能污染 cmd/d2
    expect(hex(buildFrame(1, 0x48, 0x1ff, 0, 0))).toBe('7B7D0148FF00007D7B');
  });
});

describe('EKX-808 读命令 (现场实测过的真实报文)', () => {
  it('cmdReadGain: 输出 ch0 = 7B7D01480100007D7B (session 实测)', () => {
    expect(hex(cmdReadGain(1, IO_OUT, 0))).toBe('7B7D01480100007D7B');
  });
  it('cmdReadGain: 输入 ch3 = io=0, ch=3', () => {
    expect(hex(cmdReadGain(1, IO_IN, 3))).toBe('7B7D01480003007D7B');
  });
  it('cmdReadMute: 输出 ch0 = 7B7D01490100007D7B (session 实测)', () => {
    expect(hex(cmdReadMute(1, IO_OUT, 0))).toBe('7B7D01490100007D7B');
  });
  it('cmdReadPreset: D1 必须是 0x00 (不是手册表格写的 0x30)', () => {
    // 2026-06-13 实测: D1=0x30 读不到, 0x00 才对. 这条测试锁死这个坑, 防有人"照手册改回 0x30"
    expect(hex(cmdReadPreset(1))).toBe('7B7D014A0000007D7B');
  });
  it('cmdReadFullMatrix = cmd 0x61', () => {
    expect(hex(cmdReadFullMatrix(1))).toBe('7B7D01610000007D7B');
  });
  it('cmdReadMatrixCell: out5 <- in4 = cmd 0x4F', () => {
    expect(hex(cmdReadMatrixCell(1, 5, 4))).toBe('7B7D014F0504007D7B');
  });
});

describe('EKX-808 写命令', () => {
  it('cmdSetMatrix: OUT5<-IN4 打开 = cmd 0x4E, d=[5,4,1]', () => {
    expect(hex(cmdSetMatrix(1, 5, 4, true))).toBe('7B7D014E0504017D7B');
    expect(hex(cmdSetMatrix(1, 5, 4, false))).toBe('7B7D014E0504007D7B');
  });
  it('cmdSetOutputVolume: -8dB -> code 200 -> hi=0 lo=0xC8', () => {
    // dbToCode(-8) = 80 + (-8+20)/0.1 = 200 = 0x00C8
    expect(hex(cmdSetOutputVolume(1, 0, -8))).toBe('7B7D01450000C87D7B');
  });
  it('cmdRecallUserPreset: 预设号越界抛错', () => {
    expect(() => cmdRecallUserPreset(1, 13)).toThrow(RangeError);
    expect(() => cmdRecallUserPreset(1, -1)).toThrow(RangeError);
    expect(hex(cmdRecallUserPreset(1, 3))).toBe('7B7D01430103007D7B'); // 0x43, PRESET_USER=1, 3
  });
});

describe('EKX-808 官方手册范例报文 (回归金标准)', () => {
  // 这些报文抄自《EKX-808说明书》各命令的范例栏, 逐条核对过。
  it('cmdRecallUserPreset U02 = 0x43, Type=User(1), 2', () => {
    expect(hex(cmdRecallUserPreset(1, 2))).toBe('7B7D01430102007D7B');
  });
  it('cmdMute: Out0 解除静音 = 0x42, io=1, ch=0, 0', () => {
    expect(hex(cmdMute(1, IO_OUT, 0, false))).toBe('7B7D01420100007D7B');
    expect(hex(cmdMute(1, IO_OUT, 0, true))).toBe('7B7D01420100017D7B');
  });
  it('cmdSetInputVolume: In0 设 0.0dB -> code 280 = 0x0118', () => {
    expect(hex(cmdSetInputVolume(1, 0, 0))).toBe('7B7D01440001187D7B');
  });
  it('cmdSetOutputVolume: Out1 设 -3.0dB -> code 250 = 0x00FA', () => {
    expect(hex(cmdSetOutputVolume(1, 1, -3))).toBe('7B7D01450100FA7D7B');
  });
  it('cmdReadGain: In0 增益 = 0x48, io=0, ch=0', () => {
    expect(hex(cmdReadGain(1, IO_IN, 0))).toBe('7B7D01480000007D7B');
  });
  it('cmdSetMatrix: Out3 <- In1 开 = 0x4E, [3,1,1]', () => {
    expect(hex(cmdSetMatrix(1, 3, 1, true))).toBe('7B7D014E0301017D7B');
  });
  it('cmdGroupVolume: 输入编组 90% = 0x46, io=0, 0x5A', () => {
    expect(hex(cmdGroupVolume(1, IO_IN, 90))).toBe('7B7D0146005A007D7B');
  });
  it('cmdReadLevel: In0 实时电平 = 0x4D, type=0, ch=0', () => {
    expect(hex(cmdReadLevel(1, 0, 0))).toBe('7B7D014D0000007D7B');
  });
  it('cmdAuxSwitch: 5 个辅助开关 D2=0..4 (效果/摄像/混音/AEC/降噪)', () => {
    // 0x55, D1=0x02 固定, D2=kind, D3=on
    expect(hex(cmdAuxSwitch(1, AUX_SW.EFFECT, true))).toBe('7B7D01550200017D7B');
    expect(hex(cmdAuxSwitch(1, AUX_SW.CAMERA, true))).toBe('7B7D01550201017D7B');
    expect(hex(cmdAuxSwitch(1, AUX_SW.AUTO_MIX, true))).toBe('7B7D01550202017D7B');
    expect(hex(cmdAuxSwitch(1, AUX_SW.AEC, true))).toBe('7B7D01550203017D7B');
    expect(hex(cmdAuxSwitch(1, AUX_SW.NR, true))).toBe('7B7D01550204017D7B');
  });
});

describe('EKX-808 用户预设 U01-U12 全量生成', () => {
  it('每个预设帧 = [0x43, Type=User(1), presetNum]', () => {
    for (let i = 1; i <= 12; i += 1) {
      const buf = cmdRecallUserPreset(1, i);
      expect(buf[3]).toBe(0x43); // CMD.RECALL_PRESET
      expect(buf[4]).toBe(0x01); // PRESET_USER
      expect(buf[5]).toBe(i);    // 预设号
    }
  });
  it('出厂预设 = Type=Factory(0); 预设号越界抛错', () => {
    expect(cmdRecallFactoryPreset(1, 5)[4]).toBe(0x00); // PRESET_FACTORY
    expect(() => cmdRecallFactoryPreset(1, 13)).toThrow(RangeError);
    expect(() => cmdRecallFactoryPreset(1, -1)).toThrow(RangeError);
  });
});

describe('EKX-808 dB <-> 码值换算 (dbToCode / codeToDb)', () => {
  // 码值 3 段折线: 0-80 => -60~-20 (0.5dB/step), 80-280 => -20~0 (0.1), 280-400 => 0~+12 (0.1)
  it('dbToCode 边界点', () => {
    expect(dbToCode(-60)).toEqual({ hi: 0, lo: 0 });     // code 0
    expect(dbToCode(-20)).toEqual({ hi: 0, lo: 80 });    // code 80
    expect(dbToCode(0)).toEqual({ hi: 1, lo: 0x18 });    // code 280 = 0x0118
    expect(dbToCode(12)).toEqual({ hi: 1, lo: 0x90 });   // code 400 = 0x0190
    expect(dbToCode(-8)).toEqual({ hi: 0, lo: 200 });    // code 200 (session 实测: 200=-8dB)
  });
  it('codeToDb 边界点 (与实测的输出增益对得上)', () => {
    expect(codeToDb(0, 0)).toBeCloseTo(-60);
    expect(codeToDb(0, 80)).toBeCloseTo(-20);
    expect(codeToDb(1, 0x18)).toBeCloseTo(0);   // 280
    expect(codeToDb(1, 0x90)).toBeCloseTo(12);  // 400
    expect(codeToDb(0, 200)).toBeCloseTo(-8);   // session: OUT0 读到 code 200 = -8dB
    expect(codeToDb(0, 248)).toBeCloseTo(-3.2); // session: OUT1 code 248
  });
  it('dbToCode 越界 clamp 到 [0,400]', () => {
    expect(dbToCode(-100)).toEqual({ hi: 0, lo: 0 });
    expect(dbToCode(99)).toEqual({ hi: 1, lo: 0x90 });
  });
  it('往返: db -> code -> db 在量化精度内自洽', () => {
    for (const db of [-60, -40, -20, -10, 0, 6, 12]) {
      const { hi, lo } = dbToCode(db);
      expect(codeToDb(hi, lo)).toBeCloseTo(db, 1);
    }
  });
});

describe('EKX-808 实时电平字节 (8位有符号)', () => {
  it('levelByteToDb: 0x80=-128, 0xFF=-1, 0=0, 0x7F=127', () => {
    expect(levelByteToDb(0x80)).toBe(-128);
    expect(levelByteToDb(0xff)).toBe(-1);
    expect(levelByteToDb(0x00)).toBe(0);
    expect(levelByteToDb(0x7f)).toBe(127);
  });
});

describe('EKX-808 界面百分比 -> dB (percentToDb, 单一真源, 防音量自己跳)', () => {
  it('端点与折点', () => {
    expect(percentToDb(0)).toBe(-60);
    expect(percentToDb(100)).toBe(12);
    expect(percentToDb(50)).toBe(-10);       // 折点
    expect(percentToDb(25)).toBeCloseTo(-35); // 低段: -60+(25/50)*50
    expect(percentToDb(75)).toBeCloseTo(1);   // 高段: -10+((75-50)/50)*22
  });
  it('单调递增', () => {
    let prev = -Infinity;
    for (let p = 0; p <= 100; p += 5) {
      const db = percentToDb(p);
      expect(db).toBeGreaterThanOrEqual(prev);
      prev = db;
    }
  });
});

describe('EKX-808 全矩阵回帧解析 parseFullMatrix (真机 24 字节)', () => {
  // 2026-07-16 真机实测回包 (8 组 x 3 字节 = [输出号, 掩码HI, 掩码LO]), 已用 0x4F 逐点
  // 读 64 个交叉点做过 64/64 独立比对, 确认这就是真实布局。
  const real = Buffer.from([
    0x00, 0x00, 0x07, 0x01, 0x00, 0x05, 0x02, 0x00, 0x05, 0x03, 0x00, 0x05,
    0x04, 0x00, 0x0e, 0x05, 0x00, 0x04, 0x06, 0x00, 0x05, 0x07, 0x00, 0x05,
  ]);
  it('OUT0 掩码 0x07 -> IN0,1,2 导通', () => {
    const m = parseFullMatrix(real)!;
    expect(m[0]).toEqual([true, true, true, false, false, false, false, false]);
  });
  it('OUT4 掩码 0x0e -> IN1,2,3; OUT5 掩码 0x04 -> 仅 IN2 (LED 大屏那路)', () => {
    const m = parseFullMatrix(real)!;
    expect(m[4]).toEqual([false, true, true, true, false, false, false, false]);
    expect(m[5]).toEqual([false, false, true, false, false, false, false, false]);
  });
  it('容忍前置包头: 数据段靠"首字节 0..7 递增"定位', () => {
    const withHeader = Buffer.concat([Buffer.from([0xaa, 0xbb]), real]);
    const m = parseFullMatrix(withHeader)!;
    expect(m[0]).toEqual([true, true, true, false, false, false, false, false]);
  });
  it('找不到合法数据段返回 null', () => {
    expect(parseFullMatrix(Buffer.from([1, 2, 3]))).toBeNull();
  });
});

describe('EKX-808 回帧解析 parseFrame', () => {
  it('往返: buildFrame 出来的能被 parseFrame 解回', () => {
    const f = buildFrame(1, 0x48, 1, 2, 3);
    expect(parseFrame(f)).toEqual({ devAddr: 1, cmd: 0x48, payload: Buffer.from([1, 2, 3]) });
  });
  it('帧头/帧尾不对返回 null', () => {
    expect(parseFrame(Buffer.from([0x00, 0x7d, 1, 0x48, 0, 0, 0, 0x7d, 0x7b]))).toBeNull(); // 头错
    expect(parseFrame(Buffer.from([0x7b, 0x7d, 1, 0x48, 0, 0, 0, 0x00, 0x7b]))).toBeNull(); // 尾错
    expect(parseFrame(Buffer.from([0x7b, 0x7d, 1]))).toBeNull(); // 太短
  });
});

// 类型层面的哨兵: ChannelIndex 用到编译期, 这里保证运行期取值范围认知一致
describe('EKX-808 常量自洽', () => {
  it('IO_IN=0 / IO_OUT=1', () => {
    expect(IO_IN).toBe(0);
    expect(IO_OUT).toBe(1);
  });
  it('通道 0-7 都能构帧', () => {
    for (let ch = 0; ch < 8; ch += 1) {
      expect(() => cmdReadGain(1, IO_OUT, ch as ChannelIndex)).not.toThrow();
    }
  });
});
