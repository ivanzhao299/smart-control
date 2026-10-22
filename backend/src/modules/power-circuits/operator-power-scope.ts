/**
 * 展厅操作员在前台电源页可见、可操作的固定 1F 回路。
 *
 * 这里故意使用稳定业务 code，而不是生产数据库自增 id：生产同步、备份恢复或
 * 清理种子数据后 id 可能变化，但这七路现场含义不变。
 */
export const OPERATOR_SHOWROOM_POWER_CODES = [
  'ewelink-02b88e41', // 展厅灯带
  'ewelink-02b8942a', // 展厅筒灯、射灯
  '1f-showroom', // 沙盘展位
  'ewelink-02cbf4eb', // 金特夫展厅
  'ewelink-02cbf4ef', // 无纺布展厅
  'ewelink-02cbf50b', // 西展厅
  '1f-led', // 一层 LED 大屏远程总闸
] as const;

const OPERATOR_SHOWROOM_POWER_CODE_SET = new Set<string>(OPERATOR_SHOWROOM_POWER_CODES);

export function isOperatorShowroomPowerCode(code: string): boolean {
  return OPERATOR_SHOWROOM_POWER_CODE_SET.has(code);
}
