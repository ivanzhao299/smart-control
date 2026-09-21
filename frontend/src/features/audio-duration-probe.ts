export interface AudioDurationProbeElement {
  preload: string;
  src: string;
  duration: number;
  currentTime: number;
  addEventListener: (
    type: 'loadedmetadata' | 'durationchange' | 'error',
    listener: () => void,
  ) => void;
  removeEventListener: (
    type: 'loadedmetadata' | 'durationchange' | 'error',
    listener: () => void,
  ) => void;
}

export interface AudioDurationProbeOptions {
  createAudio?: () => AudioDurationProbeElement;
  scheduleTimeout?: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  cancelTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  timeoutMs?: number;
  seekSeconds?: number;
}

/**
 * Reads an audio duration without playing it. VBR MP3 metadata may initially
 * report Infinity, so a far seek asks the browser to scan the file and this
 * probe keeps listening until a finite duration arrives or the deadline wins.
 */
export function probeAudioDuration(
  sourceUrl: string,
  options: AudioDurationProbeOptions = {},
): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = options.createAudio?.() ?? new Audio();
    const scheduleTimeout = options.scheduleTimeout ?? setTimeout;
    const cancelTimeout = options.cancelTimeout ?? clearTimeout;
    const timeoutMs = options.timeoutMs ?? 6000;
    const seekSeconds = options.seekSeconds ?? 1e7;
    let settled = false;

    const finish = (duration: number | null): void => {
      if (settled) return;
      settled = true;
      cancelTimeout(timer);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('error', onError);
      audio.src = '';
      resolve(duration);
    };
    const resolveFiniteDuration = (): boolean => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return false;
      finish(audio.duration);
      return true;
    };
    const onDurationChange = (): void => { resolveFiniteDuration(); };
    const onLoadedMetadata = (): void => {
      if (resolveFiniteDuration()) return;
      try {
        audio.currentTime = seekSeconds;
      } catch {
        // Some browsers reject the far seek. The bounded timeout remains the fallback.
      }
    };
    const onError = (): void => { finish(null); };
    const timer = scheduleTimeout(() => finish(null), timeoutMs);

    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('error', onError);
    audio.src = sourceUrl;
  });
}
