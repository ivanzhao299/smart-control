export interface AdapterResult<T = unknown> {
  ok: boolean;
  deviceId: string;
  command: string;
  data?: T;
  error?: string;
  mock: boolean;
  durationMs: number;
}

/**
 * Sprint-03 spec Task-017 统一执行结果类型
 * 与内部 AdapterResult 一一映射, 用于 service/controller 边界返回。
 */
export interface DeviceCommandResult<T = unknown> {
  success: boolean;
  deviceId: string;
  command: string;
  message: string;
  durationMs: number;
  rawResponse?: T;
}

export function toDeviceCommandResult<T>(r: AdapterResult<T>): DeviceCommandResult<T> {
  return {
    success: r.ok,
    deviceId: r.deviceId,
    command: r.command,
    message: r.error ?? 'ok',
    durationMs: r.durationMs,
    rawResponse: r.data,
  };
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
