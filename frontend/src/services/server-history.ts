/**
 * 服务器地址历史记录 — 业主连过的每个后端地址都记下来 (MRU 排序, 最多 10 条).
 *
 * 场景: 展厅网络环境变化 (192.168.124.x → 192.168.77.x), PWA 里存的旧地址连不上,
 * 业主打开服务器设置弹窗, 历史列表里点一下就能切回连过的地址, 不用重新输入.
 *
 * 存 localStorage 'sc.client.serverHistory', JSON string[].
 */

const STORAGE_KEY = 'sc.client.serverHistory';
const MAX_ENTRIES = 10;

export function getServerHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

/** 连接成功后调 — 挪到列表最前 (MRU), 超出上限丢最旧的. */
export function addServerHistory(url: string): void {
  const normalized = url.trim().replace(/\/+$/, '');
  if (!normalized || !/^https?:\/\//.test(normalized)) return;
  const list = getServerHistory().filter((x) => x !== normalized);
  list.unshift(normalized);
  save(list.slice(0, MAX_ENTRIES));
}

export function removeServerHistory(url: string): void {
  save(getServerHistory().filter((x) => x !== url));
}

function save(list: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* localStorage 不可用 (隐私模式) — 历史功能静默降级 */
  }
}
