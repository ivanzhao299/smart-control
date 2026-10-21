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
import { deviceReadyService } from '@/services/device-ready.service';

/** 简单延时（可被操作切换通过 isCurrent 检查中断）。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/**
 * 分阶段电源编排（开机预热时序，方案 A）。
 *
 * 开机：先开预热回路（启动慢的视频源设备）→ 应用层探活等就绪 → 再开显示回路（powerCode + ampCodes），
 * 保证大屏一亮画面即有；关机逆向（先关显示回路、再关预热回路）。
 *   - `preheatCodes`   ：阶段1 预热回路 code（视频源设备）：LED=seq55-6 / 投影=seq55-4。
 *   - `readyKind`      ：就绪探活类型（轮询对应接口）。
 *   - `timeoutSec`     ：最大等待秒数（超时兜底）：LED=60 / 投影=120。
 *   - `initialDelaySec`：开始探活前的最小等待秒数（避免设备刚上电空探）：LED=10 / 投影=15。
 *   - `pollIntervalSec`：就绪轮询间隔（默认 4s）。
 *   - `settleSec`     ：探活通过后、开显示回路前的额外稳定等待秒数（让视频引擎/输入锁定完全就绪），默认 0。
 */
export interface PowerBootPlan {
  preheatCodes: string[];
  readyKind: 'led' | 'projector';
  timeoutSec: number;
  initialDelaySec?: number;
  pollIntervalSec?: number;
  settleSec?: number;
}

interface PlayerPowerControlsOptions {
  title(): string;
  powerCode(): string | undefined;
  powerNameGroups(): string[][] | undefined;
  /** 功放回路的精确 code 列表（第三十轮加固）：功放移位后按 code 锁定，不依赖名称。 */
  powerAmpCodes(): string[] | undefined;
  /** 共享回路（如音频矩阵）的「最后离开才关」规则；不传则关机时全部断电（向后兼容）。 */
  powerKeepPeers(): PowerKeepRule[] | undefined;
  /** 分阶段预热编排（开机先拉视频源、等就绪）；不传则开机/关机同开同关（向后兼容）。 */
  powerBootPlan(): PowerBootPlan | undefined;
  /** 显示回路打开后固定显示（LED 切正全屏图层 / 投影清空窗口+全屏 HDMI），返回是否确认成功；不传则不固定（向后兼容）。 */
  lockDisplay?(): Promise<boolean>;
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
/** Resolve circuits by exact code list (in given order, no duplicates). */
export function resolveCircuitsByCodes(
  circuits: PowerCircuitView[],
  codes: string[],
): PowerCircuitView[] {
  const clean = codes.map((code) => code.trim()).filter(Boolean);
  return clean
    .map((code) => circuits.find((circuit) => circuit.code === code))
    .filter((circuit): circuit is PowerCircuitView => !!circuit);
}

export function usePlayerPowerControls(options: PlayerPowerControlsOptions) {
  const powerCircuits = ref<PowerCircuitView[]>([]);
  const preheatCircuits = ref<PowerCircuitView[]>([]);
  const powerBusy = ref(false);
  /** 开机预热等待中（阶段1 已上电、等就绪）：UI 显示「开机中」+ 倒计时。 */
  const booting = ref(false);
  /** 开机倒计时（距最大等待的剩余秒数）。 */
  const bootCountdown = ref(0);
  // 「全部通电」= 显示回路与预热回路（若有）全部通电。
  const powerAllOn = computed(() => {
    const all = [...powerCircuits.value, ...preheatCircuits.value];
    return all.length > 0 && all.every((circuit) => circuit.reading.on);
  });
  const selectionKey = computed(() => JSON.stringify({
    codes: options.powerCode() ?? '',
    groups: options.powerNameGroups() ?? [],
    ampCodes: options.powerAmpCodes() ?? [],
    keepPeers: options.powerKeepPeers() ?? [],
    bootPlan: options.powerBootPlan() ?? null,
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
    const plan = options.powerBootPlan();
    if (!options.powerCode()
        && !options.powerNameGroups()?.length
        && !options.powerAmpCodes()?.length
        && !plan?.preheatCodes?.length) {
      powerCircuits.value = [];
      preheatCircuits.value = [];
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
      preheatCircuits.value = resolveCircuitsByCodes(circuits, plan?.preheatCodes ?? []);
    } catch {
      if (scopeDisposed || revision !== loadRevision || !action() || key !== selectionKey.value) return;
      // 电源子系统不可达时保持原界面约定：隐藏播放器页电源开关。
      powerCircuits.value = [];
      preheatCircuits.value = [];
    }
  }

  watch(selectionKey, () => {
    loadRevision += 1;
    operationRevision += 1;
    powerCircuits.value = [];
    preheatCircuits.value = [];
    powerBusy.value = false;
    booting.value = false;
    bootCountdown.value = 0;
    void loadPowerCircuits();
  }, { immediate: true, flush: 'sync' });

  /** 写回某个回路的最新状态（同时更新显示与预热两个列表，按 id 匹配）。 */
  function writeBack(updated: PowerCircuitView): void {
    powerCircuits.value = powerCircuits.value
      .map((c) => (c.id === updated.id ? updated : c));
    preheatCircuits.value = preheatCircuits.value
      .map((c) => (c.id === updated.id ? updated : c));
  }

  /** 操作上下文（贯穿整个开机/关机序列）。 */
  interface ApplyContext {
    key: string;
    action: () => boolean;
    revision: number;
    peerOn: Map<string, boolean>;
    peerQueryFailed: boolean;
  }

  /**
   * 逐路切换一组回路（保持串行、以 id 写回）。
   * 关机时（turningOn=false）对共享回路按 keep-peers 判定是否保留。
   */  async function applyCircuits(
    targets: PowerCircuitView[],
    turningOn: boolean,
    ctx: ApplyContext,
  ): Promise<{ failed: string[]; kept: { name: string; by: string }[]; stopped: boolean }> {
    const failed: string[] = [];
    const kept: { name: string; by: string }[] = [];
    for (const target of targets) {
      if (!isCurrent(ctx.key, ctx.action, ctx.revision)) return { failed, kept, stopped: true };
      if (!turningOn) {
        const keepRule = (options.powerKeepPeers() ?? [])
          .find((rule) => rule.code === target.code);
        if (keepRule) {
          const active = keepRule.peers
            .some((peerCode) => ctx.peerOn.get(peerCode) === true);
          if (ctx.peerQueryFailed || active) {
            kept.push({ name: target.name, by: keepRule.peerLabel ?? '另一台设备' });
            continue; // 共享回路仍被使用（或状态无法确认），跳过断电
          }
        }
      }
      try {
        const updated = turningOn
          ? await powerCircuitsService.on(target.id)
          : await powerCircuitsService.off(target.id);
        if (!isCurrent(ctx.key, ctx.action, ctx.revision)) return { failed, kept, stopped: true };
        writeBack(updated);
      } catch (error) {
        if (!isCurrent(ctx.key, ctx.action, ctx.revision)) return { failed, kept, stopped: true };
        failed.push(`${target.name}: ${(error as Error).message}`);
      }
    }
    return { failed, kept, stopped: false };
  }

  /**
   * 开机预热：应用层探活等就绪，期间显示「开机中」+ 倒计时。
   * `skipInitialDelay`：预热回路已通电（手动先开）时跳过初始等待，直接探活。
   * 返回 true=就绪；false=超时（调用方按兜底继续）。
   */
  async function waitForReady(
    plan: PowerBootPlan,
    ctx: ApplyContext,
    skipInitialDelay = false,
  ): Promise<boolean> {
    booting.value = true;
    const timeoutMs = plan.timeoutSec * 1000;
    const initialDelayMs = skipInitialDelay
      ? 0
      : Math.min((plan.initialDelaySec ?? 0) * 1000, timeoutMs);
    const pollMs = (plan.pollIntervalSec ?? 4) * 1000;
    const deadline = Date.now() + timeoutMs;
    bootCountdown.value = plan.timeoutSec;

    const countdownTimer = setInterval(() => {
      bootCountdown.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    }, 1000);
    countdownTimer.unref?.();

    try {
      if (initialDelayMs > 0) {
        await sleep(initialDelayMs);
        if (!isCurrent(ctx.key, ctx.action, ctx.revision)) return false;
      }
      const probe = plan.readyKind === 'led'
        ? deviceReadyService.led
        : deviceReadyService.projector;
      while (Date.now() < deadline) {
        if (!isCurrent(ctx.key, ctx.action, ctx.revision)) return false;
        let ready = false;
        try {
          ready = await probe();
        } catch {
          ready = false;
        }
        if (ready) {
          // 探活通过后再稳定等待 settleSec（让视频引擎/输入锁定完全就绪），倒计时继续
          const settleSec = plan.settleSec ?? 0;
          if (settleSec > 0) {
            clearInterval(countdownTimer);
            const settleDeadline = Date.now() + settleSec * 1000;
            while (Date.now() < settleDeadline) {
              if (!isCurrent(ctx.key, ctx.action, ctx.revision)) return false;
              bootCountdown.value = Math.max(0, Math.ceil((settleDeadline - Date.now()) / 1000));
              const left = settleDeadline - Date.now();
              if (left <= 0) break;
              await sleep(Math.min(500, left));
            }
            bootCountdown.value = 0;
          }
          return true;
        }
        if (!isCurrent(ctx.key, ctx.action, ctx.revision)) return false;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(pollMs, remaining));
      }
      return false;
    } finally {
      clearInterval(countdownTimer);
    }
  }

  async function togglePower(): Promise<void> {
    const displayTargets = [...powerCircuits.value];
    const preheatTargets = [...preheatCircuits.value];
    if ((!displayTargets.length && !preheatTargets.length) || powerBusy.value) return;
    const turningOff = powerAllOn.value;
    const key = selectionKey.value;
    const action = options.captureAction();
    const revision = ++operationRevision;
    const plan = options.powerBootPlan();

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
    // （每个仅回传一个布尔，后端读内存快照、不碰硬件），不读全量列表。
    // 任一 peer 通电即保留；查询失败（peerQueryFailed）按「保留」兜底，避免误关。
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
    const ctx: ApplyContext = { key, action, revision, peerOn, peerQueryFailed };
    try {
      if (turningOff) {
        // 关机（逆向）：先关显示回路（大屏/投影/矩阵/功放，矩阵 keep-peers），再关预热回路。
        const r1 = await applyCircuits(displayTargets, false, ctx);
        if (r1.stopped) return;
        const r2 = await applyCircuits(preheatTargets, false, ctx);
        if (r2.stopped) return;
        const failed = [...r1.failed, ...r2.failed];
        const kept = [...r1.kept, ...r2.kept];
        if (failed.length) {
          ElMessage.error(`部分电源操作失败: ${failed.join('; ')}`);
        } else if (kept.length) {
          const keepDesc = kept.map((item) => `${item.name}仍由「${item.by}」使用`).join('；');
          ElMessage.success(`${options.title()}已关闭；${keepDesc}，保持通电`);
        } else {
          ElMessage.success(`${options.title()}电源已断开`);
        }
      } else {
        // 开机：先开预热回路（视频源）→ 应用层探活等就绪（倒计时）→ 再开显示回路。
        let timedOut = false;
        let preheatFailed: string[] = [];
        if (plan && preheatTargets.length) {
          const alreadyOn = preheatTargets.every((t) => t.reading.on);
          const p0 = await applyCircuits(preheatTargets, true, ctx);
          if (p0.stopped) return;
          preheatFailed = p0.failed;
          const ready = await waitForReady(plan, ctx, alreadyOn);
          if (!isCurrent(key, action, revision)) return;
          booting.value = false;
          bootCountdown.value = 0;
          if (!ready) timedOut = true;
        }
        const r1 = await applyCircuits(displayTargets, true, ctx);
        if (r1.stopped) return;
        const failed = [...preheatFailed, ...r1.failed];
        // 显示回路打开后固定显示（LED 切正全屏图层 / 投影清空窗口+全屏 HDMI），保证画面正确、不跳动
        let displayLocked = true;
        if (!failed.length && options.lockDisplay) {
          displayLocked = await options.lockDisplay();
          if (!isCurrent(key, action, revision)) return;
        }
        if (failed.length) {
          ElMessage.error(`部分电源操作失败: ${failed.join('; ')}`);
        } else if (timedOut) {
          ElMessage.warning(`${options.title()}已接通；视频设备未在 ${plan?.timeoutSec}s 内确认就绪，若画面异常请检查视频设备`);
        } else if (!displayLocked) {
          ElMessage.warning(`${options.title()}已接通，但显示画面未确认，若画面异常请手动切换输入源`);
        } else {
          ElMessage.success(`${options.title()}电源已接通`);
        }
      }
    } finally {
      booting.value = false;
      bootCountdown.value = 0;
      if (operationRevision === revision) powerBusy.value = false;
    }
  }

  onScopeDispose(() => {
    scopeDisposed = true;
    loadRevision += 1;
    operationRevision += 1;
    powerCircuits.value = [];
    preheatCircuits.value = [];
    powerBusy.value = false;
    booting.value = false;
    bootCountdown.value = 0;
  });

  return {
    powerCircuits,
    preheatCircuits,
    powerAllOn,
    powerBusy,
    booting,
    bootCountdown,
    loadPowerCircuits,
    togglePower,
  };
}
