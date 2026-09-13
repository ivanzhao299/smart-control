/**
 * 极简请求缓存 (PERFORMANCE_AUDIT P2-#13).
 *
 * 灵感来自 SWR / TanStack Query, 但只做我们需要的子集 (~60 行无依赖):
 *   - 同 key 30s 内复用结果, 切页瞬开
 *   - stale 时仍立刻返回旧值, 后台 silent revalidate
 *   - in-flight 请求自动去重 (同 key 并发只发 1 次)
 *   - 显式 invalidate(key) 给写操作后用
 *
 * 用法 (Vue 3):
 *   const { data, isLoading, refresh } = useQuery('devices', () => deviceService.list());
 */

import { onMounted, onBeforeUnmount, ref, type Ref } from 'vue';

interface CacheEntry<T> {
  data: T;
  at: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_STALE_MS = 30_000;

export function getCached<T>(key: string, maxAgeMs = DEFAULT_STALE_MS): T | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > maxAgeMs) return undefined;
  return e.data as T;
}

export function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, at: Date.now() });
}

export function invalidate(prefix: string): void {
  for (const k of cache.keys()) {
    if (k === prefix || k.startsWith(`${prefix}:`)) cache.delete(k);
  }
}

export function invalidateAll(): void {
  cache.clear();
}

/**
 * 拉 + 缓存 (低层 API, 不依赖 Vue).
 * 缓存命中: 立返 cached + 后台 silent revalidate
 * 没缓存: await fetcher
 */
export async function queryOnce<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { staleMs?: number; force?: boolean } = {},
): Promise<T> {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  if (!opts.force) {
    const cached = getCached<T>(key, staleMs);
    if (cached !== undefined) {
      // 立返 + 后台 revalidate (不 await, 不阻塞)
      if (Date.now() - (cache.get(key)?.at ?? 0) > staleMs / 2) {
        void revalidate(key, fetcher);
      }
      return cached;
    }
  }
  // 并发去重: 同 key in-flight 时复用同一 promise
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = (async () => {
    try {
      const result = await fetcher();
      setCached(key, result);
      return result;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

async function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  if (inflight.has(key)) return;
  try {
    await queryOnce(key, fetcher, { force: true });
  } catch {
    /* 静默, 旧 cache 还在能用 */
  }
}

/**
 * Vue 3 hook: 响应式版本.
 * 自动 mount 时 fetch, unmount 时不取消 (静默丢弃结果).
 */
export function useQuery<T>(
  key: string | Ref<string>,
  fetcher: () => Promise<T>,
  opts: { staleMs?: number; immediate?: boolean } = {},
): {
  data: Ref<T | undefined>;
  isLoading: Ref<boolean>;
  error: Ref<Error | null>;
  refresh: (force?: boolean) => Promise<void>;
} {
  const data = ref<T | undefined>(undefined) as Ref<T | undefined>;
  const isLoading = ref(false);
  const error = ref<Error | null>(null);
  let unmounted = false;

  const resolveKey = (): string => (typeof key === 'string' ? key : key.value);

  async function refresh(force = false): Promise<void> {
    const k = resolveKey();
    isLoading.value = true;
    error.value = null;
    try {
      const result = await queryOnce(k, fetcher, { staleMs: opts.staleMs, force });
      if (!unmounted) data.value = result;
    } catch (err) {
      if (!unmounted) error.value = err as Error;
    } finally {
      if (!unmounted) isLoading.value = false;
    }
  }

  onMounted(() => {
    // mount 时立刻吃 cache (如果有), 然后才 revalidate
    const cached = getCached<T>(resolveKey(), opts.staleMs);
    if (cached !== undefined) data.value = cached;
    if (opts.immediate !== false) void refresh();
  });
  onBeforeUnmount(() => { unmounted = true; });

  return { data, isLoading, error, refresh };
}
