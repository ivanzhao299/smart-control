import {
  computed,
  onScopeDispose,
  ref,
  watch,
  type Ref,
} from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { usePlaybackStore } from '@/stores/playback';
import { setDocPage, setDocZoom } from '@/services/playback.service';
import type { PlaybackChannelView } from '@/types/api';

interface PlayerDocumentControlsOptions {
  slot: Readonly<Ref<1 | 2>>;
  title(): string;
  channel: Readonly<Ref<PlaybackChannelView | null | undefined>>;
  captureAction(): () => boolean;
  stopPlayback(expectedSession?: string | null): Promise<void>;
}

/**
 * 文档放映控制。
 *
 * 翻页和缩放都可能在网络请求期间遇到切屏、换片、退出登录。每次操作因此同时绑定
 * 槽位、播放会话和身份边界；旧请求即使最后才返回，也不能覆盖新会话的画面状态。
 */
export function usePlayerDocumentControls(options: PlayerDocumentControlsOptions) {
  const playbackStore = usePlaybackStore();
  const isDocPlaying = computed(() =>
    options.channel.value?.currentMediaKind === 'doc'
    && !!options.channel.value?.currentMediaId);
  const docPage = computed(() => options.channel.value?.docPage ?? 1);
  const docTotal = computed(() => options.channel.value?.currentMediaPageCount ?? null);
  const docZoom = computed(() => options.channel.value?.docZoom ?? 100);
  const pageBusy = ref(false);
  const zoomBusy = ref(false);

  let scopeDisposed = false;
  let pageRevision = 0;
  let zoomRevision = 0;

  function sameSession(slot: 1 | 2, session: string, action: () => boolean): boolean {
    return !scopeDisposed
      && action()
      && options.slot.value === slot
      && options.channel.value?.playbackSession === session;
  }

  watch([
    options.slot,
    () => options.channel.value?.playbackSession,
  ], () => {
    pageRevision += 1;
    zoomRevision += 1;
    pageBusy.value = false;
    zoomBusy.value = false;
  }, { flush: 'sync' });

  async function gotoDocPage(page: number): Promise<void> {
    if (pageBusy.value) return;
    const session = options.channel.value?.playbackSession;
    if (!session) {
      ElMessage.warning('请刷新播放状态后重试');
      return;
    }
    const maximum = docTotal.value ?? Number.MAX_SAFE_INTEGER;
    const target = Math.max(1, Math.min(page, maximum));
    if (target === docPage.value) return;

    const slot = options.slot.value;
    const action = options.captureAction();
    const revision = ++pageRevision;
    pageBusy.value = true;
    try {
      const channel = await setDocPage(slot, target, session);
      if (revision !== pageRevision || !sameSession(slot, session, action)) return;
      if (channel.playbackSession !== session) return;
      playbackStore.handleWs({ type: 'playback_channel_changed', data: channel } as never);
    } catch (error) {
      if (revision === pageRevision && sameSession(slot, session, action)) {
        ElMessage.error(`翻页失败: ${(error as Error).message}`);
      }
    } finally {
      if (revision === pageRevision) pageBusy.value = false;
    }
  }

  async function applyDocZoom(zoom: number): Promise<void> {
    if (zoomBusy.value) return;
    const session = options.channel.value?.playbackSession;
    if (!session) {
      ElMessage.warning('请刷新播放状态后重试');
      return;
    }

    const slot = options.slot.value;
    const action = options.captureAction();
    const revision = ++zoomRevision;
    zoomBusy.value = true;
    try {
      const channel = await setDocZoom(slot, zoom, session);
      if (revision !== zoomRevision || !sameSession(slot, session, action)) return;
      if (channel.playbackSession !== session) return;
      playbackStore.handleWs({ type: 'playback_channel_changed', data: channel } as never);
    } catch (error) {
      if (revision === zoomRevision && sameSession(slot, session, action)) {
        ElMessage.error(`缩放失败: ${(error as Error).message}`);
      }
    } finally {
      if (revision === zoomRevision) zoomBusy.value = false;
    }
  }

  /** 结束当前文档放映，使屏幕回到播放器待机画面。 */
  async function exitDocShow(): Promise<void> {
    const session = options.channel.value?.playbackSession;
    if (!session) {
      ElMessage.warning('请刷新播放状态后重试');
      return;
    }
    const slot = options.slot.value;
    const action = options.captureAction();
    try {
      await ElMessageBox.confirm(`退出文档放映?${options.title()}将回到待机画面。`, '退出放映',
        { type: 'warning', confirmButtonText: '退出', cancelButtonText: '取消' });
    } catch {
      return;
    }
    if (!sameSession(slot, session, action)) return;
    await options.stopPlayback(session);
  }

  onScopeDispose(() => {
    scopeDisposed = true;
    pageRevision += 1;
    zoomRevision += 1;
    pageBusy.value = false;
    zoomBusy.value = false;
  });

  return {
    isDocPlaying,
    docPage,
    docTotal,
    docZoom,
    pageBusy,
    zoomBusy,
    gotoDocPage,
    applyDocZoom,
    exitDocShow,
  };
}
