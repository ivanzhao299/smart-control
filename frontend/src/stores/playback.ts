import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { listChannels, publishToChannel, stopChannel, pauseChannel, resumeChannel, nextInPlaylist, prevInPlaylist, setLoopMode as apiSetLoopMode, seekChannel, type LoopMode } from '@/services/playback.service';
import type { PlaybackChannelView, PlaybackProgressWsEvent, WsEvent } from '@/types/api';

/** 大屏视频实时进度 (仅内存态, 控制端进度条用)。换片时按 mediaId 是否匹配决定是否采信。 */
export type PlaybackProgressState = {
  mediaId: number | null;
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  at: string;
};

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
  /** 各 slot 大屏视频实时进度 (2026-10), 仅内存态; 渲染时按 mediaId 与当前通道匹配再采信 */
  const progressMap = ref<Record<number, PlaybackProgressState>>({});
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

  async function stop(slot: number, expectedSession?: string): Promise<void> {
    const view = await stopChannel(slot, expectedSession);
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

  /** 单次/循环切换 (2026-10): 持久化到通道, 大屏经 channel_changed 即时生效 */
  async function setLoop(slot: number, mode: LoopMode): Promise<void> {
    patchChannel(await apiSetLoopMode(slot, mode));
  }

  /** 拖拽进度条: 下发实时 seek 指令, 进度位置以大屏回传为准 (不做本地乐观值) */
  async function seek(slot: number, time: number): Promise<void> {
    await seekChannel(slot, time);
  }

  function patchChannel(view: PlaybackChannelView): void {
    const idx = channels.value.findIndex((c) => c.slot === view.slot);
    if (idx >= 0) channels.value[idx] = view;
    else channels.value.push(view);
  }

  function handleWs(event: WsEvent): void {
    if (event.type === 'playback_channel_changed') {
      void load().catch(() => { /* State was cleared; next refresh can recover. */ });
    } else if (event.type === 'playback_progress') {
      const e = event as PlaybackProgressWsEvent;
      progressMap.value[e.slot] = {
        mediaId: e.mediaId,
        currentTime: e.currentTime,
        duration: e.duration,
        paused: e.paused,
        ended: e.ended,
        at: e.at,
      };
    }
  }

  return {
    clearIdentity,
    next,
    prev, channels, loaded, loading, slot1, slot2, slotAudio, channelMap, progressMap,
    load, publish, stop, pause, resume, setLoop, seek, handleWs };
});
