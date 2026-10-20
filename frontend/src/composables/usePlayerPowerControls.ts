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

/**
 * 共享回路的「最后离开才关」规则（第三十轮）。
 *
 * 音频矩阵（seq-4）被 LED 与投影仪共用：任一台开机都要把它拉起；但只关其中一台时，
 * 若另一台仍在用，矩阵必须保持通电。每条规则：
 *   - `code`  ：共享回路 code（如音频矩阵 `seq-4`）。
 *   - `peers` ：**其他使用方**的主设备回路 code（本页以外）。关机时只要任一 peer 仍通电，
 *               就跳过该共享回路的断电，把它留给仍在使用的设备。
 */
export interface PowerKeepRule {
  code: string;
  peers: string[];
  /** 其他使用方的显示名（用于「保持通电」提示，如「投影仪」）；不传则显示「另一台设备」。 */
  peerLabel?: string;
}

interface PlayerPowerControlsOptions {
  title(): string;
  powerCode(): string | undefined;
  powerNameGroups(): string[][] | undefined;
  /** 功放回路的精确 code 列表（第三十轮加固）：功放移位后按 code 锁定，不依赖名称。 */
  powerAmpCodes(): string[] | undefined;
  /** 共享回路（如音频矩阵）的「最后离开才关」规则；不传则关机时全部断电（向后兼容）。 */
  powerKeepPeers(): PowerKeepRule[] | undefined;
  captureAction(): () => boolean;
}

/** Resolve the configured group in stable code-first order, without duplicate circuits. */
export function resolvePlayerPowerCircuits(
  circuits: PowerCircuitView[],
  powerCode: string | undefined,
  powerNameGroups: string[][] | undefined,
  powerAmpCodes?: string[] | undefined,
): PowerCircuitView[] {
  const codes = (powerCode ?? '').split(',').map((code) => code.trim()).filter(Boolean);
  const ampCodes = (powerAmpCodes ?? []).map((code) => code.trim()).filter(Boolean);
  const byCode = [...codes, ...ampCodes]
    .map((code) => circuits.find((circuit) => circuit.code === code))
    .filter((circuit): circuit is PowerCircuitView => !!circuit);
  // 明确指定功放 code 后不再做名称匹配，避免重名/改名时误控旧回路；
  // 未指定时保留「按名定位」兼容（业主改名即生效）。
  const byName = ampCodes.length
    ? []
    : powerNameGroups?.length
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
    ampCodes: options.powerAmpCodes() ?? [],
    keepPeers: options.powerKeepPeers() ?? [],
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
    if (!options.powerCode()
        && !options.powerNameGroups()?.length
        && !options.powerAmpCodes()?.length) {
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
        options.powerAmpCodes(),
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

    // 共享回路「最后离开才关」：关机确认后只查「其他使用方主开关」这几个固定回路的开关位
    // （每个仅回传一个布尔，后端读内存快照、不碰硬件、不做整回路组装），不读全量列表。
    // 任一 peer 仍通电即保留；查询失败（peerQueryFailed）状态无法确认时按「保留」兜底，避免误关。
    const peerOn = new Map<string, boolean>();
    let peerQueryFailed = false;
    if (turningOff && options.powerKeepPeers()?.length) {
      const peerCodes = [...new Set(
        options.powerKeepPeers()!.flatMap((rule) => rule.peers),
      )];
      for (const peerCode of peerCodes) {
        try {
          peerOn.set(peerCode, await powerCircuitsService.switchOnByCode(peerCode));
        } catch {
          peerQueryFailed = true;
        }
      }
      if (!isCurrent(key, action, revision)) return;
    }

    powerBusy.value = true;
    const failed: string[] = [];
    const kept: { name: string; by: string }[] = [];
    try {
      // 多路设备共用串口链路，保持逐路下发；以设备 ID 写回，避免目录变化时错写下标。
      for (const target of targets) {
        if (!isCurrent(key, action, revision)) return;
        if (turningOff) {
          const keepRule = (options.powerKeepPeers() ?? [])
            .find((rule) => rule.code === target.code);
          if (keepRule) {
            const active = keepRule.peers.some((peerCode) => peerOn.get(peerCode) === true);
            if (peerQueryFailed || active) {
              kept.push({ name: target.name, by: keepRule.peerLabel ?? '另一台设备' });
              continue; // 共享回路仍被其他设备使用（或状态无法确认），跳过断电
            }
          }
        }
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
      } else if (kept.length) {
        const keepDesc = kept.map((item) => `${item.name}仍由「${item.by}」使用`).join('；');
        ElMessage.success(`${options.title()}已关闭；${keepDesc}，保持通电`);
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
