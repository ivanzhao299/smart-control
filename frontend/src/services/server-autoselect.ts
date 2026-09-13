/**
 * 服务器地址自动选择 (2026-07-25, 网页版对齐 APP 的双地址自动切换)
 *
 * 痛点: localStorage 只记一个地址 —— 现场存的 192.168.77.54 到隧道下不通,
 * 业主就得手输 10.66.66.3, 回展厅又得改回来, 变成"每次登录都要输 IP"。
 *
 * 做法: 启动时 ping 当前 baseURL, 不通就把"服务器历史"里的其他地址挨个试,
 * 第一个通的自动切过去并整页刷新一次 (WS/api 全按新地址重新初始化)。
 * 每个会话只自动切一次 (sessionStorage 标记), 防止在两个都半通不通的地址间打摆。
 */
import { getApiBaseURL, setApiBaseURL } from './http';
import { getServerHistory, addServerHistory } from './server-history';

const SWITCHED_FLAG = 'sc.autoSelect.switched';

function originOf(apiBase: string): string | null {
  try { return new URL(apiBase).origin; } catch { return null; }
}

/** GET {origin}/api/client-auth/ping, 2.5s 超时 */
async function pingOrigin(origin: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(`${origin}/api/client-auth/ping`, { signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function autoSelectServer(): Promise<void> {
  // kiosk 播放器页走 localhost, 永远通, 下面第一步就返回了 — 不用特判
  const current = originOf(getApiBaseURL());
  if (!current) return;
  if (await pingOrigin(current)) {
    // 当前地址就是通的 → 记进历史 (老用户的存量地址也进历史, 换网后才有得切)
    addServerHistory(current);
    return;
  }
  // 每会话只自动切一次, 防止两个半通地址间反复刷新
  try { if (sessionStorage.getItem(SWITCHED_FLAG)) return; } catch { /* ignore */ }

  const candidates = getServerHistory().filter((o) => o !== current);
  for (const origin of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await pingOrigin(origin)) {
      setApiBaseURL(origin);
      try { sessionStorage.setItem(SWITCHED_FLAG, '1'); } catch { /* ignore */ }
      window.location.reload();
      return;
    }
  }
  // 全都不通: 不动, 让页面正常报"连不上", 业主可去登录页改地址
}
