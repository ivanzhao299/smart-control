import { computed, ref, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { usePlaybackStore } from '@/stores/playback';
import type { PlaybackChannelView } from '@/types/api';

interface PlayerVideoControlsOptions {
  slot: Readonly<Ref<1 | 2>>;
  channel: Readonly<Ref<PlaybackChannelView | null | undefined>>;
  /** 每次手势/异步操作开始时捕获槽位与身份边界, 操作返回后确认未切屏、未换身份 */
  captureAction(): () => boolean;
}

/**
 * 视频单次/循环切换 + 可拖拽进度条 (2026-10, 仅控制端)。
 *
 * - 进度来源: 大屏播放器约 1s 经 WS 回传 playback_progress, store.progressMap 按 slot 存。
 *   换片后只采信 mediaId 与当前通道一致的进度, 滑块才不会停在旧片位置。
 * - 拖拽: @input 阶段只改本地值(滑块跟手、不被回传拽回), 松手 @change 才下发 seek;
 *   之后位置以大屏 seek 后立即回传的真实 currentTime 为准。
 * - 单次/循环: 持久化到通道并广播, 大屏 :loop 绑定即时更新; once 播完停尾帧。
 */
export function usePlayerVideoControls(options: PlayerVideoControlsOptions) {
  const playbackStore = usePlaybackStore();

  const isVideoPlaying = computed(() =>
    options.channel.value?.currentMediaKind === 'video'
    && !!options.channel.value?.currentMediaId);

  /** 大屏回传的当前视频进度; 换片后旧媒体的进度不采信。 */
  const liveProgress = computed(() => {
    const p = playbackStore.progressMap[options.slot.value];
    if (!p) return null;
    const currentId = options.channel.value?.currentMediaId;
    if (currentId && p.mediaId !== null && p.mediaId !== currentId) return null;
    return p;
  });

  const seekDuration = computed(() => {
    const d = liveProgress.value?.duration;
    if (typeof d === 'number' && d > 0) return d;
    return options.channel.value?.currentMediaDurationSec ?? 0;
  });

  // 拖动中本地值优先, 松手 seek 后交回大屏回传
  const seekDragging = ref(false);
  const seekDragValue = ref(0);
  const seekCurrent = computed(() =>
    (seekDragging.value ? seekDragValue.value : (liveProgress.value?.currentTime ?? 0)));
  const loopBusy = ref(false);

  function onSeekInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    seekDragging.value = true;
    seekDragValue.value = Number.isFinite(v) ? v : 0;
  }

  async function onSeekCommit(e: Event): Promise<void> {
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    const v = Number((e.target as HTMLInputElement).value);
    const target = Number.isFinite(v) ? v : 0;
    seekDragValue.value = target;
    try {
      await playbackStore.seek(slot, target);
    } catch (err) {
      if (currentAction()) ElMessage.error(`进度跳转失败: ${(err as Error).message}`);
    } finally {
      seekDragging.value = false; // 松手后交给大屏回传的位置收敛
    }
  }

  async function toggleLoop(): Promise<void> {
    if (loopBusy.value) return;
    const currentAction = options.captureAction();
    const channel = options.channel.value;
    if (!channel) return;
    const slot = options.slot.value;
    const next = channel.loopMode === 'loop' ? 'once' : 'loop';
    loopBusy.value = true;
    try {
      await playbackStore.setLoop(slot, next);
      if (currentAction()) {
        ElMessage.success(next === 'loop' ? '已切换为循环播放' : '已切换为单次播放（播完停尾帧）');
      }
    } catch (err) {
      if (currentAction()) ElMessage.error(`切换失败: ${(err as Error).message}`);
    } finally {
      loopBusy.value = false;
    }
  }

  function formatTime(sec: number): string {
    const n = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = n % 60;
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  return {
    isVideoPlaying,
    liveProgress,
    seekDuration,
    seekCurrent,
    seekDragging,
    loopBusy,
    onSeekInput,
    onSeekCommit,
    toggleLoop,
    formatTime,
  };
}
