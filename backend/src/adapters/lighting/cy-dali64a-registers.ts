/**
 * CY-DALI64A 单路 DALI 网关 (元创智控) 寄存器地址 + 数值范围工具
 *
 * 协议要点 (PDF v1.04):
 *   - 8 个寄存器 = 1 组 / 1 短地址: [渐变][亮度][色温][R][G][B][W][A]
 *   - 组地址寄存器:   0x0001 - 0x0080  (1-16 组)
 *   - 短地址寄存器:   0x0081 - 0x0280  (1-64 灯)
 *   - 在线状态:       0x0281 - 0x0284  (4 个 16-bit, 共 64 bit)
 *   - 故障状态:       0x0285 - 0x0288  (同上, 1=故障)
 *   - 场景调用:       0x028A (FC=06; 高字节=渐变时间码, 低字节=场景号 1-16)
 *
 *   - 渐变时间码 0x00-0x0F (16 级别, 立即 → 90.5s)
 *   - 亮度 0x00-0xFE (0-254)
 *   - 色温 0x19-0x41 (2500K-6500K)
 *   - RGBWA 0x00-0xFE
 *   - 场景号 0x01-0x10
 */

export const REG_BASE_GROUP = 0x0001;
export const REG_BASE_SHORT = 0x0081;
export const REG_ONLINE_START = 0x0281; // 0x0281-0x0284
export const REG_FAULT_START = 0x0285; // 0x0285-0x0288
export const REG_SCENE_RECALL = 0x028a;

export const FIELD_FADE = 0;
export const FIELD_BRIGHTNESS = 1;
export const FIELD_KELVIN = 2;
export const FIELD_R = 3;
export const FIELD_G = 4;
export const FIELD_B = 5;
export const FIELD_W = 6;
export const FIELD_A = 7;

export type RegField =
  | typeof FIELD_FADE
  | typeof FIELD_BRIGHTNESS
  | typeof FIELD_KELVIN
  | typeof FIELD_R
  | typeof FIELD_G
  | typeof FIELD_B
  | typeof FIELD_W
  | typeof FIELD_A;

/** 组 N (1-16) 的基准寄存器地址 (= 渐变寄存器) */
export function groupBaseReg(group: number): number {
  if (!Number.isInteger(group) || group < 1 || group > 16) {
    throw new RangeError(`group 必须在 1-16 之间, got ${group}`);
  }
  return REG_BASE_GROUP + (group - 1) * 8;
}

/** 短地址 N (1-64) 的基准寄存器地址 (= 渐变寄存器) */
export function shortBaseReg(short: number): number {
  if (!Number.isInteger(short) || short < 1 || short > 64) {
    throw new RangeError(`short address 必须在 1-64 之间, got ${short}`);
  }
  return REG_BASE_SHORT + (short - 1) * 8;
}

/** 渐变时间码表 (索引 0-15 对应 0x00-0x0F) */
export const FADE_TIMES_SEC = [
  0, 0.7, 1, 1.4, 2, 2.8, 4, 5.7, 8, 11.3, 16, 22.6, 32, 45.3, 64, 90.5,
] as const;

/** 把秒数换成最接近的 DALI 渐变码 (0-15) */
export function fadeSecToCode(sec: number): number {
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  let bestIdx = 0;
  let bestDiff = Math.abs(FADE_TIMES_SEC[0] - sec);
  for (let i = 1; i < FADE_TIMES_SEC.length; i += 1) {
    const d = Math.abs(FADE_TIMES_SEC[i] - sec);
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** 把 UI 端 0-100 百分比换成 DALI 亮度 0-254 */
export function brightnessPctToRaw(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  const clamped = Math.max(0, Math.min(100, pct));
  return Math.round((clamped / 100) * 254);
}

/** DALI 亮度 0-254 转回 0-100 百分比 */
export function brightnessRawToPct(raw: number): number {
  const clamped = Math.max(0, Math.min(254, raw));
  return Math.round((clamped / 254) * 100);
}

/** Kelvin (2500-6500) 转 DALI 色温码 (25-65, i.e. K/100) */
export function kelvinToCode(kelvin: number): number {
  const k = Math.max(2500, Math.min(6500, Math.round(kelvin)));
  return Math.round(k / 100);
}

/** DALI 色温码 (25-65) 转回 Kelvin */
export function codeToKelvin(code: number): number {
  return Math.max(2500, Math.min(6500, code * 100));
}

/** 场景调用寄存器 (0x028A) 的 16-bit 值: 高字节=渐变码, 低字节=场景号 */
export function sceneRegisterValue(sceneNo: number, fadeCode = 0): number {
  if (!Number.isInteger(sceneNo) || sceneNo < 1 || sceneNo > 16) {
    throw new RangeError(`场景号必须在 1-16, got ${sceneNo}`);
  }
  const fade = Math.max(0, Math.min(15, fadeCode));
  return ((fade & 0xff) << 8) | (sceneNo & 0xff);
}

/** 在线状态 4 个寄存器 (0x0281-0x0284) → 64 个布尔值 (短地址 1-64) */
export function parseOnlineMatrix(words: number[]): boolean[] {
  if (words.length !== 4) {
    throw new RangeError(`在线状态需要 4 个寄存器, got ${words.length}`);
  }
  const out: boolean[] = [];
  for (let w = 0; w < 4; w += 1) {
    for (let b = 0; b < 16; b += 1) {
      out.push(((words[w] >>> b) & 1) === 1);
    }
  }
  return out; // out[i] = 短地址 (i+1) 是否在线
}

/** 故障状态: 1=故障, 0=正常 */
export function parseFaultMatrix(words: number[]): boolean[] {
  return parseOnlineMatrix(words);
}
