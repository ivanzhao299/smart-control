/**
 * 统一轮询调度器 (PERFORMANCE_AUDIT P0-#3).
 *
 * 替代散落在 App.vue / StatusPage / MonitorAdmin / AlertBanner 里 4 个独立
 * setInterval (8s/10s/20s/30s 错位触发, GK9000 网络抖动时雪崩). 用一个 tick
 * + 订阅者按 intervalMs 自动 throttle, WS 在线时整体降速到 60s, 离线回到 5s.
 */

import { wsClient } from './websocket.service';

export type PollingId = string;

interface Subscriber {
  id: PollingId;
  intervalMs: number;
  fn: () => void | Promise<void>;
  lastRun: number;
}

class PollingScheduler {
  private subs = new Map<PollingId, Subscriber>();
  private tickHandle?: number;
  private tickMs = 5_000;
  private wsOpen = false;

  start(): void {
    if (this.tickHandle) return;
    // 跟随 WS 状态调节速率: WS 在线 → 慢, WS 断 → 回到默认
    wsClient.onState((s) => {
      this.wsOpen = s === 'open';
    });
    this.tickHandle = window.setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.tickHandle) {
      window.clearInterval(this.tickHandle);
      this.tickHandle = undefined;
    }
  }

  /**
   * 订阅: 每 intervalMs 跑一次 fn. 返回 unsubscribe 函数.
   * WS 在线时, 实际间隔会被放大 (× wsOpenMultiplier) 到至少 60s.
   */
  subscribe(id: PollingId, intervalMs: number, fn: () => void | Promise<void>): () => void {
    this.subs.set(id, { id, intervalMs, fn, lastRun: 0 });
    return () => { this.subs.delete(id); };
  }

  /** 立即跑一次某订阅者 (页面拉起时不想等 intervalMs) */
  fireNow(id: PollingId): void {
    const sub = this.subs.get(id);
    if (!sub) return;
    sub.lastRun = Date.now();
    void sub.fn();
  }

  private tick(): void {
    // C3 (2026-07-25): 页面进后台 (切走/锁屏) 全局暂停 — 手机口袋里不打设备不耗电。
    // 回前台下一 tick 自然补跑; lastRun 不动, 到点的订阅立即执行。
    if (typeof document !== 'undefined' && document.hidden) return;
    const now = Date.now();
    for (const sub of this.subs.values()) {
      const targetMs = this.effectiveInterval(sub.intervalMs);
      if (now - sub.lastRun >= targetMs) {
        sub.lastRun = now;
        try {
          void sub.fn();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`polling ${sub.id} threw:`, (err as Error).message);
        }
      }
    }
  }

  /** WS 在线时把轮询间隔放大 6× (但至少 30s), 反正 WS 推送更及时 */
  private effectiveInterval(declared: number): number {
    if (!this.wsOpen) return declared;
    return Math.max(declared * 6, 30_000);
  }
}

export const polling = new PollingScheduler();
