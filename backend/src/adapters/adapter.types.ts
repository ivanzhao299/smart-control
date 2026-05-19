export interface AdapterResult<T = unknown> {
  ok: boolean;
  deviceId: string;
  command: string;
  data?: T;
  error?: string;
  mock: boolean;
  durationMs: number;
}

export interface AdapterContext {
  signal?: AbortSignal;
  operator?: string;
  executionId?: string;
}

export interface DeviceRuntimeStatus {
  online: boolean;
  state: Record<string, unknown>;
  updatedAt: string;
}

export class AbortedError extends Error {
  constructor(message = 'aborted') {
    super(message);
    this.name = 'AbortedError';
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) return Promise.reject(new AbortedError());
    return Promise.resolve();
  }
  return new Promise((resolveFn, reject) => {
    const handleAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolveFn();
    }, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new AbortedError());
        return;
      }
      signal.addEventListener('abort', handleAbort, { once: true });
    }
  });
}
