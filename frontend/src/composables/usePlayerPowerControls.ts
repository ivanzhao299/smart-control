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
 * 分阶段电源编排（开机严格时序，电源指令 best-effort）。
 *
 * 开机（严格电源先后顺序，核心探活不阻断显示电）：
 *   核心设备预热回路 preheatCodes 先上电，等待配置的中段延时后再启动功放/矩阵 ampStageCodes，最后送显示电。
 *   应用层探活只作为后台观测，不得因为探测慢或暂时失败阻断后续电源指令。
 * 关机逆向：先关屏 screenStageCodes → 再关功放/矩阵 ampStageCodes（共享矩阵 keep-peers）→ 最后关视频源 preheatCodes。
 *
 * 未配置 ampStageCodes/screenStageCodes 时回退为「显示回路整段 powerCode+ampCodes」（向后兼容）。
 *   - `preheatCodes`      ：阶段1 预热回路 code（视频源）：LED=seq55-6 / 投影=seq55-4。
 *   - `ampStageCodes`     ：错峰预热的功放/矩阵：LED=seq-2,seq-4 / 投影=seq55-8,seq-4。
 *   - `screenStageCodes`  ：阶段3 最终显示（最后开）：LED=1f-led / 投影=seq-5。
 *   - `readyKind`         ：就绪探活类型（轮询对应接口）。
 *   - `timeoutSec`        ：旧版最大等待秒数配置（已废弃，不再作为开机截止时间）。
 *                            开机必须以设备真实就绪为准，等待期间由 UI 显示已用时。
 *   - `initialDelaySec`   ：开始探活前的最小等待秒数；现场方案设为 0，由应用层探活结果决定。
 *   - `pollIntervalSec`   ：就绪轮询间隔（现场方案为 1s）。
 *   - `settleSec`         ：首次探活通过后的「稳定确认窗」秒数：窗口内每隔 confirmIntervalSec 再探一次，
 *                            必须全程在线才确认就绪（抗设备网络刚启动的单次假阳性，确保真正提供服务/找到地址）。
 *   - `confirmIntervalSec`：稳定确认窗内的复检间隔（现场方案为 1s）。
 *   - `ampStartDelaySec` ：核心设备上电后，功放/矩阵的错峰启动时间点；按现场实测启动周期取中段。
 *   - `ampStageGapSec`   ：功放/矩阵阶段内各回路之间的错峰间隔；按配置顺序逐路上电。
 *   - `stageGapMs`        ：功放/矩阵与显示电源之间的可选稳定间隔（现场方案为 0）。
 */
export interface PowerBootPlan {
  preheatCodes: string[];
  readyKind: 'led' | 'projector';
  /** @deprecated 开机不再按固定秒数超时；保留可选字段兼容旧配置。 */
  timeoutSec?: number;
  initialDelaySec?: number;
  pollIntervalSec?: number;
  settleSec?: number;
  ampStageCodes?: string[];
  screenStageCodes?: string[];
  confirmIntervalSec?: number;
  ampStartDelaySec?: number;
  ampStageGapSec?: number;
  stageGapMs?: number;
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
  /** 核心设备就绪后固定显示路径（LED 切正全屏图层 / 投影清空窗口+全屏 HDMI），返回是否确认成功；不传则不固定（向后兼容）。 */
  lockDisplay?(operationId?: string): Promise<boolean>;
  /** 屏体上电完成后投放启动画面；失败只作为软状态记录，不阻断电源开机。 */
  startupWelcome?(operationId?: string): Promise<boolean>;
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
  /** 错峰预热的功放/矩阵回路（核心设备启动中段上电，屏幕仍由核心就绪门控）。 */
  const ampStageCircuits = ref<PowerCircuitView[]>([]);
  /** 阶段3 最终显示回路（最后送电）。 */
  const screenStageCircuits = ref<PowerCircuitView[]>([]);
  const powerBusy = ref(false);
  /** 开机预热等待中（阶段1 已上电、等就绪）：UI 显示「开机中」+ 实际已用时。 */
  const booting = ref(false);
  /** 开机等待已用秒数；不设固定上限，以设备真实就绪时间为准。 */
  const bootElapsedSec = ref(0);
  // 「全部通电」= 预热/功放/显示各段回路（若有）全部通电。
  const powerAllOn = computed(() => {
    const all = [
      ...powerCircuits.value,
      ...preheatCircuits.value,
      ...ampStageCircuits.value,
      ...screenStageCircuits.value,
    ];
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
      ampStageCircuits.value = [];
      screenStageCircuits.value = [];
      return;
    }
    try {
      // 播放页必须读取完整设备链路，不能复用操作员电源页的 7 路范围。
      // 兼容旧测试桩/旧运行时时回退 list；正式 service 使用 playerList。
      const circuits = await (powerCircuitsService.playerList
        ? powerCircuitsService.playerList()
        : powerCircuitsService.list());
      if (scopeDisposed || revision !== loadRevision || !action() || key !== selectionKey.value) return;
      powerCircuits.value = resolvePlayerPowerCircuits(
        circuits,
        options.powerCode(),
        options.powerNameGroups(),
        options.powerAmpCodes(),
      );
      preheatCircuits.value = resolveCircuitsByCodes(circuits, plan?.preheatCodes ?? []);
      ampStageCircuits.value = resolveCircuitsByCodes(circuits, plan?.ampStageCodes ?? []);
      screenStageCircuits.value = resolveCircuitsByCodes(circuits, plan?.screenStageCodes ?? []);
    } catch {
      if (scopeDisposed || revision !== loadRevision || !action() || key !== selectionKey.value) return;
      // 电源子系统不可达时保持原界面约定：隐藏播放器页电源开关。
      powerCircuits.value = [];
      preheatCircuits.value = [];
      ampStageCircuits.value = [];
      screenStageCircuits.value = [];
    }
  }

  watch(selectionKey, () => {
    loadRevision += 1;
    operationRevision += 1;
    powerCircuits.value = [];
    preheatCircuits.value = [];
    ampStageCircuits.value = [];
    screenStageCircuits.value = [];
    powerBusy.value = false;
    booting.value = false;
    bootElapsedSec.value = 0;
    void loadPowerCircuits();
  }, { immediate: true, flush: 'sync' });

  /** 写回某个回路的最新状态（同时更新各阶段列表，按 id 匹配）。 */
  function writeBack(updated: PowerCircuitView): void {
    const patch = (list: PowerCircuitView[]): PowerCircuitView[] =>
      list.map((c) => (c.id === updated.id ? updated : c));
    powerCircuits.value = patch(powerCircuits.value);
    preheatCircuits.value = patch(preheatCircuits.value);
    ampStageCircuits.value = patch(ampStageCircuits.value);
    screenStageCircuits.value = patch(screenStageCircuits.value);
  }

  /** 操作上下文（贯穿整个开机/关机序列）。 */
  interface ApplyContext {
    key: string;
    action: () => boolean;
    revision: number;
    peerOn: Map<string, boolean>;
    peerQueryFailed: boolean;
    operationId: string;
  }

  /**
   * 逐路切换一组回路（保持串行、以 id 写回）。
   * 关机时（turningOn=false）对共享回路按 keep-peers 判定是否保留。
   */
  async function applyCircuits(
    targets: PowerCircuitView[],
    turningOn: boolean,
    ctx: ApplyContext,
    gapMsBetweenOn = 0,
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
          ? await (powerCircuitsService.playerOn
            ? powerCircuitsService.playerOn(target.id, ctx.operationId)
            : powerCircuitsService.on(target.id, ctx.operationId))
          : await (powerCircuitsService.playerOff
            ? powerCircuitsService.playerOff(target.id, ctx.operationId)
            : powerCircuitsService.off(target.id, ctx.operationId));
        if (!isCurrent(ctx.key, ctx.action, ctx.revision)) return { failed, kept, stopped: true };
        writeBack(updated);
        if (turningOn && gapMsBetweenOn > 0 && target !== targets.at(-1)) {
          await sleep(gapMsBetweenOn);
        }
      } catch (error) {
        if (!isCurrent(ctx.key, ctx.action, ctx.revision)) return { failed, kept, stopped: true };
        const detail = error as Error & { status?: number };
        const message = detail.message || '未知错误';
        failed.push(`${target.name}: ${detail.status === 0 ? `设备通信失败（${message}）` : message}`);
      }
    }
    return { failed, kept, stopped: false };
  }

  /**
   * 开机预热：应用层探活等就绪，期间显示「开机中」+ 正计时。
   * `skipInitialDelay`：预热回路已通电（手动先开）时跳过初始等待，直接探活。
   * 返回 true=就绪；false=当前操作已失效/页面已离开。
   */
  async function waitForReady(
    plan: PowerBootPlan,
    ctx: ApplyContext,
    skipInitialDelay = false,
    shouldContinue: () => boolean = () => true,
  ): Promise<boolean> {
    booting.value = true;
    const initialDelayMs = skipInitialDelay
      ? 0
      : Math.max(0, (plan.initialDelaySec ?? 0) * 1000);
    const pollMs = (plan.pollIntervalSec ?? 4) * 1000;
    const startedAt = Date.now();
    bootElapsedSec.value = 0;

    const elapsedTimer = setInterval(() => {
      bootElapsedSec.value = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    elapsedTimer.unref?.();

    try {
      if (!shouldContinue()) return false;
      if (initialDelayMs > 0) {
        await sleep(initialDelayMs);
        if (!shouldContinue() || !isCurrent(ctx.key, ctx.action, ctx.revision)) return false;
      }
      const probe = plan.readyKind === 'led'
        ? deviceReadyService.led
        : deviceReadyService.projector;
      for (;;) {
        if (!shouldContinue() || !isCurrent(ctx.key, ctx.action, ctx.revision)) return false;
        let ready = false;
        try {
          ready = await probe(ctx.operationId);
        } catch {
          ready = false;
        }
        if (ready) {
          // 稳定确认窗（settleSec）：窗口内每隔 confirmIntervalSec 再探一次，必须全程在线
          // 才算真正就绪——抗设备网络刚启动时的单次假阳性，确保「已正常提供服务/找到地址」。
          const settleSec = plan.settleSec ?? 0;
          if (settleSec <= 0) return true;
          const confirmMs = (plan.confirmIntervalSec ?? 2) * 1000;
          const settleDeadline = Date.now() + settleSec * 1000;
          let stable = true;
          while (Date.now() < settleDeadline) {
            if (!shouldContinue() || !isCurrent(ctx.key, ctx.action, ctx.revision)) return false;
            bootElapsedSec.value = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
            const left = settleDeadline - Date.now();
            await sleep(Math.min(confirmMs, left));
            if (Date.now() >= settleDeadline) break;
            let recheck = false;
            try { recheck = await probe(ctx.operationId); } catch { recheck = false; }
            if (!shouldContinue() || !isCurrent(ctx.key, ctx.action, ctx.revision)) return false;
            if (!recheck) { stable = false; break; }
          }
          if (stable) {
            bootElapsedSec.value = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
            return true;
          }
          // 窗口内掉线（设备抖动）→ 回到轮询继续等就绪
        }
        if (!shouldContinue() || !isCurrent(ctx.key, ctx.action, ctx.revision)) return false;
        await sleep(pollMs);
      }
      return false;
    } finally {
      clearInterval(elapsedTimer);
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
    const operationId = `player-boot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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
    const ctx: ApplyContext = { key, action, revision, peerOn, peerQueryFailed, operationId };
    // 严格分段：boot-plan 配置了功放段/屏段时，开机按「核心设备→中段错峰启动功放/矩阵→核心就绪门控→显示路径→显示屏」，
    // 关机逆向「显示屏→功放/矩阵→视频源」；核心设备探活只用于观测，不阻断送屏电。
    const staged = !!plan
      && (ampStageCircuits.value.length > 0 || screenStageCircuits.value.length > 0);
    const stageGapMs = plan?.stageGapMs ?? 1000;
    const reportShutdown = (failed: string[], kept: { name: string; by: string }[]): void => {
      if (failed.length || kept.length) {
        // 共享回路保护和逐路失败细节只留在内部诊断日志，界面不展开过程提示。
        console.warn('[player-power] shutdown diagnostics', {
          title: options.title(),
          failed,
          kept,
        });
      }
      ElMessage.success(`${options.title()}关机完成`);
    };
    // 阶段开机的后台探活必须在本次动作结束或失效时停止，不能留下轮询。
    let stopReadyObservation = (): void => {};
    try {
      if (turningOff) {
        if (staged) {
          // 关机逆向：先关显示屏 → 再关功放/矩阵（共享矩阵 keep-peers）→ 最后关视频源
          const rScreen = await applyCircuits(screenStageCircuits.value, false, ctx);
          if (rScreen.stopped) return;
          // 关机按开机顺序反向：先断功放，再断矩阵，降低音频链路中断冲击。
          const rAmp = await applyCircuits([...ampStageCircuits.value].reverse(), false, ctx);
          if (rAmp.stopped) return;
          const rPre = await applyCircuits(preheatTargets, false, ctx);
          if (rPre.stopped) return;
          reportShutdown(
            [...rScreen.failed, ...rAmp.failed, ...rPre.failed],
            [...rScreen.kept, ...rAmp.kept, ...rPre.kept],
          );
        } else {
          // 兼容旧路径：显示回路整段 → 预热回路
          const r1 = await applyCircuits(displayTargets, false, ctx);
          if (r1.stopped) return;
          const r2 = await applyCircuits(preheatTargets, false, ctx);
          if (r2.stopped) return;
          reportShutdown([...r1.failed, ...r2.failed], [...r1.kept, ...r2.kept]);
        }
      } else if (staged && plan) {
        // ===== 开机（严格顺序，探活不阻断电源指令）=====
        // 阶段1：第一时间开核心设备（LED 诺瓦 V2460=seq55-6 / 投影融合器=seq55-4）。
        const alreadyOn = preheatTargets.every((t) => t.reading.on);
        // 探活只作后台观测。即使设备应用层尚未响应，也必须继续发出矩阵、功放、屏体的上电指令。
        let observeReady = true;
        stopReadyObservation = () => { observeReady = false; };
        void waitForReady(plan, ctx, alreadyOn, () => observeReady).catch((error) => {
          console.warn('[player-power] readiness observation failed', {
            title: options.title(),
            error,
          });
        });
        // 功放/矩阵在核心设备启动的中段错峰上电；同一串口由适配器内部锁串行化。
        const preheatPromise = applyCircuits(preheatTargets, true, ctx);
        const ampStartAt = Date.now() + (alreadyOn
          ? 0
          : Math.max(0, (plan.ampStartDelaySec ?? 0) * 1000));
        const ampPromise = (async () => {
          const preheat = await preheatPromise;
          if (preheat.stopped) return { failed: [], kept: [], stopped: true };
          const waitMs = ampStartAt - Date.now();
          if (waitMs > 0) await sleep(waitMs);
          if (!isCurrent(key, action, revision)) return { failed: [], kept: [], stopped: true };
          return applyCircuits(
            ampStageCircuits.value,
            true,
            ctx,
            Math.max(0, (plan.ampStageGapSec ?? 0) * 1000),
          );
        })();
        const p0 = await preheatPromise;
        if (p0.stopped) { observeReady = false; await ampPromise; return; }
        // 阶段2：功放/矩阵在核心启动中段错峰预热；不等待探活结果，直接继续阶段3。
        const rAmp = await ampPromise;
        if (!isCurrent(key, action, revision)) return;
        if (rAmp.stopped) { observeReady = false; return; }
        // 阶段3：锁定显示路径并送显示电。路径确认失败只记录，不得阻断屏体电源。
        if (stageGapMs > 0) await sleep(stageGapMs);
        if (!isCurrent(key, action, revision)) return;
        let displayLocked = true;
        if (options.lockDisplay) {
          try {
            displayLocked = await options.lockDisplay(operationId);
          } catch (error) {
            displayLocked = false;
            console.warn('[player-power] display path lock failed; continue powering screen', {
              title: options.title(),
              error,
            });
          }
          if (!isCurrent(key, action, revision)) return;
        }
        const rScreen = await applyCircuits(screenStageCircuits.value, true, ctx);
        if (rScreen.stopped) return;
        observeReady = false;
        booting.value = false;
        bootElapsedSec.value = 0;
        const failed = [...p0.failed, ...rAmp.failed, ...rScreen.failed];
        let startupWelcomePublished = true;
        if (options.startupWelcome && isCurrent(key, action, revision)) {
          try {
            startupWelcomePublished = await options.startupWelcome(operationId);
          } catch (error) {
            startupWelcomePublished = false;
            console.warn('[player-power] startup welcome publish failed; continue power-on', {
              title: options.title(),
              error,
            });
          }
          if (!isCurrent(key, action, revision)) return;
        }
        if (failed.length) {
          ElMessage.error(`部分电源操作失败: ${failed.join('; ')}`);
        } else if (!displayLocked) {
          // 屏体电源已发出；显示路径确认属于独立的软状态，不把它误报成未开机。
          ElMessage.success(`${options.title()}开机指令已发送`);
        } else if (!startupWelcomePublished) {
          ElMessage.success(`${options.title()}已开机（默认欢迎页待重试）`);
        } else {
          ElMessage.success(`${options.title()}已开机（默认欢迎页已投放）`);
        }
      } else {
        // 兼容旧路径（无分段计划）：预热→持续等就绪→显示回路整段。
        let preheatFailed: string[] = [];
        if (plan && preheatTargets.length) {
          const alreadyOn = preheatTargets.every((t) => t.reading.on);
          const p0 = await applyCircuits(preheatTargets, true, ctx);
          if (p0.stopped) return;
          preheatFailed = p0.failed;
          const ready = await waitForReady(plan, ctx, alreadyOn);
          if (!isCurrent(key, action, revision)) return;
          booting.value = false;
          bootElapsedSec.value = 0;
          if (!ready) return;
        }
        const r1 = await applyCircuits(displayTargets, true, ctx);
        if (r1.stopped) return;
        const failed = [...preheatFailed, ...r1.failed];
        // 显示回路打开后固定显示，保证画面正确、不跳动
        let displayLocked = true;
        if (!failed.length && options.lockDisplay) {
          displayLocked = await options.lockDisplay();
          if (!isCurrent(key, action, revision)) return;
        }
        let startupWelcomePublished = true;
        if (!failed.length && options.startupWelcome && isCurrent(key, action, revision)) {
          try {
            startupWelcomePublished = await options.startupWelcome();
          } catch (error) {
            startupWelcomePublished = false;
            console.warn('[player-power] startup welcome publish failed; continue power-on', {
              title: options.title(),
              error,
            });
          }
          if (!isCurrent(key, action, revision)) return;
        }
        if (failed.length) {
          ElMessage.error(`部分电源操作失败: ${failed.join('; ')}`);
        } else if (!displayLocked) {
          ElMessage.warning(`${options.title()}已接通，但显示画面未确认，若画面异常请手动切换输入源`);
        } else if (!startupWelcomePublished) {
          ElMessage.success(`${options.title()}电源已接通（默认欢迎页待重试）`);
        } else {
          ElMessage.success(`${options.title()}电源已接通（默认欢迎页已投放）`);
        }
      }
    } finally {
      stopReadyObservation();
      booting.value = false;
      bootElapsedSec.value = 0;
      if (operationRevision === revision) powerBusy.value = false;
    }
  }

  onScopeDispose(() => {
    scopeDisposed = true;
    loadRevision += 1;
    operationRevision += 1;
    powerCircuits.value = [];
    preheatCircuits.value = [];
    ampStageCircuits.value = [];
    screenStageCircuits.value = [];
    powerBusy.value = false;
    booting.value = false;
    bootElapsedSec.value = 0;
  });

  return {
    powerCircuits,
    preheatCircuits,
    powerAllOn,
    powerBusy,
    booting,
    bootElapsedSec,
    loadPowerCircuits,
    togglePower,
  };
}
