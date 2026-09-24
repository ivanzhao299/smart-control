import {
  computed,
  onScopeDispose,
  ref,
  watch,
} from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  powerCircuitsService,
  type PowerCircuitView,
} from '@/services/power-circuits.service';

interface PlayerPowerControlsOptions {
  title(): string;
  powerCode(): string | undefined;
  powerNameGroups(): string[][] | undefined;
  captureAction(): () => boolean;
}

/** Resolve the configured group in stable code-first order, without duplicate circuits. */
export function resolvePlayerPowerCircuits(
  circuits: PowerCircuitView[],
  powerCode: string | undefined,
  powerNameGroups: string[][] | undefined,
): PowerCircuitView[] {
  const codes = (powerCode ?? '').split(',').map((code) => code.trim()).filter(Boolean);
  const byCode = codes
    .map((code) => circuits.find((circuit) => circuit.code === code))
    .filter((circuit): circuit is PowerCircuitView => !!circuit);
  const byName = powerNameGroups?.length
    ? circuits.filter((circuit) =>
        circuit.category === 'audio-seq'
        && powerNameGroups.some((keywords) =>
          keywords.every((keyword) => circuit.name.includes(keyword))))
    : [];
  const seen = new Set<number>();
  return [...byCode, ...byName].filter((circuit) => {
    if (seen.has(circuit.id)) return false;
    seen.add(circuit.id);
    return true;
  });
}

/**
 * 播放页显示设备电源控制。
 *
 * 回路目录异步读取和逐路串行下发都绑定当前配置分组与身份边界。旧目录响应、确认框
 * 等待期间的配置变化以及中途失效的设备响应都不能写入新的播放器页面。
 */
export function usePlayerPowerControls(options: PlayerPowerControlsOptions) {
  const powerCircuits = ref<PowerCircuitView[]>([]);
  const powerBusy = ref(false);
  const powerAllOn = computed(() =>
    powerCircuits.value.length > 0 && powerCircuits.value.every((circuit) => circuit.reading.on));
  const selectionKey = computed(() => JSON.stringify({
    codes: options.powerCode() ?? '',
    groups: options.powerNameGroups() ?? [],
  }));

  let scopeDisposed = false;
  let loadRevision = 0;
  let operationRevision = 0;

  function isCurrent(
    key: string,
    action: () => boolean,
    revision: number,
  ): boolean {
    return !scopeDisposed
      && action()
      && selectionKey.value === key
      && operationRevision === revision;
  }

  async function loadPowerCircuits(): Promise<void> {
    const key = selectionKey.value;
    const action = options.captureAction();
    const revision = ++loadRevision;
    if (!options.powerCode() && !options.powerNameGroups()?.length) {
      powerCircuits.value = [];
      return;
    }
    try {
      const circuits = await powerCircuitsService.list();
      if (scopeDisposed || revision !== loadRevision || !action() || key !== selectionKey.value) return;
      powerCircuits.value = resolvePlayerPowerCircuits(
        circuits,
        options.powerCode(),
        options.powerNameGroups(),
      );
    } catch {
      if (scopeDisposed || revision !== loadRevision || !action() || key !== selectionKey.value) return;
      // 电源子系统不可达时保持原界面约定：隐藏播放器页电源开关。
      powerCircuits.value = [];
    }
  }

  watch(selectionKey, () => {
    loadRevision += 1;
    operationRevision += 1;
    powerCircuits.value = [];
    powerBusy.value = false;
    void loadPowerCircuits();
  }, { immediate: true, flush: 'sync' });

  async function togglePower(): Promise<void> {
    if (!powerCircuits.value.length || powerBusy.value) return;
    const turningOff = powerAllOn.value;
    const key = selectionKey.value;
    const action = options.captureAction();
    const revision = ++operationRevision;
    const targets = [...powerCircuits.value];

    if (turningOff) {
      try {
        await ElMessageBox.confirm(`确定断开${options.title()}电源?画面会熄灭。`, '断电确认',
          { type: 'warning', confirmButtonText: '断电', cancelButtonText: '取消' });
      } catch {
        return;
      }
    }
    if (!isCurrent(key, action, revision)) return;

    powerBusy.value = true;
    const failed: string[] = [];
    try {
      // 多路设备共用串口链路，保持逐路下发；以设备 ID 写回，避免目录变化时错写下标。
      for (const target of targets) {
        if (!isCurrent(key, action, revision)) return;
        try {
          const updated = turningOff
            ? await powerCircuitsService.off(target.id)
            : await powerCircuitsService.on(target.id);
          if (!isCurrent(key, action, revision)) return;
          powerCircuits.value = powerCircuits.value.map((circuit) =>
            circuit.id === target.id ? updated : circuit);
        } catch (error) {
          if (!isCurrent(key, action, revision)) return;
          failed.push(`${target.name}: ${(error as Error).message}`);
        }
      }
      if (!isCurrent(key, action, revision)) return;
      if (failed.length) {
        ElMessage.error(`部分电源操作失败: ${failed.join('; ')}`);
      } else {
        ElMessage.success(turningOff
          ? `${options.title()}电源已断开`
          : `${options.title()}电源已接通`);
      }
    } finally {
      if (operationRevision === revision) powerBusy.value = false;
    }
  }

  onScopeDispose(() => {
    scopeDisposed = true;
    loadRevision += 1;
    operationRevision += 1;
    powerCircuits.value = [];
    powerBusy.value = false;
  });

  return {
    powerCircuits,
    powerAllOn,
    powerBusy,
    loadPowerCircuits,
    togglePower,
  };
}
