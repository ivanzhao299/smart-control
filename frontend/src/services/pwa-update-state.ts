import { reactive } from 'vue';

/**
 * PWA 更新提示的全局 UI 状态。监控服务检测到新版本后调用 promptUpdate(apply)，
 * 全局横幅据此显示；用户点击“立即更新”执行 apply，“稍后”则关闭并通知监控本次静默。
 */
export const pwaUpdate = reactive({
  visible: false,
  applying: false,
});

let applyFn: (() => void) | null = null;
let dismissFn: (() => void) | null = null;

export function promptUpdate(apply: () => void): void {
  applyFn = apply;
  if (!pwaUpdate.applying) pwaUpdate.visible = true;
}

export function acceptUpdate(): void {
  if (!applyFn) return;
  pwaUpdate.visible = false;
  pwaUpdate.applying = true;
  applyFn();
}

export function declineUpdate(): void {
  pwaUpdate.visible = false;
  dismissFn?.();
}

export function bindDismiss(dismiss: () => void): void {
  dismissFn = dismiss;
}

export function setApplying(): void {
  pwaUpdate.visible = false;
  pwaUpdate.applying = true;
}
