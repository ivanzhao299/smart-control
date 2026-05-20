/**
 * 诺瓦 NovaStar VX1000 / VX400 系列 LED 视频处理器控制协议
 *
 * 数据来源: VX400 Control Protocol V1.0 (Xi'an NovaStar Tech Co., Ltd. 2022-12-22)
 *   - https://www.ezledvisual.com/storage/file/20240926/1727345617795142.pdf
 * VX1000 / VX1000 Pro / VX600 Pro / VX2000 Pro 与 VX400 同一协议族.
 *
 * 通讯:
 *   - TCP 端口: 5200
 *   - UDP 搜索端口: 3800 (本文件未实现, 部署时 IP 直接固定即可)
 *
 * 帧格式:
 *   请求: 55 AA <body> SUM_L SUM_H
 *   响应: AA 55 <body> SUM_L SUM_H
 *   校验和 SUM = sum(body 各字节, 不含 55 AA 和 SUM 自身) + 0x5555
 *          SUM_L = SUM 低 8 位, SUM_H = SUM 高 8 位
 */

const REQ_HEADER = Buffer.from([0x55, 0xaa]);
const RESP_HEADER = Buffer.from([0xaa, 0x55]);

/** 输入源代码 (Appendix II) */
export const VX_SOURCE = {
  HDMI1: 0x11,
  HDMI2: 0x12,
  DVI: 0x00,
  SDI: 0x30,
} as const;
export type VxSourceName = keyof typeof VX_SOURCE;

/** 卡槽 (Appendix III) */
export const VX_CARD_SLOT = {
  HDMI1: 0x00,
  HDMI2: 0x01,
  DVI: 0x02,
  SDI: 0x03,
} as const;

/** 显示模式 (3.2.3) */
export const VX_DISPLAY_MODE = {
  /** 正常显示 ("开屏") */
  NORMAL: 0x03,
  /** 冻结画面 */
  FREEZE: 0x04,
  /** 黑屏 ("关屏") */
  BLACKOUT: 0x05,
  /** 测试图案 */
  TEST_PATTERN: 0x06,
} as const;

/** 计算校验和: 累加 body + 0x5555 */
function checksum(body: number[] | Buffer): { lo: number; hi: number } {
  let sum = 0x5555;
  const arr = Buffer.isBuffer(body) ? Array.from(body) : body;
  for (const b of arr) sum += b & 0xff;
  return { lo: sum & 0xff, hi: (sum >>> 8) & 0xff };
}

/** 组装请求帧: [55 AA] + body + [SUM_L, SUM_H] */
function buildFrame(body: number[]): Buffer {
  const { lo, hi } = checksum(body);
  return Buffer.concat([REQ_HEADER, Buffer.from(body), Buffer.from([lo, hi])]);
}

/** 调亮度 0-255 (3.2.1) */
export function frameBrightness(value: number): Buffer {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  return buildFrame([
    0x00, 0x00, 0xfe, 0xff, 0x01, 0xff, 0xff, 0xff,
    0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x01, 0x00,
    v,
  ]);
}

/** 亮度百分比 0-100 转 raw 0-255 */
export function brightnessPctToRaw(pct: number): number {
  const p = Math.max(0, Math.min(100, pct));
  return Math.round((p / 100) * 255);
}

/** 显示模式 (3.2.3): 正常 / 冻结 / 黑屏 / 测试图 */
export function frameDisplayMode(
  mode: typeof VX_DISPLAY_MODE[keyof typeof VX_DISPLAY_MODE],
  testPatternType = 0,
): Buffer {
  return buildFrame([
    0x00, 0x00, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x04, 0x00, 0x00, 0x13, 0x02, 0x00,
    mode,
    testPatternType & 0xff,
  ]);
}

/** 调用预设 1-10 (3.5.1), presetIdx 是 1-based (1..10) */
export function frameLoadPreset(presetNumber: number): Buffer {
  if (presetNumber < 1 || presetNumber > 10) {
    throw new RangeError(`preset 必须 1-10, got ${presetNumber}`);
  }
  return buildFrame([
    0x00, 0x00, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x01, 0x51, 0x13, 0x01, 0x00,
    presetNumber - 1,
  ]);
}

/** 保存当前配置到预设 1-10 (3.5.2) */
export function frameSavePreset(presetNumber: number): Buffer {
  if (presetNumber < 1 || presetNumber > 10) {
    throw new RangeError(`preset 必须 1-10, got ${presetNumber}`);
  }
  return buildFrame([
    0x00, 0x00, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x02, 0x01, 0x51, 0x13, 0x01, 0x00,
    presetNumber - 1,
  ]);
}

/** 删除预设 (3.5.3) */
export function frameDeletePreset(presetNumber: number): Buffer {
  if (presetNumber < 1 || presetNumber > 10) {
    throw new RangeError(`preset 必须 1-10, got ${presetNumber}`);
  }
  return buildFrame([
    0x00, 0x00, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x04, 0x01, 0x51, 0x13, 0x02, 0x00, 0x00,
    presetNumber - 1,
  ]);
}

/**
 * 设置图层参数 (3.4.2) — 切换图层输入源 + 位置 + 大小
 * 用于"切换显示什么输入"的真实操作.
 *
 * 简化版: 仅 1 个图层, 全屏显示
 *   layerNo: 1-based (1=图层1, 2=图层2)
 *   source:  VX_SOURCE.HDMI1 等
 *   width / height: 整屏分辨率, e.g. 1920 / 1080
 */
export function frameSetLayer(opts: {
  layerNo?: number;
  source: number;
  cardSlot?: number;
  width?: number;
  height?: number;
  startX?: number;
  startY?: number;
  priority?: number;
  opacity?: number;
  switchOn?: boolean;
}): Buffer {
  const layerNo = (opts.layerNo ?? 1) - 1;
  const cardSlot = opts.cardSlot ?? VX_CARD_SLOT.HDMI1;
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const startX = opts.startX ?? 0;
  const startY = opts.startY ?? 0;
  const priority = opts.priority ?? 0; // 0 = 第 1 层(底)
  const opacity = opts.opacity ?? 0x64; // 100%
  const switchOn = opts.switchOn ?? true;
  // Addr = 0x13020010 + layerNo * 0x30
  const addr = 0x13020010 + layerNo * 0x30;
  const addr0 = addr & 0xff;
  const addr1 = (addr >>> 8) & 0xff;
  const addr2 = (addr >>> 16) & 0xff;
  const addr3 = (addr >>> 24) & 0xff;
  // 32-bit LE 拆字节
  const split32 = (n: number): [number, number, number, number] => [
    n & 0xff,
    (n >>> 8) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 24) & 0xff,
  ];
  const [sx0, sx1, sx2, sx3] = split32(startX);
  const [sy0, sy1, sy2, sy3] = split32(startY);
  const [w0, w1, w2, w3] = split32(width);
  const [h0, h1, h2, h3] = split32(height);

  // 协议要求 body 包括 26 个保留 0x00 + Opacity
  const body: number[] = [
    0x00, 0x00, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00,
    addr0, addr1, addr2, addr3,
    0x30, 0x00,
    switchOn ? 0x01 : 0x00, // Switch
    layerNo & 0xff,         // WindowNo (0-based)
    cardSlot & 0xff,
    priority & 0xff,
    opts.source & 0xff,
    sx0, sx1, sx2, sx3,
    sy0, sy1, sy2, sy3,
    w0, w1, w2, w3,
    h0, h1, h2, h3,
    // 26 字节保留
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
    opacity & 0xff,
  ];
  return buildFrame(body);
}

/** 读 ModeID 探活 (3.1.2) */
export function frameReadDeviceId(): Buffer {
  return buildFrame([
    0x00, 0x00, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x00,
  ]);
}

/** 工厂复位 (3.2.4) */
export function frameFactoryReset(): Buffer {
  return buildFrame([
    0x00, 0x00, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x02, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00,
  ]);
}

/** 读取当前输入分辨率 (3.3.2) */
export function frameQueryInputResolution(): Buffer {
  return buildFrame([
    0x00, 0x00, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x01, 0x13, 0x00, 0x01,
  ]);
}

/** 验证响应帧合法 (头 AA 55 + 校验和正确) */
export function verifyResponse(resp: Buffer): { ok: true } | { ok: false; error: string } {
  if (resp.length < 4) return { ok: false, error: `frame too short (${resp.length}B)` };
  if (resp[0] !== RESP_HEADER[0] || resp[1] !== RESP_HEADER[1]) {
    return { ok: false, error: `bad header: ${resp.subarray(0, 2).toString('hex')}` };
  }
  const body = resp.subarray(2, resp.length - 2);
  const { lo, hi } = checksum(body);
  const gotLo = resp[resp.length - 2];
  const gotHi = resp[resp.length - 1];
  if (lo !== gotLo || hi !== gotHi) {
    return {
      ok: false,
      error: `checksum mismatch: got ${gotLo.toString(16)} ${gotHi.toString(16)}, want ${lo.toString(16)} ${hi.toString(16)}`,
    };
  }
  return { ok: true };
}

/**
 * 把项目里 LedInput 字符串映射到 VX1000 的物理动作:
 *   'HDMI1' / 'HDMI2' → 切换图层输入源到对应 HDMI
 *   'welcome' → 加载预设 1 (约定为欢迎页)
 *   'video'   → 加载预设 2 (约定为视频播放)
 *
 * 现场可通过 .env 调整预设号:
 *   LED_PRESET_WELCOME=1
 *   LED_PRESET_VIDEO=2
 */
export type LedInputAction =
  | { kind: 'layer'; source: number }
  | { kind: 'preset'; presetNumber: number };

export function ledInputToAction(
  input: 'HDMI1' | 'HDMI2' | 'welcome' | 'video',
  presets: { welcome: number; video: number },
): LedInputAction {
  switch (input) {
    case 'HDMI1':   return { kind: 'layer', source: VX_SOURCE.HDMI1 };
    case 'HDMI2':   return { kind: 'layer', source: VX_SOURCE.HDMI2 };
    case 'welcome': return { kind: 'preset', presetNumber: presets.welcome };
    case 'video':   return { kind: 'preset', presetNumber: presets.video };
  }
}
