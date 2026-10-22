/**
 * 播放页（LED / 投影仪）需要的电源链路回路。
 *
 * 这组回路与展厅操作员的「电源页」范围故意分开：时序器上的视频源、
 * 音频矩阵和功放不是现场手动电源页要展示的 7 路，但播放页必须能按完整
 * 开机链路读取并控制它们。
 */
export const PLAYER_POWER_CODES = [
  'seq55-6', // LED 诺瓦 V2460
  'seq-4', // 共享音频矩阵
  'seq-2', // LED 大屏功放
  '1f-led', // LED 大屏远程总闸
  'seq55-4', // 投影视频融合器
  'seq55-8', // 投影仪功放
  'seq-5', // 投影仪
] as const;

const PLAYER_POWER_CODE_SET = new Set<string>(PLAYER_POWER_CODES);

export function isPlayerPowerCode(code: string): boolean {
  return PLAYER_POWER_CODE_SET.has(code);
}
