export interface PlaybackProgressControllerOptions {
  onProgress: (percent: number) => void;
  now?: () => number;
  schedule?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  cancel?: (timer: ReturnType<typeof setInterval>) => void;
  intervalMs?: number;
}

export interface PlaybackProgressController {
  start: (durationSeconds: number | null, paused?: boolean) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  dispose: () => void;
  isRunning: () => boolean;
}

/**
 * Drives the local playback progress estimate without owning playback state.
 * The backend channel still decides which item is active and whether it is
 * paused; this controller only turns those confirmed values into UI progress.
 */
export function createPlaybackProgressController(
  options: PlaybackProgressControllerOptions,
): PlaybackProgressController {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
  const cancel = options.cancel ?? ((timer) => clearInterval(timer));
  const intervalMs = options.intervalMs ?? 300;

  let timer: ReturnType<typeof setInterval> | null = null;
  let durationSeconds = 0;
  let elapsedSeconds = 0;
  let segmentStartedAt = 0;

  function stopTimer(): void {
    if (timer === null) return;
    cancel(timer);
    timer = null;
  }

  function tick(): void {
    if (timer === null || durationSeconds <= 0) return;
    const elapsed = elapsedSeconds + (now() - segmentStartedAt) / 1000;
    const percent = Math.min(100, (elapsed / durationSeconds) * 100);
    options.onProgress(percent);
    if (elapsed >= durationSeconds) {
      elapsedSeconds = durationSeconds;
      stopTimer();
    }
  }

  function resume(): void {
    if (timer !== null || durationSeconds <= 0 || elapsedSeconds >= durationSeconds) return;
    segmentStartedAt = now();
    timer = schedule(tick, intervalMs);
  }

  return {
    start(nextDurationSeconds, paused = false) {
      stopTimer();
      elapsedSeconds = 0;
      durationSeconds = nextDurationSeconds && nextDurationSeconds > 0
        ? nextDurationSeconds
        : 0;
      options.onProgress(0);
      if (!paused) resume();
    },
    pause() {
      if (timer === null) return;
      elapsedSeconds = Math.min(
        durationSeconds,
        elapsedSeconds + (now() - segmentStartedAt) / 1000,
      );
      stopTimer();
    },
    resume,
    reset() {
      stopTimer();
      durationSeconds = 0;
      elapsedSeconds = 0;
      segmentStartedAt = 0;
      options.onProgress(0);
    },
    dispose: stopTimer,
    isRunning: () => timer !== null,
  };
}
