import { AbortedError, sleep } from './adapter.types';
import { DeviceTimeoutError } from './errors';

export interface RetryOptions {
  retries?: number;
  timeoutMs?: number;
  /** 基础重试间隔, 默认 1000ms (Sprint-04 spec Task-009 要求 retryDelayMs=1000) */
  baseDelayMs?: number;
  /** 退避策略: 'fixed' 固定间隔; 'exponential' 指数退避 (baseDelay * 2^(attempt-1)); 默认 fixed */
  backoff?: 'fixed' | 'exponential';
  signal?: AbortSignal;
  onAttemptFail?: (attempt: number, err: unknown) => void;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new DeviceTimeoutError(label, `operation timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const backoffMode = opts.backoff ?? 'fixed';
  const signal = opts.signal;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new AbortedError();
    try {
      return await withTimeout(fn(attempt), timeoutMs, `attempt-${attempt}`);
    } catch (err) {
      lastError = err;
      opts.onAttemptFail?.(attempt, err);
      if (signal?.aborted || err instanceof AbortedError) {
        throw err;
      }
      if (attempt >= retries) break;
      const delay =
        backoffMode === 'exponential'
          ? baseDelay * 2 ** (attempt - 1)
          : baseDelay;
      try {
        await sleep(delay, signal);
      } catch {
        throw lastError;
      }
    }
  }
  throw lastError;
}
