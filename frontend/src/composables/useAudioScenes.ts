import { onDeactivated, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { audioService } from '@/services/audio.service';
import { audioConfigService } from '@/services/audio-config.service';
import { createHoldToConfirmController } from '@/features/hold-to-confirm-controller';

export interface AudioScene {
  id: number;
  name: string;
  hint: string;
}

const HOLD_MS = 1100;
const HOLD_MOVE_THRESHOLD = 12;

export function useAudioScenes() {
  const scenes = ref<AudioScene[]>([]);
  const currentScene = ref<number | null>(null);
  const sceneBusy = ref(false);
  const holdId = ref<number | null>(null);
  const holdPct = ref(0);

  async function loadScenes(): Promise<void> {
    try {
      const rows = await audioConfigService.listScenes();
      scenes.value = rows.map((scene) => ({
        id: scene.presetNum,
        name: scene.name,
        hint: scene.hint ?? '',
      }));
    } catch { /* An unavailable optional catalog must not block the page. */ }
  }

  async function recallScene(scene: AudioScene): Promise<void> {
    sceneBusy.value = true;
    const previous = currentScene.value;
    currentScene.value = scene.id;
    ElMessage.info(`切换中: ${scene.name} (U${String(scene.id).padStart(2, '0')})`);
    try {
      const result = await audioService.applyScene(scene.id);
      if (!result.ok) throw new Error(result.error || '场景切换失败');
      ElMessage.success(`场景已切换: ${scene.name} (U${String(scene.id).padStart(2, '0')})`);
    } catch (error) {
      currentScene.value = previous;
      ElMessage.error(`切换 ${scene.name} 失败: ${(error as Error).message}`);
    } finally {
      sceneBusy.value = false;
    }
  }

  const holdController = createHoldToConfirmController<number>({
    durationMs: HOLD_MS,
    movementThreshold: HOLD_MOVE_THRESHOLD,
    now: () => performance.now(),
    schedule: (callback) => requestAnimationFrame(callback),
    cancelScheduled: (id) => cancelAnimationFrame(id),
    onState: (id, progress) => {
      holdId.value = id;
      holdPct.value = progress;
    },
    onConfirm: (id) => {
      const scene = scenes.value.find((candidate) => candidate.id === id);
      if (scene) void recallScene(scene);
    },
  });

  function onHoldStart(scene: AudioScene, event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (sceneBusy.value) return;
    holdController.start(scene.id, { x: event.clientX, y: event.clientY });
  }

  function onHoldMove(event: PointerEvent): void {
    holdController.move({ x: event.clientX, y: event.clientY });
  }

  function onHoldEnd(): void {
    if (holdController.end()) ElMessage.info('按住直到进度环走满才会执行');
  }

  async function refreshCurrentScene(): Promise<void> {
    try {
      const wrapped = await audioService.currentScene();
      const preset = wrapped?.data?.data?.preset;
      if (typeof preset === 'number' && preset >= 1 && preset <= 12) currentScene.value = preset;
    } catch { /* Device readback is best-effort. */ }
  }

  onDeactivated(holdController.cancel);
  onUnmounted(holdController.dispose);

  return {
    scenes,
    currentScene,
    sceneBusy,
    holdId,
    holdPct,
    loadScenes,
    refreshCurrentScene,
    onHoldStart,
    onHoldMove,
    onHoldEnd,
  };
}
