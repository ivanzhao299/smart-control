export interface HoldPoint {
  x: number;
  y: number;
}

export interface HoldToConfirmControllerOptions<Key> {
  durationMs: number;
  movementThreshold: number;
  now: () => number;
  schedule: (callback: (now: number) => void) => number;
  cancelScheduled: (id: number) => void;
  onState: (key: Key | null, progress: number) => void;
  onConfirm: (key: Key) => void;
}

export interface HoldToConfirmController<Key> {
  start: (key: Key, point: HoldPoint) => void;
  move: (point: HoldPoint) => void;
  end: () => boolean;
  cancel: () => void;
  dispose: () => void;
}

/**
 * Own one hold-to-confirm gesture at a time. Scheduling and time are injected
 * so completion, cancellation and lifecycle cleanup can be tested without a
 * browser or real timers.
 */
export function createHoldToConfirmController<Key>(
  options: HoldToConfirmControllerOptions<Key>,
): HoldToConfirmController<Key> {
  let activeKey: Key | null = null;
  let startPoint: HoldPoint = { x: 0, y: 0 };
  let startedAt = 0;
  let progress = 0;
  let scheduledId = 0;
  let fired = false;

  function cancelFrame(): void {
    if (scheduledId) options.cancelScheduled(scheduledId);
    scheduledId = 0;
  }

  function resetActive(): void {
    cancelFrame();
    activeKey = null;
    progress = 0;
    options.onState(null, 0);
  }

  function tick(now: number, key: Key): void {
    if (activeKey !== key) return;
    progress = Math.min(100, ((now - startedAt) / options.durationMs) * 100);
    options.onState(key, progress);
    if (progress >= 100) {
      fired = true;
      resetActive();
      options.onConfirm(key);
      return;
    }
    scheduledId = options.schedule((nextNow) => tick(nextNow, key));
  }

  function cancel(): void {
    fired = false;
    resetActive();
  }

  return {
    start(key, point) {
      cancel();
      activeKey = key;
      startPoint = point;
      startedAt = options.now();
      options.onState(key, 0);
      scheduledId = options.schedule((nextNow) => tick(nextNow, key));
    },
    move(point) {
      if (activeKey === null) return;
      if (Math.hypot(point.x - startPoint.x, point.y - startPoint.y) > options.movementThreshold) {
        cancel();
      }
    },
    end() {
      if (fired) {
        fired = false;
        return false;
      }
      const showIncompleteHint = activeKey !== null && progress >= 10 && progress < 100;
      cancel();
      return showIncompleteHint;
    },
    cancel,
    dispose: cancel,
  };
}
