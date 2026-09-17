interface WarmupOptions {
  names: readonly string[];
  load: (name: string) => Promise<unknown> | undefined;
  defer: (run: () => void, delay: number) => () => void;
  idle: (run: () => void) => () => void;
}

/** Asset-only preloading. Never fetch authenticated data outside its owning service. */
export function createRouteWarmup(options: WarmupOptions) {
  let active = false;
  let generation = 0;
  let cancelScheduled: (() => void) | undefined;
  const pending = new Map<string, Promise<void>>();
  const loaded = new Set<string>();

  function warm(name: string): Promise<void> {
    if (!active || loaded.has(name)) return Promise.resolve();
    const existing = pending.get(name);
    if (existing) return existing;
    const requestGeneration = generation;
    const request = Promise.resolve().then(() => {
      if (!active || generation !== requestGeneration) return;
      const result = options.load(name);
      return result?.then(() => { loaded.add(name); });
    }).catch(() => { /* Optional preload failure must remain retryable on navigation. */ })
      .finally(() => { pending.delete(name); });
    pending.set(name, request);
    return request;
  }

  function start(): void {
    if (active) return;
    active = true;
    const runGeneration = ++generation;
    const queue = [...options.names];
    const runNext = () => {
      cancelScheduled = undefined;
      if (!active || generation !== runGeneration) return;
      const name = queue.shift();
      if (name === undefined) return;
      void warm(name).then(() => {
        if (active && generation === runGeneration && queue.length) {
          cancelScheduled = options.idle(runNext);
        }
      });
    };
    cancelScheduled = options.defer(runNext, 800);
  }

  function stop(): void {
    active = false;
    generation++;
    cancelScheduled?.();
    cancelScheduled = undefined;
  }

  return { start, stop, warm };
}
