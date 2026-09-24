import { onScopeDispose, ref, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { hvacService, type HvacZone } from '@/services/hvac.service';
import { captureIdentityGuard, onIdentityChange } from '@/services/identity-boundary';
import { createUnknownIndoorState, type IndoorRow } from '@/features/hvac-view-model';

type TimerHandle = ReturnType<typeof setTimeout>;
type HvacRuntimeService = Pick<typeof hvacService, 'listIndoors' | 'listZones' | 'listStates'>;

interface HvacRuntimeStateOptions {
  indoors: Ref<IndoorRow[]>;
  zones: Ref<HvacZone[]>;
  selected: Ref<Set<number>>;
  isBusy: () => boolean;
  service?: HvacRuntimeService;
  isHidden?: () => boolean;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
  pollMs?: number;
  writeCooldownMs?: number;
  truthRefreshMs?: number;
}

export function useHvacRuntimeState(options: HvacRuntimeStateOptions) {
  const {
    indoors,
    zones,
    selected,
    isBusy,
    service = hvacService,
    isHidden = () => typeof document !== 'undefined' && document.hidden,
    now = () => Date.now(),
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = (handle) => clearTimeout(handle),
    pollMs = 5000,
    writeCooldownMs = 2500,
    truthRefreshMs = 1200,
  } = options;

  const loading = ref(false);
  const lastPollAt = ref<Date | null>(null);
  const pollFailed = ref(false);
  let active = false;
  let baseLoaded = false;
  let disposed = false;
  let lifecycleRevision = 0;
  let catalogRevision = 0;
  let pollRevision = 0;
  let writeRevision = 0;
  let lastWriteAt = 0;
  let pollTimer: TimerHandle | null = null;
  let truthTimer: TimerHandle | null = null;

  function isCurrentLifecycle(revision: number): boolean {
    return active && !disposed && revision === lifecycleRevision;
  }

  function clearPollTimer(): void {
    if (pollTimer !== null) cancel(pollTimer);
    pollTimer = null;
  }

  function clearTruthTimer(): void {
    if (truthTimer !== null) cancel(truthTimer);
    truthTimer = null;
  }

  async function loadAll(): Promise<boolean> {
    const revision = ++catalogRevision;
    const isCurrent = captureIdentityGuard(() => !disposed && revision === catalogRevision);
    loading.value = true;
    try {
      const [ind, nextZones] = await Promise.all([service.listIndoors(), service.listZones()]);
      if (!isCurrent()) return false;
      const previousState = new Map(indoors.value.map((row) => [row.idx, row.state]));
      indoors.value = ind.map((row) => ({
        ...row,
        state: previousState.get(row.idx) ?? createUnknownIndoorState(),
      }));
      zones.value = nextZones;
      const alive = new Set(ind.map((row) => row.idx));
      selected.value = new Set([...selected.value].filter((idx) => alive.has(idx)));
      return true;
    } catch (error) {
      if (isCurrent()) ElMessage.error(`加载空调数据失败: ${(error as Error).message}`);
      return false;
    } finally {
      if (isCurrent()) loading.value = false;
    }
  }

  async function pollStates(ignoreWriteCooldown = false): Promise<boolean> {
    if (!active || disposed || isHidden() || isBusy()) return false;
    if (!ignoreWriteCooldown && now() - lastWriteAt < writeCooldownMs) return false;

    const revision = ++pollRevision;
    const expectedWriteRevision = writeRevision;
    const isCurrent = captureIdentityGuard(() => (
      active
      && !disposed
      && revision === pollRevision
      && expectedWriteRevision === writeRevision
    ));
    try {
      const list = await service.listStates();
      if (!isCurrent()) return false;
      const byIdx = new Map(list.map((state) => [state.idx, state]));
      for (const row of indoors.value) {
        const state = byIdx.get(row.idx);
        if (!state || !state.known) {
          row.state.known = false;
          row.state.online = false;
          continue;
        }
        row.state = {
          known: true,
          on: state.on,
          temperature: state.temperature,
          mode: state.mode,
          fan: state.fan,
          roomTemp: state.roomTemp,
          online: state.online,
          faultCode: state.faultCode,
        };
      }
      lastPollAt.value = new Date(now());
      pollFailed.value = false;
      return true;
    } catch {
      if (isCurrent()) pollFailed.value = true;
      return false;
    }
  }

  function markWrite(): void {
    lastWriteAt = now();
    writeRevision += 1;
    pollRevision += 1;
  }

  function scheduleTruthRefresh(): void {
    clearTruthTimer();
    const lifecycle = lifecycleRevision;
    truthTimer = schedule(() => {
      truthTimer = null;
      if (!isCurrentLifecycle(lifecycle)) return;
      void pollStates(true);
    }, truthRefreshMs);
  }

  function schedulePoll(lifecycle: number): void {
    clearPollTimer();
    pollTimer = schedule(() => {
      pollTimer = null;
      void (async () => {
        await pollStates();
        if (isCurrentLifecycle(lifecycle)) schedulePoll(lifecycle);
      })();
    }, pollMs);
  }

  async function bootstrap(lifecycle: number): Promise<void> {
    if (!baseLoaded) {
      const loaded = await loadAll();
      if (!isCurrentLifecycle(lifecycle) || !loaded) return;
      baseLoaded = true;
    }
    await pollStates();
    if (isCurrentLifecycle(lifecycle)) schedulePoll(lifecycle);
  }

  function startPolling(): void {
    if (active || disposed) return;
    active = true;
    const lifecycle = ++lifecycleRevision;
    void bootstrap(lifecycle);
  }

  function stopPolling(): void {
    active = false;
    lifecycleRevision += 1;
    catalogRevision += 1;
    pollRevision += 1;
    loading.value = false;
    clearPollTimer();
    clearTruthTimer();
  }

  const stopIdentityListener = onIdentityChange(() => {
    baseLoaded = false;
    catalogRevision += 1;
    pollRevision += 1;
    clearPollTimer();
    clearTruthTimer();
    if (!active || disposed) return;
    const lifecycle = ++lifecycleRevision;
    void bootstrap(lifecycle);
  });

  onScopeDispose(() => {
    disposed = true;
    stopIdentityListener();
    stopPolling();
  });

  return {
    loading,
    lastPollAt,
    pollFailed,
    loadAll,
    pollStates,
    markWrite,
    scheduleTruthRefresh,
    startPolling,
    stopPolling,
  };
}
