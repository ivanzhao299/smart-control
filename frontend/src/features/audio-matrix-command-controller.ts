import { createLatestCommandQueue } from './latest-command-queue';

export interface AudioMatrixCommandControllerOptions {
  read: (key: string) => boolean;
  apply: (key: string, value: boolean) => void;
  execute: (key: string, value: boolean) => Promise<void>;
  onStart?: (key: string) => void;
  onError?: (key: string, error: unknown) => void;
  onIdle?: (key: string) => void;
}

export interface AudioMatrixCommandController {
  toggle: (key: string) => boolean;
  confirmSnapshot: (values: Record<string, boolean>) => void;
  isRunning: (key: string) => boolean;
}

/**
 * Optimistic matrix control layered on the latest-value queue. The controller
 * remembers only device-confirmed values, so a later failed click rolls back to
 * the last successful command rather than to the state before the first click.
 */
export function createAudioMatrixCommandController(
  options: AudioMatrixCommandControllerOptions,
): AudioMatrixCommandController {
  const confirmed = new Map<string, boolean>();
  const queue = createLatestCommandQueue<string, boolean>({
    execute: options.execute,
    onStart: options.onStart,
    onSuccess: (key, value) => { confirmed.set(key, value); },
    onError: (key, error) => {
      const confirmedValue = confirmed.get(key);
      if (confirmedValue !== undefined) options.apply(key, confirmedValue);
      options.onError?.(key, error);
    },
    onIdle: options.onIdle,
  });

  return {
    toggle(key) {
      const before = options.read(key);
      if (!confirmed.has(key)) confirmed.set(key, before);
      const wanted = !before;
      options.apply(key, wanted);
      queue.enqueue(key, wanted);
      return wanted;
    },
    confirmSnapshot(values) {
      confirmed.clear();
      for (const [key, value] of Object.entries(values)) confirmed.set(key, value);
    },
    isRunning: queue.isRunning,
  };
}
