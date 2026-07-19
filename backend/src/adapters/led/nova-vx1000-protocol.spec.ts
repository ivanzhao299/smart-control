/**
 * 诺瓦 NovaStar VX/V 系列 LED 控制器协议 — 金标准测试。
 *
 * 校验和算法 (sum(body)+0x5555, 小端) 是这颗芯片最容易被改错的地方: 算错一个字节,
 * 大屏直接不认命令 (黑屏/不切源)。这里用两种方式钉死它:
 *   1) frameReadDeviceId 的完整校验和手算值 (外部金标准)
 *   2) 请求帧换个帧头当响应, verifyResponse 必须自洽 (算法往返)
 * body 命令字/大小端布局对照 VX400 Control Protocol V1.0。
 */
import {
  frameBrightness, brightnessPctToRaw, frameDisplayMode,
  frameLoadPreset, frameSavePreset, frameDeletePreset,
  frameSetLayer, frameReadDeviceId, frameQueryInputResolution,
  verifyResponse, ledInputToAction,
  VX_SOURCE, VX_DISPLAY_MODE,
} from './nova-vx1000-protocol';

/** 把请求帧 (55 AA ...) 改成响应帧 (AA 55 ...), body/校验和不变 —— 用来验证校验和算法自洽 */
const asResponse = (req: Buffer): Buffer =>
  Buffer.concat([Buffer.from([0xaa, 0x55]), req.subarray(2)]);

describe('Nova 帧头与校验和', () => {
  it('所有请求帧以 55 AA 开头', () => {
    for (const f of [frameReadDeviceId(), frameBrightness(128), frameLoadPreset(1), frameQueryInputResolution()]) {
      expect(f.subarray(0, 2)).toEqual(Buffer.from([0x55, 0xaa]));
    }
  });
  it('frameReadDeviceId 校验和 = 0x102+0x5555 = 0x5657 (LE: 57 56)', () => {
    // body 非零字节仅 FE+02+02 = 0x102, +0x5555 = 0x5657
    expect(frameReadDeviceId().subarray(-2)).toEqual(Buffer.from([0x57, 0x56]));
  });
  it('frameQueryInputResolution 校验和 = 0x114+0x5555 = 0x5669 (LE: 69 56)', () => {
    expect(frameQueryInputResolution().subarray(-2)).toEqual(Buffer.from([0x69, 0x56]));
  });
  it('校验和算法往返: 请求帧当响应帧解, verifyResponse 通过', () => {
    for (const f of [frameReadDeviceId(), frameBrightness(200), frameSetLayer({ source: VX_SOURCE.HDMI1 })]) {
      expect(verifyResponse(asResponse(f))).toEqual({ ok: true });
    }
  });
});

describe('Nova verifyResponse 拒绝坏帧', () => {
  it('帧头不是 AA 55 → 报错', () => {
    const bad = frameReadDeviceId(); // 55 AA 开头, 当响应看帧头就错
    expect(verifyResponse(bad).ok).toBe(false);
  });
  it('校验和被篡改 → 报错', () => {
    const resp = asResponse(frameReadDeviceId());
    resp[resp.length - 1] ^= 0xff;
    expect(verifyResponse(resp).ok).toBe(false);
  });
  it('太短 → 报错', () => {
    expect(verifyResponse(Buffer.from([0xaa, 0x55])).ok).toBe(false);
  });
});

describe('Nova 亮度', () => {
  it('brightnessPctToRaw: 0→0, 100→255, 50→128 (四舍五入)', () => {
    expect(brightnessPctToRaw(0)).toBe(0);
    expect(brightnessPctToRaw(100)).toBe(255);
    expect(brightnessPctToRaw(50)).toBe(128);
  });
  it('brightnessPctToRaw 越界 clamp', () => {
    expect(brightnessPctToRaw(-10)).toBe(0);
    expect(brightnessPctToRaw(999)).toBe(255);
  });
  it('frameBrightness 值 clamp 到 0-255 并落在 body 末位', () => {
    expect(frameBrightness(300).subarray(-3, -2)[0]).toBe(255); // 校验和前一字节 = 亮度值
    expect(frameBrightness(-5).subarray(-3, -2)[0]).toBe(0);
  });
});

describe('Nova 显示模式 (开屏/黑屏/冻结/测试图)', () => {
  it('模式字节落在 body 固定位 (校验和前一字节前的 mode)', () => {
    // frameDisplayMode body: ...[mode][testPatternType]; 帧尾结构 [mode][tpt][sumL][sumH]
    expect(frameDisplayMode(VX_DISPLAY_MODE.BLACKOUT).subarray(-4, -3)[0]).toBe(0x05);
    expect(frameDisplayMode(VX_DISPLAY_MODE.NORMAL).subarray(-4, -3)[0]).toBe(0x03);
  });
  it('常量: 正常=0x03 黑屏=0x05 冻结=0x04 测试图=0x06', () => {
    expect(VX_DISPLAY_MODE).toEqual({ NORMAL: 0x03, FREEZE: 0x04, BLACKOUT: 0x05, TEST_PATTERN: 0x06 });
  });
});

describe('Nova 预设 (1-10, 下发时 -1)', () => {
  it('预设号越界抛 RangeError', () => {
    for (const fn of [frameLoadPreset, frameSavePreset, frameDeletePreset]) {
      expect(() => fn(0)).toThrow(RangeError);
      expect(() => fn(11)).toThrow(RangeError);
      expect(() => fn(1)).not.toThrow();
      expect(() => fn(10)).not.toThrow();
    }
  });
  it('preset 1 → body 末位 0, preset 10 → body 末位 9', () => {
    expect(frameLoadPreset(1).subarray(-3, -2)[0]).toBe(0);
    expect(frameLoadPreset(10).subarray(-3, -2)[0]).toBe(9);
  });
});

describe('Nova 图层设置 (切输入源 + 尺寸, 32位小端拆字节)', () => {
  it('宽 1920 → LE 80 07 00 00, 高 1080 → LE 38 04 00 00 出现在帧里', () => {
    const f = frameSetLayer({ source: VX_SOURCE.HDMI1, width: 1920, height: 1080 });
    expect(f.indexOf(Buffer.from([0x80, 0x07, 0x00, 0x00]))).toBeGreaterThanOrEqual(0);
    expect(f.indexOf(Buffer.from([0x38, 0x04, 0x00, 0x00]))).toBeGreaterThanOrEqual(0);
  });
  it('图层1 与 图层2 地址不同 (Addr = 0x13020010 + layerNo*0x30)', () => {
    const l1 = frameSetLayer({ layerNo: 1, source: VX_SOURCE.HDMI1 });
    const l2 = frameSetLayer({ layerNo: 2, source: VX_SOURCE.HDMI1 });
    expect(l1.equals(l2)).toBe(false);
    // 图层1 地址低字节 0x10, 图层2 = 0x10+0x30 = 0x40
    expect(l1.indexOf(Buffer.from([0x10, 0x00, 0x02, 0x13]))).toBeGreaterThanOrEqual(0);
    expect(l2.indexOf(Buffer.from([0x40, 0x00, 0x02, 0x13]))).toBeGreaterThanOrEqual(0);
  });
  it('输入源字节写进帧 (HDMI2=0x12)', () => {
    expect(frameSetLayer({ source: VX_SOURCE.HDMI2 }).includes(0x12)).toBe(true);
  });
});

describe('Nova LED 输入动作映射 ledInputToAction', () => {
  const presets = { welcome: 1, video: 2 };
  it('HDMI1/HDMI2 → 切图层源', () => {
    expect(ledInputToAction('HDMI1', presets)).toEqual({ kind: 'layer', source: VX_SOURCE.HDMI1 });
    expect(ledInputToAction('HDMI2', presets)).toEqual({ kind: 'layer', source: VX_SOURCE.HDMI2 });
  });
  it('welcome/video → 调预设 (预设号可 .env 配)', () => {
    expect(ledInputToAction('welcome', presets)).toEqual({ kind: 'preset', presetNumber: 1 });
    expect(ledInputToAction('video', { welcome: 3, video: 4 })).toEqual({ kind: 'preset', presetNumber: 4 });
  });
});
