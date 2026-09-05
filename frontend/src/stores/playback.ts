import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { listChannels, publishToChannel, stopChannel, pauseChannel, resumeChannel, nextInPlaylist, prevInPlaylist, type LoopMode } from '@/services/playback.service';
import type { PlaybackChannelView, WsEvent } from '@/types/api';

/**
 * 播控通道 store.
 *
 * App.vue 启动期 load() 一次拿所有通道, WS handler 收到 playback_channel_changed
 * 重新读取经过权限检查的状态。所有 UI (MediaPage 推送 / LedPage 显示当前播 / PlayerPage
 * 自己) 都从这里读 reactive 状态.
 */
export const usePlaybackStore = defineStore('playback', () => {
  const channels = ref<PlaybackChannelView[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  let loadRevision = 0;
  function clearIdentity(): void {
    loadRevision += 1;
    channels.value = [];
    loaded.value = false;
    loading.value = false;
  }

  const channelMap = computed<Record<number, PlaybackChannelView>>(() => {
    const m: Record<number, PlaybackChannelView> = {};
    for (const c of channels.value) m[c.slot] = c;
    return m;
  });

  const slot1 = computed<PlaybackChannelView | null>(() => channelMap.value[1] ?? null);
  const slot2 = computed<PlaybackChannelView | null>(() => channelMap.value[2] ?? null);
  // slot 3 = 背景音乐 (GK9000 声卡 → EKX 音响输入)
  const slotAudio = computed<PlaybackChannelView | null>(() => channelMap.value[3] ?? null);

  async function load(): Promise<void> {
    const revision = ++loadRevision;
    loading.value = true;
    try {
      const result = await listChannels();
      if (revision !== loadRevision) return;
      channels.value = result;
      loaded.value = true;
    } catch (error) {
      if (revision === loadRevision) {
        channels.value = [];
        loaded.value = false;
      }
      throw error;
    } finally {
      if (revision === loadRevision) loading.value = false;
    }
  }

  async function publish(slot: number, mediaId: number, loopMode: LoopMode = 'once'): Promise<void> {
    const view = await publishToChannel(slot, mediaId, loopMode);
    patchChannel(view);
  }

  async function stop(slot: number): Promise<void> {
    const view = await stopChannel(slot);
    patchChannel(view);
  }

  async function pause(slot: number): Promise<void> {
    const view = await pauseChannel(slot);
    patchChannel(view);
  }

  async function resume(slot: number): Promise<void> {
    const view = await resumeChannel(slot);
    patchChannel(view);
  }

  /**
   * 上一个 / 下一个 —— 在播放列表里环形切换 (业主: "不能一直无脑播放, 保持用户控制状态")。
   * 后端以**当前在播的 mediaId** 定位, 不信 playlistIndex; 列表空会返回 400 说人话。
   */
  async function next(slot: number): Promise<void> {
    patchChannel(await nextInPlaylist(slot));
  }
  async function prev(slot: number): Promise<void> {
    patchChannel(await prevInPlaylist(slot));
  }

  function patchChannel(view: PlaybackChannelView): void {
    const idx = channels.value.findIndex((c) => c.slot === view.slot);
    if (idx >= 0) channels.value[idx] = view;
    else channels.value.push(view);
  }

  function handleWs(event: WsEvent): void {
    if (event.type === 'playback_channel_changed') {
      void load().catch(() => { /* State was cleared; next refresh can recover. */ });
    }
  }

  return {
    clearIdentity,
    next,
    prev, channels, loaded, loading, slot1, slot2, slotAudio, channelMap, load, publish, stop, pause, resume, handleWs };
});
