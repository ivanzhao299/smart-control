/**
 * 极简前端 RUM 埋点 (PERFORMANCE_AUDIT P3-#20).
 *
 * 收集:
 *   - PWA 首屏可用时间 (DOMContentLoaded + 数据 fetch 完)
 *   - 路由切换前后耗时
 *   - API 请求 P50/P95 直方图 (本地 30 桶, 不上报)
 *
 * 不上报到后端 (避免再加一条 noise); 留 window.__rum__.snapshot() 给 dev
 * console 查. 后续要 dashboard 可加 POST /api/metrics/rum.
 */

interface RumStats {
  bootMs: number | null;
  routeChangeMs: Array<{ from: string; to: string; ms: number }>;
  apiTimings: Array<{ url: string; ms: number; status: number; at: number }>;
}

const stats: RumStats = {
  bootMs: null,
  routeChangeMs: [],
  apiTimings: [],
};

const bootStart = performance.now();

export function markBootComplete(): void {
  if (stats.bootMs === null) {
    stats.bootMs = Math.round(performance.now() - bootStart);
  }
}

export function trackRouteChange(from: string, to: string, ms: number): void {
  stats.routeChangeMs.push({ from, to, ms });
  if (stats.routeChangeMs.length > 50) stats.routeChangeMs.shift();
}

export function trackApiCall(url: string, ms: number, status: number): void {
  stats.apiTimings.push({ url, ms, status, at: Date.now() });
  if (stats.apiTimings.length > 200) stats.apiTimings.shift();
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

interface RumSnapshot {
  bootMs: number | null;
  routeP50Ms: number;
  routeP95Ms: number;
  apiP50Ms: number;
  apiP95Ms: number;
  apiErrCount: number;
  recent: {
    routes: RumStats['routeChangeMs'];
    apis: RumStats['apiTimings'];
  };
}

export function snapshot(): RumSnapshot {
  const routeMs = stats.routeChangeMs.map((r) => r.ms);
  const apiMs = stats.apiTimings.map((a) => a.ms);
  return {
    bootMs: stats.bootMs,
    routeP50Ms: pct(routeMs, 50),
    routeP95Ms: pct(routeMs, 95),
    apiP50Ms: pct(apiMs, 50),
    apiP95Ms: pct(apiMs, 95),
    apiErrCount: stats.apiTimings.filter((a) => a.status >= 400 || a.status === 0).length,
    recent: {
      routes: stats.routeChangeMs.slice(-10),
      apis: stats.apiTimings.slice(-20),
    },
  };
}

// 暴露给 console: window.__rum__.snapshot()
if (typeof window !== 'undefined') {
  (window as Window & { __rum__?: { snapshot: () => RumSnapshot } }).__rum__ = { snapshot };
}
