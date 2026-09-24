// reins.js — 实时渲染「稳定性缰绳」(P0)
// 职责：DPR 钳制、rAF + 帧间隔门控（活跃24/硬顶30、空闲8、冻结0）、活跃/空闲/暂停/隐藏、
//       滑动窗口 FPS 监控、连续低帧自动 L0→L1→L2（带滞回回升）。
// embedded（?embedded=1，由宿主 iframe 加载）时，"是否可见"以宿主 postMessage 的可见性为权威
// —— 因为分页用 visibility:hidden 切换，IntersectionObserver 对"占空间但不可见"的元素会误判。
export const LEVELS = Object.freeze({ L0: 0, L1: 1, L2: 2 });
export const levelName = (l) => ['L0', 'L1', 'L2'][l] || 'L?';

const DEFAULTS = Object.freeze({
  dprMax: 1.25,          // L0 像素比上限（3612×1462 下比 DPR=2 省约 2.56× 填充量）
  dprL1: 0.85,           // L1 像素比
  activeFps: 24,         // 活跃目标帧率
  hardCapFps: 30,        // 硬顶，绝不超过
  idleFps: 8,            // 空闲帧率（仍维持缓慢巡游）
  idleAfterMs: 15000,    // 无交互多久进入空闲
  pauseAfterMs: 300000,  // 前台完全无交互多久才冻结 rAF（大屏设5分钟，避免过早静止）
  lowFpsThreshold: 18,
  lowFpsForMs: 3000,
  recoverFps: 22,
  recoverForMs: 10000,   // 滞回：连续高帧多久才回升
  sampleWindowMs: 1000,
  hudUpdateMs: 500,
});

const FROZEN = (s) => s === 'hidden' || s === 'paused';

export class StabilityReins {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.cfg = { ...DEFAULTS, ...opts };
    this.embedded = !!opts.embedded;

    this.onFrame = null;
    this.onLevelChange = null;
    this.onStateChange = null;
    this.onMetrics = null;

    this.level = LEVELS.L0;
    this.state = 'active';
    this.dpr = 1;

    this._running = false;
    this._raf = 0;
    this._lastT = 0;
    this._lastRenderT = 0;
    this._frames = [];
    this._fps = 0;
    this._lastHudT = 0;
    this._lowSince = 0;
    this._highSince = 0;

    this._lastInteractT = performance.now();
    this._docHidden = document.hidden;
    this._inViewport = true;
    // 嵌入时以宿主为权威，默认 false 直到宿主首次告知；直接打开默认 true
    this._hostVisible = this.embedded ? false : true;

    this._bind();
    this.applyDpr();
  }

  _bind() {
    this._onVis = () => {
      this._docHidden = document.hidden;
      if (!this.embedded && !this._docHidden) this._wake();
      this._reassessState(true);
    };
    this._onInteract = () => {
      this._lastInteractT = performance.now();
      if (FROZEN(this.state)) this._wake();
    };
    this._onIO = (entries) => {
      let became = false;
      for (const e of entries) {
        if (e.isIntersecting && !this._inViewport) became = true;
        this._inViewport = e.isIntersecting;
      }
      if (!this.embedded && became) this._wake();
      this._reassessState(true);
    };
    this._onPageHide = () => this.dispose();

    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('pagehide', this._onPageHide);
    for (const t of ['pointerdown', 'pointermove', 'keydown', 'touchstart']) {
      window.addEventListener(t, this._onInteract, { passive: true });
    }
    this._io = new IntersectionObserver(this._onIO, { threshold: 0.01 });
    this._io.observe(this.renderer.domElement);
  }

  applyDpr() {
    const n = window.devicePixelRatio || 1;
    let d;
    if (this.level === LEVELS.L0) d = Math.min(n, this.cfg.dprMax);
    else if (this.level === LEVELS.L1) d = Math.min(n, this.cfg.dprL1);
    else d = 1;
    this.dpr = d;
    this.renderer.setPixelRatio(d);
    return d;
  }

  _isHidden() {
    if (this.embedded) return !this._hostVisible;
    return this._docHidden || !this._inViewport;
  }

  _targetFps() {
    if (this.state === 'hidden' || this.state === 'paused') return 0;
    if (this.state === 'idle') return this.cfg.idleFps;
    return Math.min(this.cfg.activeFps, this.cfg.hardCapFps);
  }

  _reassessState(force = false, now = performance.now()) {
    let next;
    if (this._isHidden()) next = 'hidden';
    else {
      const idleFor = now - this._lastInteractT;
      if (idleFor >= this.cfg.pauseAfterMs) next = 'paused';
      else if (idleFor >= this.cfg.idleAfterMs) next = 'idle';
      else next = 'active';
    }
    this._setState(next, force);
  }

  _setState(next, force = false) {
    if (!force && this.state === next) return;
    const prev = this.state;
    this.state = next;
    const wasFrozen = FROZEN(prev), willFrozen = FROZEN(next);
    if (!wasFrozen && willFrozen) this._cancelRaf();       // 进入冻结：停 rAF（零 GPU/极低 CPU）
    else if (wasFrozen && !willFrozen) this._startRaf();   // 离开冻结：启 rAF
    if (prev !== next && this.onStateChange) this.onStateChange(next, prev);
  }

  setHostVisible(v) {
    v = !!v;
    const prev = this._hostVisible;
    this._hostVisible = v;
    if (this.embedded && v && !prev) this._wake();
    this._reassessState(true);
  }

  // 恢复可见的统一唤醒：后台时间不计入空闲、回 active（rAF 启停由 _setState 处理）
  _wake() {
    this._lastInteractT = performance.now();
    this._lowSince = 0;
    this._highSince = 0;
    this._setState('active', true);
  }

  start() { this._startRaf(); }
  stop() { this._cancelRaf(); }
  _startRaf() {
    if (this._running) return;
    this._running = true;
    const now = performance.now();
    this._lastT = now;
    this._lastRenderT = now;
    this._raf = requestAnimationFrame(this._tick);
  }
  _cancelRaf() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  renderOnce() {
    const now = performance.now();
    this._lastRenderT = now;
    this._lastT = now;
    if (this.onFrame) this.onFrame(0, now);
  }

  _tick = (now) => {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._tick);

    if (!this._lastT) this._lastT = now;
    let dt = (now - this._lastT) / 1000;
    this._lastT = now;
    if (dt > 0.1) dt = 0.1;

    this._reassessState(false, now);

    const target = this._targetFps();
    if (target <= 0) return; // 冻结态：rAF 已在 _setState 停止，不会走到；双保险
    const interval = 1000 / target;
    const since = now - this._lastRenderT;
    if (since < interval - 0.5) return;

    const fdt = Math.min(since / 1000, 0.1);
    this._lastRenderT = now;
    if (this.onFrame) this.onFrame(fdt, now);
    this._frames.push(now);
    this._updateMetrics(now);
  };

  _updateMetrics(now) {
    const win = this.cfg.sampleWindowMs;
    while (this._frames.length && now - this._frames[0] > win) this._frames.shift();
    this._fps = (this._frames.length * 1000) / win;
    const canJudge = this._targetFps() >= this.cfg.lowFpsThreshold;

    if (canJudge && this.level < LEVELS.L2) {
      if (this._fps < this.cfg.lowFpsThreshold) {
        if (!this._lowSince) this._lowSince = now;
        else if (now - this._lowSince >= this.cfg.lowFpsForMs) this._downgrade(now);
      } else this._lowSince = 0;
    } else this._lowSince = 0;

    if (canJudge && this.level > LEVELS.L0) {
      if (this._fps >= this.cfg.recoverFps) {
        if (!this._highSince) this._highSince = now;
        else if (now - this._highSince >= this.cfg.recoverForMs) this._upgrade(now);
      } else this._highSince = 0;
    } else this._highSince = 0;

    if (now - this._lastHudT >= this.cfg.hudUpdateMs) {
      this._lastHudT = now;
      if (this.onMetrics) {
        this.onMetrics({
          fps: Math.round(this._fps), level: this.level,
          state: this.state, dpr: Number(this.dpr.toFixed(2)),
        });
      }
    }
  }

  _downgrade(now) {
    this._lowSince = 0;
    this._highSince = 0;
    if (this.level >= LEVELS.L2) return;
    const metrics = { fps: Math.round(this._fps) };
    this.level += 1;
    this.applyDpr();
    if (this.onLevelChange) this.onLevelChange(this.level, 'low-fps', metrics);
  }

  _upgrade(now) {
    this._lowSince = 0;
    this._highSince = 0;
    if (this.level <= LEVELS.L0) return;
    this.level -= 1;
    this.applyDpr();
    if (this.onLevelChange) this.onLevelChange(this.level, 'recovered', { fps: Math.round(this._fps) });
  }

  dispose() {
    this._cancelRaf();
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('pagehide', this._onPageHide);
    for (const t of ['pointerdown', 'pointermove', 'keydown', 'touchstart']) {
      window.removeEventListener(t, this._onInteract);
    }
    if (this._io) this._io.disconnect();
  }
}
