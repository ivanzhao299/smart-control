import {
  computed,
  onScopeDispose,
  ref,
  watch,
  type Directive,
  type Ref,
} from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { usePlaybackStore } from '@/stores/playback';
import {
  addToPlaylist,
  listHistory,
  listPlaylist,
  removeFromPlaylist,
  renamePlaylistItem,
  reorderPlaylist,
  setDisplayFit,
  type DisplayFit,
  type PlaybackHistoryView,
  type PlaylistItemView,
} from '@/services/playback.service';
import { mediaService } from '@/services/media.service';
import { createLatestIdentityRead } from '@/services/identity-boundary';
import type { PlaybackChannelView } from '@/types/api';

interface PlayerPlaylistOptions {
  slot: Readonly<Ref<1 | 2>>;
  title(): string;
  channel: Readonly<Ref<PlaybackChannelView | null | undefined>>;
  ensureAdmin(action: string): Promise<boolean>;
  captureAction(): () => boolean;
}

type PickerKind = 'video' | 'image' | 'webpage';
interface PickerAsset {
  id: number;
  originalName: string;
  kind: string;
}

/**
 * 播放器的列表与内容入口旅程。
 *
 * 列表、历史、播放控制、维护、媒体选择、直接上传和网页创建共享同一个通道与
 * 身份守卫，避免长请求返回后把旧通道结果写进当前界面。
 */
export function usePlayerPlaylist(options: PlayerPlaylistOptions) {
  const playbackStore = usePlaybackStore();
  const playlist = ref<PlaylistItemView[]>([]);
  const history = ref<PlaybackHistoryView[]>([]);
  const busy = ref(false);
  const mobTab = ref<'list' | 'his'>('list');
  const editingId = ref<number | null>(null);
  const editingText = ref('');
  const pickerOpen = ref(false);
  const pickerKind = ref<PickerKind>('video');
  const assets = ref<PickerAsset[]>([]);
  const pickerLoading = ref(false);
  const dragId = ref<number | null>(null);
  const dragOverId = ref<number | null>(null);
  const fileInput = ref<HTMLInputElement | null>(null);
  const uploading = ref(false);
  const uploadPct = ref(0);
  const webpageDialog = ref(false);
  const webpageForm = ref({ name: '', url: '' });

  let scopeDisposed = false;
  let reloadTimer: number | undefined;
  const beginListRead = createLatestIdentityRead(() => !scopeDisposed);
  const beginAssetRead = createLatestIdentityRead(() => !scopeDisposed && pickerOpen.value);

  const currentInList = computed(() =>
    playlist.value.find((item) => item.mediaId === options.channel.value?.currentMediaId) ?? null);
  const inPlaylist = computed(() => new Set(playlist.value.map((item) => item.mediaId)));

  async function loadAll(): Promise<void> {
    if (scopeDisposed) return;
    const currentRead = beginListRead();
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    try {
      const [nextPlaylist, nextHistory] = await Promise.all([
        listPlaylist(slot),
        listHistory(slot),
      ]);
      if (!currentRead() || !currentAction()) return;
      playlist.value = nextPlaylist;
      history.value = nextHistory;
    } catch (error) {
      if (!currentRead() || !currentAction()) return;
      playlist.value = [];
      history.value = [];
      ElMessage.error(`加载播放列表失败: ${(error as Error).message}`);
    }
  }

  watch(options.slot, () => {
    playlist.value = [];
    history.value = [];
    pickerOpen.value = false;
    editingId.value = null;
    editingText.value = '';
    dragId.value = null;
    dragOverId.value = null;
    webpageDialog.value = false;
    webpageForm.value = { name: '', url: '' };
    window.clearTimeout(reloadTimer);
    reloadTimer = undefined;
    void loadAll();
  }, { flush: 'sync' });

  watch(() => options.channel.value?.currentMediaId, () => {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => { void loadAll(); }, 800);
  });

  watch(pickerOpen, (open) => {
    if (open) return;
    beginAssetRead();
    assets.value = [];
    pickerLoading.value = false;
  }, { flush: 'sync' });

  async function playItem(item: PlaylistItemView): Promise<void> {
    if (item.missing) {
      ElMessage.warning('这个媒体已被删除, 先从列表移除');
      return;
    }
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    busy.value = true;
    try {
      // 默认单次、播完停尾帧 (2026-10); 不再硬编码循环。欢迎页/运营大屏走专用端点常驻 loop。
      await playbackStore.publish(slot, item.mediaId);
      if (!currentAction()) return;
      await loadAll();
      if (currentAction()) ElMessage.success(`正在播放「${item.title}」`);
    } catch (error) {
      if (currentAction()) ElMessage.error(`播放失败: ${(error as Error).message}`);
    } finally {
      busy.value = false;
    }
  }

  async function togglePause(): Promise<void> {
    const channel = options.channel.value;
    if (!channel?.currentMediaId) {
      if (playlist.value.length === 0) {
        ElMessage.warning('播放列表是空的, 先上传内容或从历史里加回来');
        return;
      }
      const lastId = history.value.find((item) => !item.missing)?.mediaId;
      const target = playlist.value.find((item) => item.mediaId === lastId && !item.missing)
        ?? playlist.value.find((item) => !item.missing);
      if (!target) {
        ElMessage.warning('列表里的媒体都已被删除');
        return;
      }
      await playItem(target);
      return;
    }
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    busy.value = true;
    try {
      if (channel.paused) await playbackStore.resume(slot);
      else await playbackStore.pause(slot);
    } catch (error) {
      if (currentAction()) ElMessage.error(`操作失败: ${(error as Error).message}`);
    } finally {
      busy.value = false;
    }
  }

  async function stopPlayback(expectedSession = options.channel.value?.playbackSession): Promise<void> {
    if (!expectedSession) {
      ElMessage.warning('请刷新播放状态后重试');
      return;
    }
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    busy.value = true;
    try {
      await playbackStore.stop(slot, expectedSession);
      if (currentAction()) ElMessage.success(`已终止, ${options.title()}回到待机`);
    } catch (error) {
      if (currentAction()) ElMessage.error(`终止失败: ${(error as Error).message}`);
    } finally {
      busy.value = false;
    }
  }

  async function changeFit(fit: DisplayFit): Promise<void> {
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    busy.value = true;
    try {
      await setDisplayFit(slot, fit);
      if (!currentAction()) return;
      await playbackStore.load();
      if (!currentAction()) return;
      const label = fit === 'fill' ? '铺满屏幕' : fit === 'contain' ? '保持比例' : '裁切铺满';
      ElMessage.success(`画面铺放已切为「${label}」`);
    } catch (error) {
      if (currentAction()) ElMessage.error(`切换铺放模式失败: ${(error as Error).message}`);
    } finally {
      busy.value = false;
    }
  }

  async function step(direction: 'next' | 'prev'): Promise<void> {
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    busy.value = true;
    try {
      await (direction === 'next' ? playbackStore.next(slot) : playbackStore.prev(slot));
      if (!currentAction()) return;
      await loadAll();
    } catch (error) {
      if (currentAction()) ElMessage.warning((error as Error).message);
    } finally {
      busy.value = false;
    }
  }

  const vFocus: Directive<HTMLInputElement> = {
    mounted(element) {
      element.focus();
      element.select();
    },
  };

  async function startRename(item: PlaylistItemView): Promise<void> {
    const currentAction = options.captureAction();
    if (!(await options.ensureAdmin('改名')) || !currentAction()) return;
    editingId.value = item.id;
    editingText.value = item.title;
  }

  async function commitRename(item: PlaylistItemView): Promise<void> {
    const title = editingText.value.trim();
    editingId.value = null;
    if (!title || title === item.title) return;
    const currentAction = options.captureAction();
    const before = item.title;
    item.title = title;
    try {
      await renamePlaylistItem(item.id, title);
      if (currentAction()) ElMessage.success('已改名 (只改列表显示名, 媒体库原文件不变)');
    } catch (error) {
      item.title = before;
      if (currentAction()) ElMessage.error(`改名失败: ${(error as Error).message}`);
    }
  }

  async function removeItem(item: PlaylistItemView): Promise<void> {
    const currentAction = options.captureAction();
    try {
      await ElMessageBox.confirm(
        `把「${item.title}」移出播放列表? (媒体库里的文件不会删)`,
        '移出播放列表',
        { type: 'warning' },
      );
    } catch { return; }
    if (!currentAction()) return;
    try {
      await removeFromPlaylist(item.id);
      if (!currentAction()) return;
      await loadAll();
      if (currentAction()) ElMessage.success('已移出播放列表');
    } catch (error) {
      if (currentAction()) ElMessage.error(`移出失败: ${(error as Error).message}`);
    }
  }

  async function addFromHistory(item: PlaybackHistoryView): Promise<void> {
    if (item.missing) {
      ElMessage.warning('这个媒体已被删除');
      return;
    }
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    try {
      await addToPlaylist(slot, item.mediaId);
      if (!currentAction()) return;
      await loadAll();
      if (currentAction()) ElMessage.success(`「${item.mediaName}」已加入播放列表`);
    } catch (error) {
      if (currentAction()) ElMessage.error(`加入失败: ${(error as Error).message}`);
    }
  }

  async function openPicker(): Promise<void> {
    pickerOpen.value = true;
    await loadAssets();
  }

  async function loadAssets(): Promise<void> {
    if (scopeDisposed || !pickerOpen.value) return;
    const currentRead = beginAssetRead();
    const currentAction = options.captureAction();
    const kind = pickerKind.value;
    pickerLoading.value = true;
    assets.value = [];
    try {
      const result = await mediaService.list({ kind });
      if (!currentRead() || !currentAction() || kind !== pickerKind.value) return;
      assets.value = result.items.map((item) => ({
        id: item.id,
        originalName: item.originalName,
        kind: item.kind,
      }));
    } catch (error) {
      if (currentRead() && currentAction()) {
        ElMessage.error(`读媒体库失败: ${(error as Error).message}`);
      }
    } finally {
      if (currentRead() && currentAction()) pickerLoading.value = false;
    }
  }

  async function pickAsset(asset: { id: number; originalName: string }): Promise<void> {
    if (!pickerOpen.value || pickerLoading.value
      || !assets.value.some((item) => item.id === asset.id)) return;
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    try {
      await addToPlaylist(slot, asset.id);
      if (!currentAction()) return;
      await loadAll();
      if (currentAction()) ElMessage.success(`「${asset.originalName}」已加入播放列表`);
    } catch (error) {
      if (currentAction()) ElMessage.error(`加入失败: ${(error as Error).message}`);
    }
  }

  function onDragStart(item: PlaylistItemView, event: DragEvent): void {
    dragId.value = item.id;
    event.dataTransfer?.setData('text/plain', String(item.id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(item: PlaylistItemView, event: DragEvent): void {
    if (dragId.value === null || dragId.value === item.id) return;
    event.preventDefault();
    dragOverId.value = item.id;
  }

  async function onDrop(target: PlaylistItemView): Promise<void> {
    const from = dragId.value;
    dragId.value = null;
    dragOverId.value = null;
    if (from === null || from === target.id) return;
    const list = playlist.value.slice();
    const fromIndex = list.findIndex((item) => item.id === from);
    const targetIndex = list.findIndex((item) => item.id === target.id);
    if (fromIndex < 0 || targetIndex < 0) return;
    if (new Set(list.map((item) => item.ownerUserId)).size > 1) {
      ElMessage.warning('当前包含共享及个人列表，不能混合排序');
      return;
    }
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    const [moved] = list.splice(fromIndex, 1);
    list.splice(targetIndex, 0, moved);
    const before = playlist.value;
    playlist.value = list;
    try {
      await reorderPlaylist(slot, list.map((item) => item.id));
    } catch (error) {
      if (!currentAction()) return;
      playlist.value = before;
      ElMessage.error(`排序保存失败: ${(error as Error).message}`);
    }
  }

  function onDragEnd(): void {
    dragId.value = null;
    dragOverId.value = null;
  }

  function pickFile(): void {
    fileInput.value?.click();
  }

  async function onFilePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    uploading.value = true;
    uploadPct.value = 0;
    try {
      let media: Awaited<ReturnType<typeof mediaService.upload>>;
      try {
        media = await mediaService.upload(file, {
          onProgress: (percent: number) => {
            if (currentAction()) uploadPct.value = percent;
          },
        });
      } catch (error) {
        if (currentAction()) ElMessage.error(`上传失败: ${(error as Error).message}`);
        return;
      }
      if (!currentAction()) return;
      try {
        await ElMessageBox.confirm(
          `「${media.originalName}」已上传到媒体库。要现在加入播放列表吗?`,
          '上传完成',
          { confirmButtonText: '加入播放列表', cancelButtonText: '只放媒体库', type: 'success' },
        );
      } catch {
        if (currentAction()) ElMessage.info('已保存到媒体库 (未加入播放列表)');
        return;
      }
      if (!currentAction()) return;
      try {
        await addToPlaylist(slot, media.id);
        if (!currentAction()) return;
        await loadAll();
        if (currentAction()) ElMessage.success('已加入播放列表');
      } catch (error) {
        if (currentAction()) {
          ElMessage.error(`文件已保存到媒体库，但加入播放列表失败: ${(error as Error).message}`);
        }
      }
    } finally {
      uploading.value = false;
    }
  }

  function openWebpageDialog(): void {
    webpageForm.value = { name: '', url: '' };
    webpageDialog.value = true;
  }

  async function submitWebpage(): Promise<void> {
    const url = webpageForm.value.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      ElMessage.warning('网址要以 http:// 或 https:// 开头');
      return;
    }
    const currentAction = options.captureAction();
    const slot = options.slot.value;
    try {
      const media = await mediaService.createWebpage(webpageForm.value.name.trim() || url, url);
      if (!currentAction()) return;
      await addToPlaylist(slot, media.id);
      if (!currentAction()) return;
      await loadAll();
      if (!currentAction()) return;
      webpageDialog.value = false;
      ElMessage.success(`「${media.originalName}」已加入播放列表`);
    } catch (error) {
      if (currentAction()) ElMessage.error(`添加失败: ${(error as Error).message}`);
    }
  }

  onScopeDispose(() => {
    scopeDisposed = true;
    window.clearTimeout(reloadTimer);
    reloadTimer = undefined;
    playlist.value = [];
    history.value = [];
    assets.value = [];
    pickerOpen.value = false;
    dragId.value = null;
    dragOverId.value = null;
  });

  return {
    playlist,
    history,
    busy,
    currentInList,
    mobTab,
    editingId,
    editingText,
    vFocus,
    pickerOpen,
    pickerKind,
    assets,
    pickerLoading,
    inPlaylist,
    dragId,
    dragOverId,
    fileInput,
    uploading,
    uploadPct,
    webpageDialog,
    webpageForm,
    loadAll,
    playItem,
    togglePause,
    stopPlayback,
    changeFit,
    step,
    startRename,
    commitRename,
    removeItem,
    addFromHistory,
    openPicker,
    loadAssets,
    pickAsset,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    pickFile,
    onFilePicked,
    openWebpageDialog,
    submitWebpage,
  };
}
