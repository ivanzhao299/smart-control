import { onScopeDispose, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { audioService } from '@/services/audio.service';
import {
  audioConfigService,
  type AudioInputSource,
} from '@/services/audio-config.service';
import {
  formatGainDb,
  gainDbToPercent,
  percentToGainDb,
} from '@/features/audio-view-model';
import { createLatestCommandQueue } from '@/features/latest-command-queue';
import {
  captureIdentityGuard,
  createLatestIdentityRead,
  onIdentityChange,
  onServerChange,
} from '@/services/identity-boundary';

export interface AudioInputRow {
  channel: number;
  name: string;
}

type AudioInputCatalogService = Pick<typeof audioConfigService, 'readInputs'>;
type AudioInputControlService = Pick<typeof audioService, 'getLiveInputs' | 'setInputVolume'>;

interface AudioInputMessages {
  error(message: string): void;
}

interface AudioInputsOptions {
  catalogService?: AudioInputCatalogService;
  controlService?: AudioInputControlService;
  messages?: AudioInputMessages;
}

interface InputGainCommand {
  value: number;
  isCurrent: () => boolean;
}

function toInputRows(rows: AudioInputSource[]): AudioInputRow[] {
  return rows.map((source) => ({ channel: source.channel, name: source.name }));
}

/**
 * 音频输入目录、设备真实增益与增益写入的唯一边界。
 *
 * 设备整表读取约需 4.6 秒，因此每种读取都采用“只有最新请求可提交”的规则。
 * 推子写入按通道串行并只保留最新值；身份、服务器或页面作用域改变后，旧请求既
 * 不能覆盖当前数据，也不能继续发送排队指令或显示过期错误。
 */
export function useAudioInputs(options: AudioInputsOptions = {}) {
  const {
    catalogService = audioConfigService,
    controlService = audioService,
    messages = ElMessage,
  } = options;

  const inputs = ref<AudioInputRow[]>([]);
  const inputGainDb = ref<Record<number, number | null>>({});
  const inputMuted = ref<Record<number, boolean | null>>({});
  const inputsLoading = ref(false);
  let disposed = false;
  let commandEpoch = 0;
  const channelRevisions = new Map<number, number>();
  const beginCatalogRead = createLatestIdentityRead(() => !disposed);
  const beginLiveRead = createLatestIdentityRead(() => !disposed);

  async function loadInputs(): Promise<boolean> {
    const isCurrent = beginCatalogRead();
    try {
      const rows = await catalogService.readInputs();
      if (!isCurrent()) return false;
      inputs.value = toInputRows(rows);
      return true;
    } catch {
      return false;
    }
  }

  async function loadInputChannels(): Promise<boolean> {
    const isCurrent = beginLiveRead();
    inputsLoading.value = true;
    try {
      const result = await controlService.getLiveInputs();
      if (!isCurrent()) return false;
      if (!result.ok || !result.data?.channels) {
        throw new Error(result.error || '读输入通道失败');
      }
      const gains: Record<number, number | null> = {};
      const muted: Record<number, boolean | null> = {};
      for (const channel of result.data.channels) {
        gains[channel.ch] = channel.gainDb;
        muted[channel.ch] = channel.muted;
      }
      inputGainDb.value = gains;
      inputMuted.value = muted;
      return true;
    } catch {
      return false;
    } finally {
      if (isCurrent()) inputsLoading.value = false;
    }
  }

  function inputGainOf(channel: number): number {
    const gainDb = inputGainDb.value[channel];
    return gainDb === null || gainDb === undefined ? 0 : gainDbToPercent(gainDb);
  }

  function inputGainLabel(channel: number): string {
    return formatGainDb(inputGainDb.value[channel]);
  }

  const inputGainQueue = createLatestCommandQueue<number, InputGainCommand>({
    execute: async (channel, command) => {
      if (!command.isCurrent()) return;
      try {
        const result = await controlService.setInputVolume(channel, command.value);
        if (!command.isCurrent()) return;
        if (!result.ok) throw new Error(result.error || '执行失败');
      } catch (error) {
        if (!command.isCurrent()) return;
        throw error;
      }
    },
    onError: (channel, error, command) => {
      if (!command.isCurrent()) return;
      messages.error(`IN${channel + 1} 增益设置失败: ${(error as Error).message}`);
    },
  });

  function onInputGain(channel: number, value: number): void {
    if (disposed) return;
    inputGainDb.value = { ...inputGainDb.value, [channel]: percentToGainDb(value) };
    const epoch = commandEpoch;
    const revision = (channelRevisions.get(channel) ?? 0) + 1;
    channelRevisions.set(channel, revision);
    const isCurrent = captureIdentityGuard(() => (
      !disposed
      && epoch === commandEpoch
      && channelRevisions.get(channel) === revision
    ));
    inputGainQueue.enqueue(channel, { value, isCurrent });
  }

  function stopInputCommands(): void {
    commandEpoch += 1;
    channelRevisions.clear();
  }

  function reloadInputs(): void {
    // 只重载输入源配置 (DB, 快); 真机增益 (inputs/live ~4.6s) 改为用户显式校准才读,
    // 不在登录/进页面时自动发起, 避免占着 DSP 串行命令把矩阵/其他操作拖慢
    void loadInputs();
  }

  const unsubscribeServer = onServerChange(() => {
    stopInputCommands();
    inputs.value = [];
    inputGainDb.value = {};
    inputMuted.value = {};
    inputsLoading.value = false;
  });

  const unsubscribeIdentity = onIdentityChange(() => {
    stopInputCommands();
    reloadInputs();
  });

  onScopeDispose(() => {
    disposed = true;
    stopInputCommands();
    unsubscribeServer();
    unsubscribeIdentity();
  });

  return {
    inputs,
    inputGainDb,
    inputMuted,
    inputsLoading,
    loadInputs,
    loadInputChannels,
    inputGainOf,
    inputGainLabel,
    onInputGain,
    stopInputCommands,
  };
}
