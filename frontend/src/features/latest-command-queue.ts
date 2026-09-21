export interface LatestCommandQueueOptions<Key, Value> {
  execute: (key: Key, value: Value) => Promise<void>;
  onStart?: (key: Key) => void;
  onSuccess?: (key: Key, value: Value) => void;
  onError?: (key: Key, error: unknown, value: Value) => void;
  onIdle?: (key: Key) => void;
}

interface PendingCommand<Value> {
  value: Value;
}

interface CommandState<Value> {
  running: boolean;
  pending?: PendingCommand<Value>;
}

export interface LatestCommandQueue<Key, Value> {
  enqueue: (key: Key, value: Value) => void;
  isRunning: (key: Key) => boolean;
}

/**
 * Serialize commands per key while keeping only the newest value waiting behind
 * the command already in flight. A failed command stops that key until the next
 * enqueue, so a device error cannot release stale intermediate values later.
 */
export function createLatestCommandQueue<Key, Value>(
  options: LatestCommandQueueOptions<Key, Value>,
): LatestCommandQueue<Key, Value> {
  const states = new Map<Key, CommandState<Value>>();

  async function drain(key: Key, state: CommandState<Value>): Promise<void> {
    while (state.pending) {
      const command = state.pending;
      state.pending = undefined;
      try {
        await options.execute(key, command.value);
        options.onSuccess?.(key, command.value);
      } catch (error) {
        state.pending = undefined;
        state.running = false;
        try {
          options.onError?.(key, error, command.value);
        } finally {
          options.onIdle?.(key);
        }
        return;
      }
    }
    state.running = false;
    options.onIdle?.(key);
  }

  function enqueue(key: Key, value: Value): void {
    let state = states.get(key);
    if (!state) {
      state = { running: false };
      states.set(key, state);
    }
    state.pending = { value };
    if (state.running) return;
    state.running = true;
    options.onStart?.(key);
    void drain(key, state);
  }

  return {
    enqueue,
    isRunning: (key) => states.get(key)?.running ?? false,
  };
}
