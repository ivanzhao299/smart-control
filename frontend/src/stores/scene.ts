import { defineStore } from 'pinia';
import { computed, ref, type Component } from 'vue';
import { sceneService } from '@/services/scene.service';
import { sceneIconFor } from '@/composables/useIcons';
import type {
  ExecutionStatus,
  SceneExecution,
  SceneExecutionWsEvent,
  SceneSummary,
  WsEvent,
} from '@/types/api';

const SCENE_ORDER = ['opening', 'reception', 'meeting', 'roadshow', 'cleaning', 'closing'];

/** 当前执行/最近一次执行的展示态 — 用于平板顶部/底部状态条 */
export interface ActiveExecutionView {
  executionId: string;
  sceneCode: string;
  sceneName: string;
  triggerType: 'manual' | 'schedule' | 'system';
  triggerSource: string;
  status: ExecutionStatus;
  totalActions: number;
  successCount: number;
  failedCount: number;
  durationMs?: number;
  step?: string;
  at: string;
}

export const useSceneStore = defineStore('scene', () => {
  const scenes = ref<SceneSummary[]>([]);
  const running = ref<SceneExecution[]>([]);
  const lastExecution = ref<SceneExecution | null>(null);
  const pendingCode = ref<string | null>(null);
  const error = ref<string | null>(null);

  /** Sprint-07: 当前执行 / 最近一次执行的完整状态 (来自 WS scene_execution_* 事件) */
  const activeExecution = ref<ActiveExecutionView | null>(null);

  const orderedScenes = computed<SceneSummary[]>(() => {
    if (scenes.value.length === 0) return [];
    const map = new Map(scenes.value.map((s) => [s.code, s]));
    const known = SCENE_ORDER.map((c) => map.get(c)).filter(Boolean) as SceneSummary[];
    const known_codes = new Set(known.map((s) => s.code));
    const extra = scenes.value.filter((s) => !known_codes.has(s.code));
    return [...known, ...extra];
  });

  const runningByCode = computed(() => {
    const m = new Map<string, SceneExecution>();
    for (const r of running.value) m.set(r.sceneCode, r);
    return m;
  });

  const activeSceneCode = computed(() => {
    if (running.value.length > 0) return running.value[0].sceneCode;
    if (activeExecution.value && activeExecution.value.status === 'success') {
      return activeExecution.value.sceneCode;
    }
    if (lastExecution.value && lastExecution.value.status === 'completed') {
      return lastExecution.value.sceneCode;
    }
    return null;
  });

  const isExecutionRunning = computed(
    () =>
      activeExecution.value !== null &&
      (activeExecution.value.status === 'running' || activeExecution.value.status === 'pending'),
  );

  function iconFor(code: string): Component {
    return sceneIconFor(code);
  }

  async function fetchScenes(): Promise<void> {
    const result = await sceneService.list();
    scenes.value = result.list.filter((s) => s.enabled);
  }

  async function refreshRunning(): Promise<void> {
    running.value = await sceneService.running();
  }

  async function execute(code: string): Promise<SceneExecution> {
    pendingCode.value = code;
    error.value = null;
    try {
      const exec = await sceneService.execute(code);
      lastExecution.value = exec;
      await refreshRunning();
      return exec;
    } catch (err) {
      error.value = (err as Error).message;
      throw err;
    } finally {
      pendingCode.value = null;
    }
  }

  async function stop(code: string): Promise<void> {
    await sceneService.stop(code);
    await refreshRunning();
  }

  function handleWs(event: WsEvent): void {
    if (event.type === 'scene') {
      if (event.status === 'running') {
        void refreshRunning();
      } else if (
        event.status === 'completed' ||
        event.status === 'failed' ||
        event.status === 'stopped'
      ) {
        lastExecution.value = {
          executionId: event.executionId,
          sceneId: 0,
          sceneCode: event.scene,
          sceneName: event.scene,
          operator: 'system',
          status: event.status,
          startedAt: event.at,
          finishedAt: event.at,
          totalActions: 0,
          succeeded: 0,
          failed: event.failures ?? 0,
          failures: [],
        };
        void refreshRunning();
      }
      return;
    }

    // Sprint-07 新事件
    const TERMINAL: Array<SceneExecutionWsEvent['type']> = [
      'scene_execution_success',
      'scene_execution_partial_failed',
      'scene_execution_failed',
      'scene_execution_cancelled',
    ];
    const ALL: Array<SceneExecutionWsEvent['type']> = [
      'scene_execution_started',
      'scene_execution_progress',
      ...TERMINAL,
    ];
    if (!ALL.includes(event.type as SceneExecutionWsEvent['type'])) return;
    const ev = event as SceneExecutionWsEvent;
    activeExecution.value = {
      executionId: ev.executionId,
      sceneCode: ev.sceneCode,
      sceneName: ev.sceneName,
      triggerType: ev.triggerType,
      triggerSource: ev.triggerSource,
      status: ev.status,
      totalActions: ev.totalActions,
      successCount: ev.successCount,
      failedCount: ev.failedCount,
      durationMs: ev.durationMs,
      step: ev.step,
      at: ev.at,
    };
    if (TERMINAL.includes(ev.type)) {
      void refreshRunning();
    }
  }

  return {
    scenes,
    running,
    lastExecution,
    activeExecution,
    pendingCode,
    error,
    orderedScenes,
    runningByCode,
    activeSceneCode,
    isExecutionRunning,
    iconFor,
    fetchScenes,
    refreshRunning,
    execute,
    stop,
    handleWs,
  };
});
