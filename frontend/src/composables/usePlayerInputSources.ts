import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { projectorService } from '@/services/projector.service';
import { ledService } from '@/services/led.service';
import {
  publishParkDashboard,
  publishWelcome,
  type PlaylistItemView,
} from '@/services/playback.service';
import {
  fetchWelcomeSchemes,
  publishWelcomeScheme,
  type WelcomeScheme,
} from '@/services/system-branding.service';
import {
  getParkOpsOwnerId,
  parkOpsControlService,
  type ParkOpsControlState,
} from '@/services/park-ops-control.service';
import { useCurrentActor } from '@/services/current-actor';
import {
  WELCOME_PICK_DEFAULT,
  playerInputSourceHint,
  welcomePickerValue as resolveWelcomePickerValue,
  type PlayerInputSource,
} from '@/features/player-input-source';

interface PlayerInputSourceOptions {
  slot: ComputedRef<1 | 2>;
  title: () => string;
  deviceId: () => string | undefined;
  activeSource: ComputedRef<PlayerInputSource | null>;
  playlist: Ref<PlaylistItemView[]>;
  busy: Ref<boolean>;
  welcomeSchemes: Ref<WelcomeScheme[]>;
  welcomeSchemesRevision: Ref<number>;
  publishedWelcomeSchemeId: Ref<string | null>;
  ensureAdmin: (action: string) => Promise<boolean>;
  /** 投放欢迎方案允许的角色检查，缺省回退 ensureAdmin。 */
  ensureContentEditor?: (action: string) => Promise<boolean>;
  captureAction: () => () => boolean;
  nextPlayback: (slot: 1 | 2) => Promise<unknown>;
  reloadLists: () => Promise<void>;
}

type ParkOpsAction = 'next' | 'prev' | 'auto' | 'refresh';

export function usePlayerInputSources(options: PlayerInputSourceOptions) {
  const ensureContentEditor = options.ensureContentEditor ?? options.ensureAdmin;
  const activeSource = options.activeSource;
  const srcHint = computed(() => playerInputSourceHint(activeSource.value));
  const welcomePickerBusy = ref(false);
  const welcomePickerValue = computed(() => resolveWelcomePickerValue(
    activeSource.value,
    options.publishedWelcomeSchemeId.value,
  ));

  const { actor } = useCurrentActor();
  const parkOpsPage = ref(0);
  const parkOpsTotalPages = ref(6);
  const parkOpsAuto = ref(false);
  const parkOpsBusy = ref(false);
  const parkOpsClaimed = ref(false);
  const parkOpsClaimByMe = ref(false);
  const parkOpsClaimName = ref<string | null>(null);
  const parkOpsClaimRemaining = ref(0);
  let refreshCooldown: ReturnType<typeof setTimeout> | undefined;
  let remainBase = 0;
  let remainBaseAt = 0;
  let disposed = false;

  onScopeDispose(() => {
    disposed = true;
    if (refreshCooldown !== undefined) clearTimeout(refreshCooldown);
  });

  function setRemaining(ms: number): void {
    remainBase = ms;
    remainBaseAt = Date.now();
    parkOpsClaimRemaining.value = ms;
  }

  function applyParkOpsState(state: ParkOpsControlState): void {
    parkOpsPage.value = state.page;
    parkOpsAuto.value = state.autoPlay;
    parkOpsTotalPages.value = state.totalPages;
    parkOpsClaimed.value = state.claimed;
    parkOpsClaimByMe.value = !!state.claim && state.claim.ownerId === getParkOpsOwnerId();
    parkOpsClaimName.value = state.claim?.ownerName ?? null;
    setRemaining(state.claim?.remainingMs ?? 0);
  }

  // 倒计时本地每秒平滑递减；权威状态（页码 / 接管归属 / 剩余）每 10s 校准，
  // 并感知被抢占或 TTL 自动还权。仅在运营大屏输入源激活时工作。
  const uiTick = window.setInterval(() => {
    if (activeSource.value !== 'park-dashboard') return;
    if (parkOpsClaimByMe.value) {
      parkOpsClaimRemaining.value = Math.max(0, remainBase - (Date.now() - remainBaseAt));
    }
  }, 1000);
  const pollTick = window.setInterval(() => {
    if (activeSource.value === 'park-dashboard') void syncParkOpsState();
  }, 10_000);
  onScopeDispose(() => {
    window.clearInterval(uiTick);
    window.clearInterval(pollTick);
  });

  /** Best effort: content publishing remains available when the display controller cannot confirm. */
  async function ensureDisplayPath(): Promise<void> {
    try {
      if (options.slot.value === 1 && options.deviceId()) {
        const result = await ledService.switchInput(options.deviceId()!, 'video');
        if (!result.ok) throw new Error(result.error || '设备未确认');
      } else if (options.slot.value === 2) {
        await projectorService.showHdmi();
      }
    } catch (error) {
      if (!disposed) ElMessage.warning(`显示链路切换未确认: ${(error as Error).message}`);
    }
  }

  async function selectContent(): Promise<void> {
    const isCurrent = options.captureAction();
    if (!isCurrent()) return;
    options.busy.value = true;
    try {
      await ensureDisplayPath();
      if (!isCurrent()) return;
      if (activeSource.value !== 'content') {
        if (!options.playlist.value.length) {
          ElMessage.info('播放列表是空的 — 先从媒体库加入素材');
          return;
        }
        await options.nextPlayback(options.slot.value);
      }
      if (isCurrent()) ElMessage.success('已切到播放内容');
    } catch (error) {
      if (isCurrent()) ElMessage.error(`切换失败: ${(error as Error).message}`);
    } finally {
      options.busy.value = false;
    }
  }

  async function refreshWelcomeSchemeOptions(notify = false): Promise<void> {
    try {
      const snapshot = await fetchWelcomeSchemes();
      if (disposed) return;
      options.welcomeSchemes.value = snapshot.config.schemes.map((item) => ({ ...item }));
      options.welcomeSchemesRevision.value = snapshot.revision;
      options.publishedWelcomeSchemeId.value = snapshot.publishedSchemeId;
    } catch (error) {
      if (notify && !disposed) ElMessage.error(`读取欢迎方案失败: ${(error as Error).message}`);
    }
  }

  async function selectWelcome(variant: 'editable' | 'default'): Promise<void> {
    const isCurrent = options.captureAction();
    if (!isCurrent()) return;
    options.busy.value = true;
    try {
      await ensureDisplayPath();
      if (!isCurrent()) return;
      await publishWelcome(options.slot.value, variant);
      if (!isCurrent()) return;
      ElMessage.success(variant === 'editable'
        ? '已投放动态欢迎页 (点「编辑欢迎页」可改内容)'
        : '已投放默认欢迎页');
    } catch (error) {
      if (isCurrent()) ElMessage.error(`投放欢迎页失败: ${(error as Error).message}`);
    } finally {
      options.busy.value = false;
    }
  }

  async function onWelcomeSchemePick(event: Event): Promise<void> {
    const selectEl = event.target as HTMLSelectElement;
    const value = selectEl.value;
    const rollback = (): void => { selectEl.value = welcomePickerValue.value; };
    if (welcomePickerBusy.value || options.busy.value) return;
    const isCurrent = options.captureAction();
    welcomePickerBusy.value = true;
    try {
      if (value === WELCOME_PICK_DEFAULT) {
        await selectWelcome('default');
      } else {
        if (!(await ensureContentEditor('投放欢迎方案'))) { rollback(); return; }
        if (!isCurrent()) return;
        const scheme = options.welcomeSchemes.value.find((item) => item.id === value);
        if (!scheme) throw new Error('该欢迎方案不存在，请重新选择');
        await publishWelcomeScheme(value, options.welcomeSchemesRevision.value);
        if (!isCurrent()) return;
        await refreshWelcomeSchemeOptions();
        if (!isCurrent()) return;
        await selectWelcome('editable');
      }
      if (isCurrent()) void options.reloadLists();
    } catch (error) {
      if (!isCurrent()) return;
      const message = (error as Error).message || String(error);
      await refreshWelcomeSchemeOptions();
      rollback();
      ElMessage.error(/冲突|conflict|revision/i.test(message)
        ? '欢迎方案刚被其它终端修改，已刷新，请重新选择'
        : `投放欢迎页失败: ${message}`);
    } finally {
      welcomePickerBusy.value = false;
    }
  }

  async function syncParkOpsState(): Promise<void> {
    const isCurrent = options.captureAction();
    try {
      const state = await parkOpsControlService.state();
      if (isCurrent() && !disposed) applyParkOpsState(state);
    } catch { /* informational state: controls remain usable */ }
  }

  /** 操作前确保由本客户端接管；若正被他人接管，本调用会抢占（用户显式要控制）。 */
  async function ensureClaimed(): Promise<boolean> {
    if (parkOpsClaimByMe.value) return true;
    const state = await parkOpsControlService.claim(actor.value?.username);
    if (disposed) return false;
    applyParkOpsState(state);
    return !!state.claim && state.claim.ownerId === getParkOpsOwnerId();
  }

  async function releaseParkOps(): Promise<void> {
    try {
      const state = await parkOpsControlService.release();
      if (!disposed) applyParkOpsState(state);
      ElMessage.success('已释放大屏控制，控制权回到现场');
    } catch (error) {
      ElMessage.error(`释放控制失败: ${(error as Error).message}`);
    }
  }

  async function selectParkDashboard(): Promise<void> {
    const isCurrent = options.captureAction();
    if (!isCurrent()) return;
    options.busy.value = true;
    try {
      await ensureDisplayPath();
      if (!isCurrent()) return;
      await publishParkDashboard(options.slot.value);
      if (!isCurrent()) return;
      ElMessage.success(`已将园区运营大屏投放到${options.title()}`);
      void syncParkOpsState();
    } catch (error) {
      if (isCurrent()) ElMessage.error(`投放园区运营大屏失败: ${(error as Error).message}`);
    } finally {
      options.busy.value = false;
    }
  }

  async function parkOpsControl(action: ParkOpsAction): Promise<void> {
    if (parkOpsBusy.value) return;
    const isCurrent = options.captureAction();
    parkOpsBusy.value = true;
    try {
      if (action !== 'refresh') {
        const held = await ensureClaimed();
        if (!held || !isCurrent() || disposed) return;
      }
      const state = action === 'next'
        ? await parkOpsControlService.next()
        : action === 'prev'
          ? await parkOpsControlService.prev()
          : action === 'auto'
            ? await parkOpsControlService.setAuto(!parkOpsAuto.value)
            : await parkOpsControlService.refresh();
      if (!isCurrent() || disposed) return;
      applyParkOpsState(state);
      const successMessage = action === 'next'
        ? '已切到下一页'
        : action === 'prev'
          ? '已切到上一页'
          : action === 'auto'
            ? state.autoPlay ? '自动轮播已开启' : '自动轮播已关闭'
            : '已发送强制刷新指令';
      ElMessage.success(successMessage);
    } catch (error) {
      if (isCurrent() && !disposed) {
        ElMessage.error(`运营大屏控制失败: ${(error as Error).message}`);
      }
    } finally {
      if (action === 'refresh' && isCurrent() && !disposed) {
        refreshCooldown = setTimeout(() => { parkOpsBusy.value = false; }, 3000);
      } else {
        parkOpsBusy.value = false;
      }
    }
  }

  return {
    activeSource,
    srcHint,
    welcomePickerBusy,
    welcomePickerValue,
    parkOpsPage,
    parkOpsTotalPages,
    parkOpsAuto,
    parkOpsBusy,
    parkOpsClaimed,
    parkOpsClaimByMe,
    parkOpsClaimName,
    parkOpsClaimRemaining,
    releaseParkOps,
    refreshWelcomeSchemeOptions,
    selectContent,
    selectWelcome,
    onWelcomeSchemePick,
    selectParkDashboard,
    parkOpsControl,
    syncParkOpsState,
  };
}
