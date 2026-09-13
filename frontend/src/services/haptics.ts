/**
 * 触感反馈 (2026-07-25 体验升级 A2) — "按下去有回应"。
 *
 * 优先级: APP 壳注入的原生桥 (iOS UIImpactFeedback / 安卓 Vibrator)
 *        → navigator.vibrate (安卓浏览器/PWA)
 *        → 静默 (桌面/不支持的环境, 绝不报错)。
 *
 * 只在**动了真设备**的时刻震 (开关下发/场景执行), 普通点选不震 —— 触感和
 * 状态光一个原则: 反馈留给真正发生的事, 不做装饰。
 */
interface ShellBridge { vibrate?: (ms: number) => void }
declare global { interface Window { JinhuShell?: ShellBridge } }

function buzz(ms: number): void {
  try {
    if (window.JinhuShell?.vibrate) { window.JinhuShell.vibrate(ms); return; }
    if (typeof navigator.vibrate === 'function') navigator.vibrate(ms);
  } catch { /* 触感永远不阻塞业务 */ }
}

export const haptics = {
  /** 轻触: 开关/单设备命令下发 */
  tap(): void { buzz(12); },
  /** 确认: 场景执行 / 批量命令走出去 */
  impact(): void { buzz(28); },
};
