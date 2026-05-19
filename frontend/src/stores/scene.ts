import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { sceneService } from '@/services/scene.service';
import type { SceneExecution, SceneSummary, WsEvent } from '@/types/api';

const SCENE_ORDER = ['opening', 'reception', 'meeting', 'roadshow', 'cleaning', 'closing'];
const SCENE_ICON: Record<string, string> = {
  opening: '🎉',
  reception: '🤝',
  meeting: '🧑‍💼',
  roadshow: '🎬',
  cleaning: '🧹',
  closing: '🌙',
};

export const useSceneStore = defineStore('scene', () => {
  const scenes = ref<SceneSummary[]>([]);
  const running = ref<SceneExecution[]>([]);
  const lastExecution = ref<SceneExecution | null>(null);
  const pendingCode = ref<string | null>(null);
  const error = ref<string | null>(null);

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
    if (lastExecution.value && lastExecution.value.status === 'completed') {
      return lastExecution.value.sceneCode;
    }
    return null;
  });

  function iconFor(code: string): string {
    return SCENE_ICON[code] ?? '⚙️';
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
    if (event.type !== 'scene') return;
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
  }

  return {
    scenes,
    running,
    lastExecution,
    pendingCode,
    error,
    orderedScenes,
    runningByCode,
    activeSceneCode,
    iconFor,
    fetchScenes,
    refreshRunning,
    execute,
    stop,
    handleWs,
  };
});
