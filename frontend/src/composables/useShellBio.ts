/**
 * 面容登录壳桥助手 (2026-07-31, 壳 v1.1.10 双槽位)。
 *
 * 壳 (Android/iOS) 注入 window.JinhuShell: 密码存壳的加密存储
 * (Keystore/Keychain), scope 区分槽位 —— 'client'=业主访问密码 /
 * 'admin'=后台管理密码。v1.1.9 老壳只有无 scope 的 client 接口,
 * 这里做兼容回退; 浏览器无桥一律返回 null / 静默。
 */

export type ShellBioScope = 'client' | 'admin';
export interface ShellBioState { available: boolean; saved: boolean }

interface ShellBridge {
  bioInfo?: () => string;
  bioInfoScoped?: (scope: string) => string;
  saveBioPassword?: (pwd: string) => void;
  saveBioPasswordScoped?: (scope: string, pwd: string) => void;
  requestBioLogin?: () => void;
  requestBioLoginScoped?: (scope: string) => void;
}

interface ShellWindow {
  JinhuShell?: ShellBridge;
  __jinhuBioLoginOk?: (pwd: string) => void;
  __jinhuBioLoginFail?: () => void;
}

function shell(): ShellBridge | undefined {
  return (window as unknown as ShellWindow).JinhuShell;
}

/** 读壳里该槽位的状态; 无桥 / 老壳不支持该槽位 → null (界面不显示入口) */
export function shellBioRead(scope: ShellBioScope): ShellBioState | null {
  try {
    const s = shell();
    if (!s) return null;
    if (s.bioInfoScoped) return JSON.parse(s.bioInfoScoped(scope)) as ShellBioState;
    if (scope === 'client' && s.bioInfo) return JSON.parse(s.bioInfo()) as ShellBioState;
    return null;
  } catch {
    return null;
  }
}

/** 登录成功后把密码同步进壳 (改密自动更新), 失败静默 */
export function shellBioSave(scope: ShellBioScope, pwd: string): void {
  try {
    const s = shell();
    if (!s || !pwd) return;
    if (s.saveBioPasswordScoped) s.saveBioPasswordScoped(scope, pwd);
    else if (scope === 'client') s.saveBioPassword?.(pwd);
  } catch { /* 桥不可用就算了 */ }
}

/** 弹系统面容验证; 通过后壳把密码经回调注回 */
export function shellBioLogin(
  scope: ShellBioScope,
  onOk: (pwd: string) => void,
  onFail: () => void,
): void {
  const w = window as unknown as ShellWindow;
  const s = shell();
  if (!s) { onFail(); return; }
  w.__jinhuBioLoginOk = onOk;
  w.__jinhuBioLoginFail = onFail;
  if (s.requestBioLoginScoped) s.requestBioLoginScoped(scope);
  else if (scope === 'client' && s.requestBioLogin) s.requestBioLogin();
  else onFail();
}
