/**
 * 渲染健康软看门狗 (2026-10-07)。
 *
 * 背景: kiosk 用 iframe 播运营大屏, 大屏里重 WebGL 图表曾把 Edge 的 GPU/合成进程卡死、
 * 画面定格, 但主 JS 的定时心跳照常上报, 只看心跳的看门狗发现不了(假健康)。
 *
 * 做法: 起一个运行在独立线程的 Web Worker。主线程用 requestAnimationFrame 周期性报告
 * "还在出帧"; Worker 自己计时, 若连续超过阈值没收到新帧(说明合成/GPU 卡死), 就发
 * reload 信号给主线程, 由主线程执行 window.location.reload() 自愈(WorkerLocation 没有
 * reload() 方法, Worker 无法自行导航)。页面重载由浏览器进程执行, 能真正丢弃并重建卡死
 * 的渲染与 GPU 上下文。若主线程事件循环也卡死、收不到信号, 外部 PowerShell 看门狗
 * (player-watchdog.ps1, 依据心跳里的 renderHealth) 是最终兜底。
 *
 * 同时统计最近帧率与累计卡死次数, 通过 getHealth() 暴露, 由 PlayerPage 放进每次设备
 * 心跳上报后端; 后端 state 与外部 PowerShell 看门狗据此识别"reload 后仍卡死"的极端情况。
 *
 * 仅在前台运行; 页面切后台(文档隐藏)时 rAF 会被浏览器正常暂停, 此时挂起看门狗计时,
 * 切回前台立即恢复, 避免误判。
 */

const workerSource = `
let lastFrameAt = Date.now();
let missedCycles = 0;
let suspended = false;
const CHECK_MS = 5000;
const STALL_LIMIT_MS = 12000;
function tick() {
  if (!suspended) {
    const idleFor = Date.now() - lastFrameAt;
    if (idleFor > STALL_LIMIT_MS) {
      missedCycles++;
      if (missedCycles >= 2) {
        // WorkerLocation has no reload()/assign() (unlike window.location), so the
        // Worker cannot navigate itself. Ask the main thread to reload; in the real
        // failure its event loop is still servicing heartbeats and can act on this.
        self.postMessage({ type: 'reload', idleFor: idleFor });
        return;
      }
    } else {
      missedCycles = 0;
    }
  }
  setTimeout(tick, CHECK_MS);
}
self.onmessage = (e) => {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === 'frame') { lastFrameAt = Date.now(); }
  else if (msg.type === 'suspend') { suspended = true; }
  else if (msg.type === 'resume') { suspended = false; missedCycles = 0; lastFrameAt = Date.now(); }
};
setTimeout(tick, CHECK_MS);
`;

export interface RenderHealth {
  fps: number;
  stalls: number;
  healthy: boolean;
}

export interface RenderWatchdog {
  stop: () => void;
  getHealth: () => RenderHealth;
}

const STALL_KEY = 'sc.render.stallCount';
const HEALTHY_FPS = 5;

export function startRenderWatchdog(): RenderWatchdog {
  let stopped = false;
  let rafId = 0;
  let lastSent = 0;
  let frames = 0;
  let windowStart = performance.now();
  let fps = 0;

  const blob = new Blob([workerSource], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  worker.onmessage = (e: MessageEvent) => {
    if (e.data?.type === 'reload') {
      try {
        const n = Number(sessionStorage.getItem(STALL_KEY) || '0');
        sessionStorage.setItem(STALL_KEY, String(n + 1));
      } catch { /* storage unavailable: best effort */ }
      // Main-thread navigation is executed by the browser process, so it rebuilds the
      // frozen renderer/GPU. If the main loop is also wedged and this never runs, the
      // outer PowerShell watchdog (renderHealth) is the final fallback.
      try { window.location.reload(); } catch { /* fallback handled outside */ }
    }
  };

  function loop(t: number): void {
    if (stopped) return;
    frames++;
    if (t - windowStart >= 1000) {
      fps = Math.round((frames * 1000) / (t - windowStart));
      frames = 0;
      windowStart = t;
    }
    if (t - lastSent > 1000) {
      lastSent = t;
      worker.postMessage({ type: 'frame', t });
    }
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') worker.postMessage({ type: 'suspend' });
    else {
      worker.postMessage({ type: 'resume' });
      lastSent = 0;
      frames = 0;
      windowStart = performance.now();
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
      worker.terminate();
      URL.revokeObjectURL(url);
    },
    getHealth(): RenderHealth {
      let stalls = 0;
      try { stalls = Number(sessionStorage.getItem(STALL_KEY) || '0'); } catch { /* ignore */ }
      return { fps, stalls, healthy: fps >= HEALTHY_FPS };
    },
  };
}
