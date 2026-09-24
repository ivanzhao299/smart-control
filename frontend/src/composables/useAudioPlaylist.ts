import { computed, getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { usePlaybackStore } from '@/stores/playback';
import {
  addToPlaylist as apiAddToPlaylist,
  listPlaylist as apiListPlaylist,
  removeFromPlaylist as apiRemoveFromPlaylist,
  renamePlaylistItem as apiRenamePlaylistItem,
  setChannelPlayMode as apiSetChannelPlayMode,
  type PlaylistItemView,
} from '@/services/playback.service';
import { mediaService, type MediaItem } from '@/services/media.service';
import { absUrl } from '@/services/http';
import { createPlaybackProgressController } from '@/features/playback-progress-controller';
import { probeAudioDuration } from '@/features/audio-duration-probe';
import type { PlaybackChannelView } from '@/types/api';

export interface AudioPlaylistItem {
  /** media 表主键 */
  id: number;
  /** playlist_item 表主键；媒体选择器里的候选项没有 */
  itemId?: number;
  name: string;
  durationSec: number | null;
  /** 媒体已删除时仍展示，便于管理员移除失效条目 */
  missing?: boolean;
}

export type AudioPlayMode = 'seq' | 'loop1' | 'loopAll' | 'shuffle';

interface AudioPlaylistPlaybackPort {
  channel: Readonly<Ref<PlaybackChannelView | null>>;
  publish(mediaId: number): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  previous(): Promise<void>;
  next(): Promise<void>;
}

interface AudioPlaylistApi {
  list(): Promise<PlaylistItemView[]>;
  add(mediaId: number): Promise<unknown>;
  remove(itemId: number): Promise<unknown>;
  rename(itemId: number, title: string): Promise<unknown>;
  setPlayMode(mode: AudioPlayMode): Promise<unknown>;
  listAudioAssets(): Promise<Pick<MediaItem, 'id' | 'originalName' | 'durationSec'>[]>;
  probeDuration(mediaId: number): Promise<number | null>;
}

interface AudioPlaylistMessages {
  info(message: string): void;
  success(message: string): void;
  error(message: string): void;
}

export interface UseAudioPlaylistOptions {
  ensureAdmin: (what: string) => Promise<boolean>;
  playback?: AudioPlaylistPlaybackPort;
  api?: Partial<AudioPlaylistApi>;
  messages?: AudioPlaylistMessages;
  confirmRemove?: (item: AudioPlaylistItem) => Promise<boolean>;
}

const BGM_SLOT = 3;

function toPlaylistItem(row: PlaylistItemView): AudioPlaylistItem {
  return {
    id: row.mediaId,
    itemId: row.id,
    name: row.title,
    durationSec: row.durationSec,
    missing: row.missing,
  };
}

/**
 * 背景音乐播放列表用例。
 *
 * 后台 slot 3 通道始终是当前媒体、会话、暂停态和播放模式的权威来源；组合式用例
 * 只维护页面投影、用户操作和视觉进度，不另存播放事实。
 */
export function useAudioPlaylist(options: UseAudioPlaylistOptions) {
  const playbackStore = options.playback ? null : usePlaybackStore();
  const playback: AudioPlaylistPlaybackPort = options.playback ?? {
    channel: computed(() => playbackStore!.slotAudio),
    publish: (mediaId) => playbackStore!.publish(BGM_SLOT, mediaId, 'loop'),
    stop: () => playbackStore!.stop(BGM_SLOT),
    pause: () => playbackStore!.pause(BGM_SLOT),
    resume: () => playbackStore!.resume(BGM_SLOT),
    previous: () => playbackStore!.prev(BGM_SLOT),
    next: () => playbackStore!.next(BGM_SLOT),
  };

  const api: AudioPlaylistApi = {
    list: () => apiListPlaylist(BGM_SLOT),
    add: (mediaId) => apiAddToPlaylist(BGM_SLOT, mediaId),
    remove: apiRemoveFromPlaylist,
    rename: apiRenamePlaylistItem,
    setPlayMode: (mode) => apiSetChannelPlayMode(BGM_SLOT, mode),
    listAudioAssets: async () => (await mediaService.list({ kind: 'audio' })).items,
    probeDuration: (mediaId) => probeAudioDuration(absUrl(`/api/media/${mediaId}/file`)),
    ...options.api,
  };
  const messages = options.messages ?? ElMessage;
  const confirmRemove = options.confirmRemove ?? (async (item: AudioPlaylistItem) => {
    try {
      await ElMessageBox.confirm(
        `将「${item.name}」移出播放列表? 只移出列表, 不删除媒体库里的原文件。`,
        '移出确认',
        { confirmButtonText: '移出', cancelButtonText: '取消', type: 'warning' },
      );
      return true;
    } catch {
      return false;
    }
  });

  const bgmChannel = playback.channel;
  const playlist = ref<AudioPlaylistItem[]>([]);
  const plIdx = ref(-1);
  const playMode = ref<AudioPlayMode>('loopAll');
  const plProgress = ref(0);
  const plPickerOpen = ref(false);
  const audioAssets = ref<AudioPlaylistItem[]>([]);
  const plEditingId = ref<number | null>(null);
  const plEditingText = ref('');

  const progressController = createPlaybackProgressController({
    onProgress: (percent) => { plProgress.value = percent; },
  });

  const plCurrentItem = computed<AudioPlaylistItem | null>(() => (
    plIdx.value >= 0 && plIdx.value < playlist.value.length ? playlist.value[plIdx.value] : null
  ));

  async function loadPlaylist(): Promise<boolean> {
    try {
      playlist.value = (await api.list()).map(toPlaylistItem);
      return true;
    } catch (error) {
      messages.error(`加载背景音乐列表失败: ${(error as Error).message}`);
      return false;
    }
  }

  async function loadAudioAssets(): Promise<void> {
    try {
      audioAssets.value = (await api.listAudioAssets()).map((item) => ({
        id: item.id,
        name: item.originalName,
        durationSec: item.durationSec,
      }));
    } catch { /* 媒体选择器是可选入口，失败不阻塞主页面。 */ }
  }

  async function addToPlaylist(item: AudioPlaylistItem): Promise<void> {
    try {
      await api.add(item.id);
      await loadPlaylist();
    } catch (error) {
      messages.error(`加入失败: ${(error as Error).message}`);
    }
  }

  async function removeFromPlaylist(index: number): Promise<void> {
    const item = playlist.value[index];
    if (!item || !(await confirmRemove(item))) return;
    if (!item.itemId) {
      playlist.value.splice(index, 1);
      return;
    }
    try {
      await api.remove(item.itemId);
      await loadPlaylist();
      if (plIdx.value >= playlist.value.length) plIdx.value = playlist.value.length - 1;
    } catch (error) {
      messages.error(`移除失败: ${(error as Error).message}`);
    }
  }

  async function startRenamePl(item: AudioPlaylistItem): Promise<void> {
    if (!item.itemId || !(await options.ensureAdmin('改名'))) return;
    plEditingId.value = item.itemId;
    plEditingText.value = item.name;
  }

  async function commitRenamePl(item: AudioPlaylistItem): Promise<void> {
    const title = plEditingText.value.trim();
    plEditingId.value = null;
    if (!item.itemId || !title || title === item.name) return;
    const previous = item.name;
    item.name = title;
    try {
      await api.rename(item.itemId, title);
      messages.success('已改名 (媒体库原文件不变)');
    } catch (error) {
      item.name = previous;
      messages.error(`改名失败: ${(error as Error).message}`);
    }
  }

  async function clearPlaylist(): Promise<void> {
    progressController.reset();
    if (bgmChannel.value?.currentMediaId) await playback.stop().catch(() => {});

    let failed = 0;
    for (const item of playlist.value.slice()) {
      if (!item.itemId) continue;
      try { await api.remove(item.itemId); } catch { failed += 1; }
    }
    const reloaded = await loadPlaylist();
    plIdx.value = -1;
    plProgress.value = 0;
    if (failed > 0) {
      messages.error(reloaded
        ? `${failed} 项未能移出，已重新读取后台列表`
        : `${failed} 项未能移出，后台列表重新读取也失败，请稍后刷新`);
    }
  }

  function onPlRowClick(index: number, item: AudioPlaylistItem): void {
    if (plEditingId.value === item.itemId) return;
    void playAt(index);
  }

  async function playAt(index: number): Promise<void> {
    if (playlist.value.length === 0 || index < 0) return;
    const normalized = ((index % playlist.value.length) + playlist.value.length) % playlist.value.length;
    try {
      await playback.publish(playlist.value[normalized].id);
    } catch (error) {
      messages.error(`播放失败: ${(error as Error).message}`);
    }
  }

  async function syncPlaybackFromChannel(
    mediaId: number | null | undefined,
    session: string | null | undefined,
  ): Promise<void> {
    if (!mediaId) {
      plIdx.value = -1;
      progressController.reset();
      return;
    }
    progressController.reset();
    const index = playlist.value.findIndex((item) => item.id === mediaId);
    plIdx.value = index;
    let duration = index >= 0 ? playlist.value[index].durationSec : null;
    if (!duration) {
      duration = await api.probeDuration(mediaId);
      const current = bgmChannel.value;
      if (current?.currentMediaId !== mediaId || current?.playbackSession !== session) return;
      if (duration && index >= 0) playlist.value[index].durationSec = duration;
    }
    progressController.start(duration, !!bgmChannel.value?.paused);
  }

  async function plTogglePause(): Promise<void> {
    try {
      if (!bgmChannel.value?.currentMediaId) {
        if (playlist.value.length > 0) await playAt(plIdx.value >= 0 ? plIdx.value : 0);
      } else if (bgmChannel.value.paused) {
        await playback.resume();
      } else {
        await playback.pause();
      }
    } catch (error) {
      messages.error(`暂停或继续失败: ${(error as Error).message}`);
    }
  }

  async function plPrev(): Promise<void> {
    if (playlist.value.length === 0) return;
    try { await playback.previous(); }
    catch (error) { messages.error(`上一首失败: ${(error as Error).message}`); }
  }

  async function plNext(): Promise<void> {
    if (playlist.value.length === 0) return;
    try { await playback.next(); }
    catch (error) { messages.error(`下一首失败: ${(error as Error).message}`); }
  }

  async function setPlayModeAndSave(mode: AudioPlayMode): Promise<void> {
    const previous = playMode.value;
    playMode.value = mode;
    try { await api.setPlayMode(mode); }
    catch (error) {
      playMode.value = previous;
      messages.error(`设置播放模式失败: ${(error as Error).message}`);
    }
  }

  async function stopBgm(): Promise<void> {
    progressController.reset();
    try {
      await playback.stop();
      messages.success('已停止背景音乐');
    } catch (error) {
      messages.error(`停止失败: ${(error as Error).message}`);
    }
  }

  async function addPickedMedia(mediaId: number, mediaName: string): Promise<void> {
    if (playlist.value.some((item) => item.id === mediaId)) {
      messages.info(`「${mediaName}」已在播放列表里`);
      return;
    }
    try {
      await api.add(mediaId);
      await loadPlaylist();
      messages.success(`「${mediaName}」已加入播放列表`);
    } catch (error) {
      messages.error(`加入播放列表失败: ${(error as Error).message}`);
    }
  }

  const stopChannelWatch = watch(
    () => [bgmChannel.value?.currentMediaId, bgmChannel.value?.playbackSession] as const,
    ([mediaId, session]) => { void syncPlaybackFromChannel(mediaId, session); },
  );
  const stopPauseWatch = watch(() => bgmChannel.value?.paused, (paused) => {
    if (!bgmChannel.value?.currentMediaId) return;
    if (paused) progressController.pause(); else progressController.resume();
  });
  const stopModeWatch = watch(() => bgmChannel.value?.playMode, (mode) => {
    if (mode) playMode.value = mode;
  }, { immediate: true });

  function suspendPlaybackProgress(): void {
    progressController.dispose();
  }

  function dispose(): void {
    stopChannelWatch();
    stopPauseWatch();
    stopModeWatch();
    progressController.dispose();
  }
  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    bgmChannel,
    playlist,
    plIdx,
    playMode,
    plProgress,
    plPickerOpen,
    audioAssets,
    plEditingId,
    plEditingText,
    plCurrentItem,
    loadPlaylist,
    loadAudioAssets,
    addToPlaylist,
    removeFromPlaylist,
    startRenamePl,
    commitRenamePl,
    clearPlaylist,
    onPlRowClick,
    playAt,
    syncPlaybackFromChannel,
    plTogglePause,
    plPrev,
    plNext,
    setPlayModeAndSave,
    stopBgm,
    addPickedMedia,
    suspendPlaybackProgress,
  };
}
