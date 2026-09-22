import { computed, onScopeDispose, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  audioConfigService,
  type AudioOutputZone,
} from '@/services/audio-config.service';
import {
  audioChannelDisplayAddress,
  audioChannelDisplayName,
  buildStereoPartnerIds,
  filterVisibleAudioChannels,
  findStereoPartner,
  isStereoLeftChannel,
  stereoChannelRows,
  stereoLeftChannelId,
} from '@/features/audio-view-model';
import {
  captureIdentityGuard,
  createLatestIdentityRead,
  onIdentityChange,
  onServerChange,
} from '@/services/identity-boundary';

export interface AudioOutputRow {
  dbId: number;
  id: string;
  name: string;
  zone: string;
  channel: number;
  volume: number;
  muted: boolean;
  bgm: string;
  bgmPlaying: boolean;
  mic: boolean;
  busy: boolean;
  error: string | null;
}

type AudioOutputCatalogService = Pick<typeof audioConfigService, 'listZones' | 'updateZone'>;

interface AudioOutputCatalogMessages {
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

interface AudioOutputCatalogOptions {
  ensureAdmin: (action: string) => Promise<boolean>;
  service?: AudioOutputCatalogService;
  messages?: AudioOutputCatalogMessages;
}

interface CatalogOperation {
  revision: number;
  isCurrent: () => boolean;
}

function toOutputRow(zone: AudioOutputZone): AudioOutputRow {
  return {
    dbId: zone.id,
    id: `audio_out${zone.channel + 1}`,
    name: zone.name,
    zone: `out${zone.channel + 1}`,
    channel: zone.channel,
    volume: 50,
    muted: false,
    bgm: '',
    bgmPlaying: false,
    mic: false,
    busy: false,
    error: null,
  };
}

function applyCatalogZone(row: AudioOutputRow, zone: AudioOutputZone): AudioOutputRow {
  row.dbId = zone.id;
  row.id = `audio_out${zone.channel + 1}`;
  row.name = zone.name;
  row.zone = `out${zone.channel + 1}`;
  row.channel = zone.channel;
  return row;
}

/**
 * 音频输出目录、立体声投影与目录改名的唯一边界。
 *
 * 左右声道改名仍复用既有两个配置接口，但会同时发出并逐项核对结果。发生部分成功时
 * 不做虚假整体回滚，而是重新读取服务端名称；身份或页面作用域变化后，旧响应不能再
 * 覆盖当前目录或显示过期提示。
 */
export function useAudioOutputCatalog(options: AudioOutputCatalogOptions) {
  const {
    ensureAdmin,
    service = audioConfigService,
    messages = ElMessage,
  } = options;

  const channels = ref<AudioOutputRow[]>([]);
  const stereoLink = ref<Record<string, boolean>>({});
  const editingChannelId = ref<number | null>(null);
  const editingChannelText = ref('');
  const catalogBusy = ref(false);
  let disposed = false;
  let operationRevision = 0;
  let activeRollback: (() => void) | null = null;

  const beginRead = createLatestIdentityRead(() => !disposed);
  const partnerIds = computed<Record<string, string>>(() => buildStereoPartnerIds(channels.value));
  const displayChannels = computed(() => filterVisibleAudioChannels(channels.value, partnerIds.value));

  function partnerOf(row: AudioOutputRow): AudioOutputRow | undefined {
    return findStereoPartner(channels.value, partnerIds.value, row);
  }

  function displayName(row: AudioOutputRow): string {
    return audioChannelDisplayName(row, partnerIds.value);
  }

  function isStereo(row: AudioOutputRow): boolean {
    return isStereoLeftChannel(row, partnerIds.value);
  }

  function displayAddress(row: AudioOutputRow): string {
    return audioChannelDisplayAddress(row, channels.value, partnerIds.value);
  }

  function stereoRows(row: AudioOutputRow): AudioOutputRow[] {
    return stereoChannelRows(row, channels.value, partnerIds.value);
  }

  function pairLeftId(row: AudioOutputRow): string | null {
    return stereoLeftChannelId(row, partnerIds.value);
  }

  function linkOn(row: AudioOutputRow): boolean {
    const key = pairLeftId(row);
    return key ? (stereoLink.value[key] ?? true) : false;
  }

  function setLink(row: AudioOutputRow, value: boolean): void {
    const key = pairLeftId(row);
    if (key) stereoLink.value = { ...stereoLink.value, [key]: value };
  }

  async function loadOutputChannels(): Promise<boolean> {
    const isCurrent = beginRead();
    try {
      const rows = await service.listZones();
      if (!isCurrent()) return false;
      const previousByOutput = new Map(channels.value.map((row) => [row.id, row]));
      channels.value = rows.map((zone) => {
        const outputId = `audio_out${zone.channel + 1}`;
        const previous = previousByOutput.get(outputId);
        return previous ? applyCatalogZone(previous, zone) : toOutputRow(zone);
      });
      return true;
    } catch {
      return false;
    }
  }

  function clearEditing(): void {
    editingChannelId.value = null;
    editingChannelText.value = '';
  }

  function rollbackActive(): void {
    const rollback = activeRollback;
    activeRollback = null;
    rollback?.();
  }

  function stopCatalogActions(): void {
    rollbackActive();
    operationRevision += 1;
    catalogBusy.value = false;
    clearEditing();
  }

  function beginOperation(): CatalogOperation | null {
    if (catalogBusy.value || disposed) return null;
    const revision = ++operationRevision;
    const isCurrent = captureIdentityGuard(() => !disposed && revision === operationRevision);
    catalogBusy.value = true;
    return { revision, isCurrent };
  }

  function finishOperation(operation: CatalogOperation): void {
    if (disposed || operation.revision !== operationRevision) return;
    activeRollback = null;
    catalogBusy.value = false;
  }

  async function refreshAuthoritativeNames(operation: CatalogOperation): Promise<boolean> {
    try {
      const rows = await service.listZones();
      if (!operation.isCurrent()) return false;
      const names = new Map(rows.map((row) => [row.id, row.name]));
      for (const channel of channels.value) {
        const name = names.get(channel.dbId);
        if (name !== undefined) channel.name = name;
      }
      return true;
    } catch {
      return false;
    }
  }

  async function startRenameChannel(row: AudioOutputRow): Promise<boolean> {
    if (catalogBusy.value || disposed) return false;
    const isCurrent = captureIdentityGuard(() => !disposed && !catalogBusy.value);
    if (!(await ensureAdmin('通道改名')) || !isCurrent()) return false;
    const current = channels.value.find((candidate) => candidate.dbId === row.dbId);
    if (!current) return false;
    editingChannelId.value = current.dbId;
    editingChannelText.value = isStereo(current) ? current.name.slice(0, -2) : current.name;
    return true;
  }

  function cancelRenameChannel(): void {
    clearEditing();
  }

  async function commitRenameChannel(row: AudioOutputRow): Promise<boolean> {
    if (editingChannelId.value !== row.dbId) return false;
    const raw = editingChannelText.value.trim();
    clearEditing();
    const current = channels.value.find((candidate) => candidate.dbId === row.dbId);
    if (!current || !raw) return false;

    const partner = partnerOf(current);
    const pair = partner && current.name.endsWith('·左') ? partner : undefined;
    const base = pair ? raw.replace(/·[左右]$/u, '').trim() : raw;
    if (!base) return false;
    const targets = pair
      ? [
          { id: current.dbId, name: `${base}·左` },
          { id: pair.dbId, name: `${base}·右` },
        ]
      : [{ id: current.dbId, name: base }];
    const changes = targets.filter((target) =>
      channels.value.find((candidate) => candidate.dbId === target.id)?.name !== target.name);
    if (!changes.length) return false;

    const operation = beginOperation();
    if (!operation) return false;
    const previous = changes.map((target) => ({
      id: target.id,
      name: channels.value.find((candidate) => candidate.dbId === target.id)?.name ?? '',
    }));
    for (const target of changes) {
      const candidate = channels.value.find((entry) => entry.dbId === target.id);
      if (candidate) candidate.name = target.name;
    }
    activeRollback = () => {
      for (const snapshot of previous) {
        const candidate = channels.value.find((entry) => entry.dbId === snapshot.id);
        const target = changes.find((entry) => entry.id === snapshot.id);
        if (candidate && target && candidate.name === target.name) candidate.name = snapshot.name;
      }
    };

    try {
      const results = await Promise.allSettled(
        changes.map((target) => service.updateZone(target.id, { name: target.name })),
      );
      if (!operation.isCurrent()) return false;
      const successes = results.filter((result) => result.status === 'fulfilled').length;
      if (successes === results.length) {
        activeRollback = null;
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const candidate = channels.value.find((entry) => entry.dbId === result.value.id);
          if (candidate) candidate.name = result.value.name;
        }
        messages.success(pair ? `已改名为「${base}」(左/右两路已同步)` : `已改名为「${base}」`);
        return true;
      }
      if (successes === 0) {
        rollbackActive();
        const failure = results.find((result) => result.status === 'rejected');
        const reason = failure?.status === 'rejected' ? failure.reason : new Error('保存失败');
        const detail = reason instanceof Error ? reason.message : String(reason);
        messages.error(`改名失败: ${detail}`);
        return false;
      }

      activeRollback = null;
      for (let index = 0; index < results.length; index += 1) {
        if (results[index].status === 'fulfilled') continue;
        const snapshot = previous.find((entry) => entry.id === changes[index].id);
        const candidate = channels.value.find((entry) => entry.dbId === changes[index].id);
        if (snapshot && candidate) candidate.name = snapshot.name;
      }
      const refreshed = await refreshAuthoritativeNames(operation);
      if (!operation.isCurrent()) return false;
      messages.warning(refreshed
        ? '部分通道改名已提交，已按服务端结果刷新'
        : '部分通道改名已提交，但目录回读失败，请刷新页面确认');
      return false;
    } finally {
      finishOperation(operation);
    }
  }

  const unsubscribeServer = onServerChange(() => {
    stopCatalogActions();
    channels.value = [];
    stereoLink.value = {};
  });

  const unsubscribeIdentity = onIdentityChange(() => {
    stopCatalogActions();
    void loadOutputChannels();
  });

  onScopeDispose(() => {
    disposed = true;
    stopCatalogActions();
    unsubscribeServer();
    unsubscribeIdentity();
  });

  return {
    channels,
    displayChannels,
    editingChannelId,
    editingChannelText,
    catalogBusy,
    partnerOf,
    displayName,
    isStereo,
    displayAddress,
    stereoRows,
    linkOn,
    setLink,
    loadOutputChannels,
    startRenameChannel,
    cancelRenameChannel,
    commitRenameChannel,
    stopCatalogActions,
  };
}
