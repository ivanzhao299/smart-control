import { onScopeDispose, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { audioService } from '@/services/audio.service';
import { createAudioMatrixCommandController } from '@/features/audio-matrix-command-controller';
import {
  captureIdentityGuard,
  createLatestIdentityRead,
  onIdentityChange,
  onServerChange,
} from '@/services/identity-boundary';

type AudioMatrixService = Pick<typeof audioService, 'getLiveMatrix' | 'setMatrix'>;

interface AudioMatrixMessages {
  error(message: string): void;
}

interface AudioMatrixScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(timer: unknown): void;
}

interface AudioMatrixOptions {
  service?: AudioMatrixService;
  messages?: AudioMatrixMessages;
  scheduler?: AudioMatrixScheduler;
  isDocumentHidden?: () => boolean;
  pollMs?: number;
  reconcileMs?: number;
}

const defaultScheduler: AudioMatrixScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

function matrixCoordinates(key: string): [number, number] {
  const [outChannel, inputChannel] = key.split('_').map(Number);
  return [outChannel, inputChannel];
}

/**
 * EKX-808 矩阵真值、写入合并、设备对账与活动页轮询的唯一边界。
 *
 * 设备回读始终是权威来源。写入期间先乐观显示，同一交叉点只保留最新待发值，
 * 失败回滚到最后一次设备确认值。一批写入结束后只复读一次；页面停用、身份或
 * 服务器变化会使旧读取、旧排队写入、旧回滚和旧提示全部失效。
 */
export function useAudioMatrix(options: AudioMatrixOptions = {}) {
  const {
    service = audioService,
    messages = ElMessage,
    scheduler = defaultScheduler,
    isDocumentHidden = () => globalThis.document?.hidden ?? false,
    pollMs = 8000,
    reconcileMs = 1200,
  } = options;

  const matrixOn = ref<Record<string, boolean>>({});
  const matrixStale = ref(false);
  const matrixOffline = ref(false);
  const matrixErrMsg = ref('');
  const pendingWrites = ref(0);
  let disposed = false;
  let active = false;
  let startedBefore = false;
  let commandEpoch = 0;
  let pollTimer: unknown = null;
  let reconcileTimer: unknown = null;
  const beginRead = createLatestIdentityRead(() => !disposed);

  async function loadMatrixState(): Promise<boolean> {
    const isCurrent = beginRead();
    try {
      const result = await service.getLiveMatrix();
      if (!isCurrent()) return false;
      if (!result.ok || !result.data?.matrix) {
        throw new Error(result.error || '读矩阵失败');
      }
      const next: Record<string, boolean> = {};
      result.data.matrix.forEach((row, outChannel) => {
        row.forEach((on, inputChannel) => {
          next[`${outChannel}_${inputChannel}`] = on;
        });
      });
      matrixOn.value = next;
      matrixController.confirmSnapshot(next);
      matrixStale.value = false;
      matrixOffline.value = false;
      matrixErrMsg.value = '';
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      matrixStale.value = true;
      const message = (error as Error).message || '';
      matrixErrMsg.value = message;
      matrixOffline.value = /离线|连不上|offline|timed?\s*out|timeout/i.test(message);
      return false;
    }
  }

  function isMatrixOn(outChannel: number, inputChannel: number): boolean {
    return Boolean(matrixOn.value[`${outChannel}_${inputChannel}`]);
  }

  function clearReconcileTimer(): void {
    if (reconcileTimer === null) return;
    scheduler.cancel(reconcileTimer);
    reconcileTimer = null;
  }

  function scheduleReconcile(): void {
    clearReconcileTimer();
    if (!active || disposed) return;
    reconcileTimer = scheduler.schedule(() => {
      reconcileTimer = null;
      if (active && pendingWrites.value === 0) void loadMatrixState();
    }, reconcileMs);
  }

  const matrixController = createAudioMatrixCommandController({
    read: (key) => Boolean(matrixOn.value[key]),
    apply: (key, value) => {
      matrixOn.value = { ...matrixOn.value, [key]: value };
    },
    captureCurrent: () => {
      const epoch = commandEpoch;
      return captureIdentityGuard(() => !disposed && active && epoch === commandEpoch);
    },
    execute: async (key, value) => {
      const [outChannel, inputChannel] = matrixCoordinates(key);
      const result = await service.setMatrix(outChannel, inputChannel, value);
      if (!result.ok) throw new Error(result.error || '设备未确认');
    },
    onStart: () => {
      pendingWrites.value += 1;
    },
    onError: (key, error) => {
      const [outChannel, inputChannel] = matrixCoordinates(key);
      messages.error(`路由 OUT${outChannel + 1}←IN${inputChannel + 1} 失败: ${(error as Error).message}`);
      void loadMatrixState();
    },
    onIdle: () => {
      pendingWrites.value = Math.max(0, pendingWrites.value - 1);
      scheduleReconcile();
    },
  });

  function toggleMatrix(outChannel: number, inputChannel: number): boolean {
    if (disposed || !active) return false;
    return matrixController.toggle(`${outChannel}_${inputChannel}`);
  }

  function clearPollTimer(): void {
    if (pollTimer === null) return;
    scheduler.cancel(pollTimer);
    pollTimer = null;
  }

  function scheduleMatrixPoll(): void {
    clearPollTimer();
    if (!active || disposed) return;
    pollTimer = scheduler.schedule(async () => {
      pollTimer = null;
      if (
        active
        && !isDocumentHidden()
        && pendingWrites.value === 0
        && reconcileTimer === null
      ) {
        await loadMatrixState();
      }
      scheduleMatrixPoll();
    }, pollMs);
  }

  function startMatrixPolling(): void {
    if (disposed || active) return;
    active = true;
    if (startedBefore) void loadMatrixState();
    startedBefore = true;
    scheduleMatrixPoll();
  }

  function stopMatrixControls(): void {
    commandEpoch += 1;
    beginRead();
    clearReconcileTimer();
  }

  function stopMatrixPolling(): void {
    active = false;
    clearPollTimer();
    stopMatrixControls();
  }

  const unsubscribeServer = onServerChange(() => {
    stopMatrixControls();
    matrixController.confirmSnapshot({});
    matrixOn.value = {};
    matrixStale.value = false;
    matrixOffline.value = false;
    matrixErrMsg.value = '';
  });

  const unsubscribeIdentity = onIdentityChange(() => {
    stopMatrixControls();
    if (active) void loadMatrixState();
  });

  onScopeDispose(() => {
    disposed = true;
    active = false;
    stopMatrixControls();
    clearPollTimer();
    unsubscribeServer();
    unsubscribeIdentity();
  });

  return {
    matrixOn,
    matrixStale,
    matrixOffline,
    matrixErrMsg,
    pendingWrites,
    loadMatrixState,
    isMatrixOn,
    toggleMatrix,
    startMatrixPolling,
    stopMatrixPolling,
    stopMatrixControls,
  };
}
