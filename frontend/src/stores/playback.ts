import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { listChannels, publishToChannel, stopChannel, type LoopMode } from '@/services/playback.service';
import type { PlaybackChannelView, WsEvent } from '@/types/api';

/**
 * 播控通道 store.
 *
 * App.vue 启动期 load() 一次拿所有通道, WS handler 收到 playback_channel_changed
 * 就 patch 对应 slot. 所有 UI (MediaPage 推送 / LedPage 显示当前播 / PlayerPage
 * 自己) 都从这里读 reactive 状态.
 */
export const usePlaybackStore = defineStore('playback', () => {
  const channels = ref<PlaybackChannelView[]>([]);
  const loaded = ref(false);
  const loading = ref(false);

  const channelMap = computed<Record<number, PlaybackChannelView>>(() => {
    const m: Record<number, PlaybackChannelView> = {};
    for (const c of channels.value) m[c.slot] = c;
    return m;
  });

  const slot1 = computed<PlaybackChannelView | null>(() => channelMap.value[1] ?? null);
  const slot2 = computed<PlaybackChannelView | null>(() => channelMap.value[2] ?? null);

  async function load(): Promise<void> {
    loading.value = true;
    try {
      channels.value = await listChannels();
      loaded.value = true;
    } finally {
      loading.value = false;
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

  function patchChannel(view: PlaybackChannelView): void {
    const idx = channels.value.findIndex((c) => c.slot === view.slot);
    if (idx >= 0) channels.value[idx] = view;
    else channels.value.push(view);
  }

  function handleWs(event: WsEvent): void {
    if (event.type === 'playback_channel_changed') {
      patchChannel(event.view);
    }
  }

  return { channels, loaded, loading, slot1, slot2, channelMap, load, publish, stop, handleWs };
});
