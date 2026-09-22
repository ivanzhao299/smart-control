import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { audioService } from '@/services/audio.service';
import { faderPercentFromY } from '@/features/audio-view-model';
import { createLatestCommandQueue } from '@/features/latest-command-queue';
import {
  captureIdentityGuard,
  onIdentityChange,
  onServerChange,
} from '@/services/identity-boundary';
import type { AudioOutputRow } from './useAudioOutputCatalog';

type AudioOutputControlService = Pick<typeof audioService, 'setVolume' | 'mute' | 'unmute'>;

interface AudioOutputMessages {
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

interface AudioOutputConfirm {
  (message: string, title: string, options: Record<string, unknown>): Promise<unknown>;
}

interface AudioOutputStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface AudioOutputDocument {
  addEventListener(type: 'touchmove', listener: (event: TouchEvent) => void, options: AddEventListenerOptions): void;
  removeEventListener(type: 'touchmove', listener: (event: TouchEvent) => void): void;
}

interface AudioOutputScheduler {
  delay(milliseconds: number): Promise<void>;
}

interface AudioOutputControlsOptions {
  channels: Ref<AudioOutputRow[]>;
  partnerOf: (row: AudioOutputRow) => AudioOutputRow | undefined;
  linkOn: (row: AudioOutputRow) => boolean;
  service?: AudioOutputControlService;
  messages?: AudioOutputMessages;
  confirm?: AudioOutputConfirm;
  storage?: AudioOutputStorage;
  documentPort?: AudioOutputDocument;
  scheduler?: AudioOutputScheduler;
}

interface OutputVolumeCommand {
  row: AudioOutputRow;
  value: number;
  zone: string | undefined;
  isCurrent: () => boolean;
}

interface FadeTarget {
  row: AudioOutputRow;
  volume: number;
  revision: number;
}

type MuteResult = 'success' | 'failure' | 'stale';

const MUTE_STATE_KEY = 'audio_mute_state_v1';
const FADE_STEPS = 5;
const FADE_STEP_MS = 800;

function defaultStorage(): AudioOutputStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function defaultDocument(): AudioOutputDocument | undefined {
  return typeof document === 'undefined' ? undefined : document;
}

/**
 * 音频输出音量、静音、推子和渐响的唯一运行边界。
 *
 * 每路音量写入串行并只保留最新等待值。身份、服务器、页面停用或作用域销毁后，
 * 旧排队值和渐响步骤不再发送；批量静音会逐路核对结果，避免部分失败仍提示全部成功。
 */
export function useAudioOutputControls(options: AudioOutputControlsOptions) {
  const {
    channels,
    partnerOf,
    linkOn,
    service = audioService,
    messages = ElMessage,
    confirm = ElMessageBox.confirm,
    storage = defaultStorage(),
    documentPort = defaultDocument(),
    scheduler = { delay: (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); }) },
  } = options;

  const draggingFaderId = ref<string | null>(null);
  const savedVolumes = ref<Record<string, number>>({});
  const allMuted = computed(() => (
    channels.value.length > 0 && channels.value.every((channel) => channel.muted)
  ));
  let disposed = false;
  let commandEpoch = 0;
  const volumeRevisions = new Map<string, number>();
  const muteRevisions = new Map<string, number>();
  const fadeRevisions = new Map<string, number>();
  const mutePendingIds = new Map<string, symbol>();

  function saveMuteState(): void {
    if (!storage) return;
    const state: Record<string, { muted: boolean; volume: number }> = {};
    for (const channel of channels.value) {
      state[channel.id] = { muted: channel.muted, volume: channel.volume };
    }
    try { storage.setItem(MUTE_STATE_KEY, JSON.stringify(state)); } catch { /* Storage is optional. */ }
  }

  function restoreOutputState(): void {
    if (!storage) return;
    try {
      const raw = storage.getItem(MUTE_STATE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, { muted?: unknown; volume?: unknown }>;
      for (const channel of channels.value) {
        const entry = saved[channel.id];
        if (!entry || typeof entry.muted !== 'boolean' || typeof entry.volume !== 'number') continue;
        if (!Number.isFinite(entry.volume) || entry.volume < 0 || entry.volume > 100) continue;
        channel.muted = entry.muted;
        channel.volume = Math.round(entry.volume);
        savedVolumes.value[channel.id] = channel.volume;
      }
    } catch { /* Ignore corrupt browser state and keep safe defaults. */ }
  }

  const outputVolumeQueue = createLatestCommandQueue<string, OutputVolumeCommand>({
    execute: async (id, command) => {
      if (!command.isCurrent()) return;
      try {
        const result = await service.setVolume(id, command.value, command.zone);
        if (!command.isCurrent()) return;
        if (!result.ok) throw new Error(result.error || '执行失败');
      } catch (error) {
        if (!command.isCurrent()) return;
        throw error;
      }
    },
    onSuccess: (_id, command) => {
      if (command.isCurrent()) command.row.error = null;
    },
    onError: (_id, error, command) => {
      if (command.isCurrent()) command.row.error = (error as Error).message;
    },
  });

  function cancelFade(id: string): void {
    fadeRevisions.set(id, (fadeRevisions.get(id) ?? 0) + 1);
  }

  function queueVolume(row: AudioOutputRow): void {
    const epoch = commandEpoch;
    const revision = (volumeRevisions.get(row.id) ?? 0) + 1;
    volumeRevisions.set(row.id, revision);
    const isCurrent = captureIdentityGuard(() => (
      !disposed
      && epoch === commandEpoch
      && volumeRevisions.get(row.id) === revision
    ));
    outputVolumeQueue.enqueue(row.id, { row, value: row.volume, zone: row.zone, isCurrent });
  }

  function setFaderValue(row: AudioOutputRow, value: number): void {
    if (disposed || row.muted || mutePendingIds.has(row.id)) return;
    cancelFade(row.id);
    row.volume = value;
    queueVolume(row);
    const mate = partnerOf(row);
    if (mate && linkOn(row)) {
      cancelFade(mate.id);
      mate.volume = value;
      queueVolume(mate);
    }
  }

  function onFaderPointerDown(row: AudioOutputRow, event: PointerEvent): void {
    if (row.muted || disposed) return;
    const track = event.currentTarget as HTMLElement;
    track.setPointerCapture(event.pointerId);
    draggingFaderId.value = row.id;
    setFaderValue(row, faderPercentFromY(track.getBoundingClientRect(), event.clientY));
  }

  function onFaderPointerMove(row: AudioOutputRow, event: PointerEvent): void {
    if (draggingFaderId.value !== row.id) return;
    const track = event.currentTarget as HTMLElement;
    setFaderValue(row, faderPercentFromY(track.getBoundingClientRect(), event.clientY));
  }

  function onFaderPointerUp(row: AudioOutputRow, event: PointerEvent): void {
    if (draggingFaderId.value !== row.id) return;
    draggingFaderId.value = null;
    const track = event.currentTarget as HTMLElement;
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    setFaderValue(row, row.volume);
    if (row.error) messages.error(`${row.name} 音量调节失败: ${row.error}`);
  }

  function preventScrollWhileDragging(event: TouchEvent): void {
    event.preventDefault();
  }

  watch(draggingFaderId, (id) => {
    if (!documentPort) return;
    if (id) documentPort.addEventListener('touchmove', preventScrollWhileDragging, { passive: false });
    else documentPort.removeEventListener('touchmove', preventScrollWhileDragging);
  });

  function beginMute(row: AudioOutputRow): () => boolean {
    cancelFade(row.id);
    volumeRevisions.set(row.id, (volumeRevisions.get(row.id) ?? 0) + 1);
    const epoch = commandEpoch;
    const revision = (muteRevisions.get(row.id) ?? 0) + 1;
    muteRevisions.set(row.id, revision);
    return captureIdentityGuard(() => (
      !disposed
      && epoch === commandEpoch
      && muteRevisions.get(row.id) === revision
    ));
  }

  async function applyMute(row: AudioOutputRow, muted: boolean, isCurrent: () => boolean): Promise<MuteResult> {
    try {
      const result = muted
        ? await service.mute(row.id, row.zone)
        : await service.unmute(row.id, row.zone);
      if (!isCurrent()) return 'stale';
      if (!result.ok) throw new Error(result.error || '执行失败');
      row.muted = muted;
      row.error = null;
      return 'success';
    } catch (error) {
      if (!isCurrent()) return 'stale';
      row.error = (error as Error).message;
      return 'failure';
    }
  }

  async function fadeInVolumes(rows: Array<{ row: AudioOutputRow; volume: number }>): Promise<void> {
    const epoch = commandEpoch;
    const targets: FadeTarget[] = rows.map(({ row, volume }) => {
      const revision = (fadeRevisions.get(row.id) ?? 0) + 1;
      fadeRevisions.set(row.id, revision);
      return { row, volume, revision };
    });
    for (let step = 1; step <= FADE_STEPS; step += 1) {
      const active = targets.filter(({ row, revision }) => (
        !disposed
        && epoch === commandEpoch
        && fadeRevisions.get(row.id) === revision
        && !row.muted
      ));
      if (!active.length) return;
      const percent = step / FADE_STEPS;
      for (const target of active) {
        const value = Math.round(target.volume * percent);
        target.row.volume = value;
        void service.setVolume(target.row.id, value, target.row.zone).catch(() => {});
      }
      if (step < FADE_STEPS) await scheduler.delay(FADE_STEP_MS);
    }
    saveMuteState();
  }

  async function toggleMute(row: AudioOutputRow): Promise<boolean> {
    if (disposed) return false;
    const targetMuted = !row.muted;
    const targets = [row];
    const mate = partnerOf(row);
    if (mate && mate.muted !== targetMuted) targets.push(mate);
    if (targets.some((target) => mutePendingIds.has(target.id))) return false;
    const pendingToken = Symbol('mute');
    for (const target of targets) mutePendingIds.set(target.id, pendingToken);
    if (targetMuted) {
      for (const target of targets) {
        savedVolumes.value = { ...savedVolumes.value, [target.id]: target.volume };
      }
    }
    const guards = targets.map((target) => beginMute(target));
    const results = await Promise.all(targets.map((target, index) => (
      applyMute(target, targetMuted, guards[index])
    )));
    for (const target of targets) {
      if (mutePendingIds.get(target.id) === pendingToken) mutePendingIds.delete(target.id);
    }
    if (results.every((result) => result === 'stale')) return false;
    const currentResults = results.filter((result) => result === 'success').length;
    saveMuteState();
    if (!currentResults) {
      const detail = targets.find((target) => target.error)?.error ?? '执行失败';
      messages.error(`${row.name} ${targetMuted ? '静音' : '取消静音'}失败: ${detail}`);
      return false;
    }
    if (currentResults !== targets.length) {
      messages.warning(`${row.name} 部分声道${targetMuted ? '静音' : '取消静音'}失败，请按当前状态重试`);
    }
    if (!targetMuted) {
      const fadeTargets = targets
        .filter((target) => !target.muted)
        .map((target) => {
          const volume = savedVolumes.value[target.id] ?? target.volume;
          target.volume = 0;
          void service.setVolume(target.id, 0, target.zone).catch(() => {});
          return { row: target, volume };
        });
      void fadeInVolumes(fadeTargets);
    }
    return currentResults === targets.length;
  }

  async function toggleMuteAll(): Promise<boolean> {
    if (disposed || channels.value.length === 0) return false;
    const isCurrent = captureIdentityGuard(() => !disposed);
    const targetMuted = !allMuted.value;
    if (targetMuted) {
      try {
        await confirm('确定全部静音?全场背景音乐与音源都会闭声。', '全部静音确认', {
          type: 'warning',
          confirmButtonText: '全部静音',
          cancelButtonText: '取消',
        });
      } catch { return false; }
    }
    if (!isCurrent()) return false;

    const targets = channels.value.filter((row) => row.muted !== targetMuted);
    if (!targets.length) return true;
    if (targets.some((target) => mutePendingIds.has(target.id))) return false;
    const pendingToken = Symbol('mute-all');
    for (const target of targets) mutePendingIds.set(target.id, pendingToken);
    if (targetMuted) {
      for (const target of targets) {
        savedVolumes.value = { ...savedVolumes.value, [target.id]: target.volume };
      }
    }
    const guards = targets.map((target) => beginMute(target));
    const results = await Promise.all(targets.map((target, index) => (
      applyMute(target, targetMuted, guards[index])
    )));
    for (const target of targets) {
      if (mutePendingIds.get(target.id) === pendingToken) mutePendingIds.delete(target.id);
    }
    if (results.every((result) => result === 'stale')) return false;
    const successes = results.filter((result) => result === 'success').length;
    saveMuteState();
    if (!successes) {
      messages.error(targetMuted ? '全部静音失败，请重试' : '解除静音失败，请重试');
      return false;
    }
    if (successes !== targets.length) {
      messages.warning(`${targetMuted ? '静音' : '解除静音'}部分成功，失败通道已保留原状态`);
    } else {
      messages.success(targetMuted ? '已全部静音' : '已解除静音，音量渐响恢复中…');
    }
    if (!targetMuted) {
      const fadeTargets = targets
        .filter((target) => !target.muted)
        .map((target) => {
          const volume = savedVolumes.value[target.id] ?? target.volume;
          target.volume = 0;
          void service.setVolume(target.id, 0, target.zone).catch(() => {});
          return { row: target, volume };
        });
      void fadeInVolumes(fadeTargets);
    }
    return successes === targets.length;
  }

  function stopOutputControls(): void {
    commandEpoch += 1;
    volumeRevisions.clear();
    muteRevisions.clear();
    fadeRevisions.clear();
    mutePendingIds.clear();
    draggingFaderId.value = null;
    documentPort?.removeEventListener('touchmove', preventScrollWhileDragging);
  }

  const unsubscribeServer = onServerChange(() => {
    stopOutputControls();
    savedVolumes.value = {};
  });
  const unsubscribeIdentity = onIdentityChange(stopOutputControls);

  onScopeDispose(() => {
    disposed = true;
    stopOutputControls();
    unsubscribeServer();
    unsubscribeIdentity();
  });

  return {
    allMuted,
    draggingFaderId,
    restoreOutputState,
    setFaderValue,
    onFaderPointerDown,
    onFaderPointerMove,
    onFaderPointerUp,
    toggleMute,
    toggleMuteAll,
    stopOutputControls,
  };
}
