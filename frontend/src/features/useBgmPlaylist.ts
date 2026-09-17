import { computed, onActivated, onDeactivated, onScopeDispose, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { absUrl } from '@/services/http';
import { mediaService } from '@/services/media.service';
import { captureIdentityGuard, createLatestIdentityRead, onIdentityChange } from '@/services/identity-boundary';
import type { usePlaybackStore } from '@/stores/playback';
import { listPlaylist, addToPlaylist as apiAddToPlaylist, removeFromPlaylist as apiRemoveFromPlaylist,
  renamePlaylistItem as apiRenamePlaylistItem, setChannelPlayMode } from '@/services/playback.service';

export const BGM_SLOT = 3;

/** BGM playlist use cases are separate from the hardware audio matrix and faders. */
export function useBgmPlaylist(options: {
  playbackStore: ReturnType<typeof usePlaybackStore>;
  ensureAdmin: (what?: string) => Promise<boolean>;
}) {
  const { playbackStore, ensureAdmin } = options;
  let disposed = false;
  let active = true;
  const durationProbes = new Set<() => void>();
  const beginPlaylistRead = createLatestIdentityRead(() => !disposed);
  const beginAssetRead = createLatestIdentityRead(() => !disposed);
  let activationRevision = 0;
  const captureAction = () => {
    const revision = activationRevision;
    return captureIdentityGuard(() => !disposed && active && revision === activationRevision);
  };
  let clearing = false;
  let modeRevision = 0;
  // ============ 背景音乐 (slot 3 → GK9000 声卡 → EKX) ============
  const bgmChannel = computed(() => playbackStore.slotAudio);

  // ── 播放列表 ──
  interface PlItem {
    /** media 表主键 */
    id: number;
    /** playlist_item 表主键 (从后端来的才有; 选曲弹窗里的候选项没有) */
    itemId?: number;
    name: string;
    durationSec: number | null;
    /** 媒体已被删 —— 仍列出来让业主能删掉它, 不默默藏起来 */
    missing?: boolean;
  }
  /** BGM = slot3 (GK9000 声卡 -> EKX IN1 -> 各区), 跟 LED(1)/投影(2) 共用同一套播放后端 */
  const playlist = ref<PlItem[]>([]);
  const plIdx = ref(-1);
  type PlayMode = 'seq' | 'loop1' | 'loopAll' | 'shuffle';
  const playMode = ref<PlayMode>('loopAll');
  const plProgress = ref(0);
  const plPickerOpen = ref(false);
  const audioAssets = ref<PlItem[]>([]);

  /**
   * 播放列表持久化 —— **走后端, 不再用 localStorage**。
   *
   * 2026-07-17 业主: "要保持最后状态, 不要每次都丢状态"。
   * 真因: 这个列表原来存 localStorage(bgm_playlist_v2) —— 换设备/换浏览器/清缓存就没了,
   * 而且主控机、平板、手机**各有各的列表**, 互相看不见。跟灯光排序那个坑是同一个病:
   * 现场是多终端, 状态只存前端等于没存。
   * 现在落 playlist_item 表 (slot=3 就是 BGM), 跟 LED/投影仪共用同一套后端。
   */
  async function loadPlaylist(): Promise<void> {
    const isCurrent = beginPlaylistRead();
    try {
      const rows = await listPlaylist(BGM_SLOT);
      if (!isCurrent()) return;
      playlist.value = rows.map((r) => ({
        id: r.mediaId,
        itemId: r.id,                       // 后端主键 — 改名/删除要用
        name: r.title,                      // 业主起的别名, 空则是媒体原名
        durationSec: r.durationSec,
        missing: r.missing,
      }));
    } catch (e) {
      if (isCurrent()) ElMessage.error(`加载背景音乐列表失败: ${(e as Error).message}`);
    }
  }
  let plTimer: ReturnType<typeof setInterval> | null = null;
  let plTimerDuration = 0;     // total seconds of current track
  let plTimerElapsed = 0;      // seconds elapsed before current segment
  let plTimerSegStart = 0;     // Date.now() when current segment started

  async function loadAudioAssets(): Promise<void> {
    const isCurrent = beginAssetRead();
    try {
      const { items } = await mediaService.list({ kind: 'audio' });
      if (!isCurrent()) return;
      audioAssets.value = items.map((i) => ({ id: i.id, name: i.originalName, durationSec: i.durationSec }));
    } catch { /* silent */ }
  }

  /** 加进 BGM 播放列表 —— 落库, 不再只存本地 (换设备就没了) */
  async function addToPlaylist(item: PlItem): Promise<void> {
    const isCurrent = captureAction();
    if (!isCurrent()) return;
    try {
      await apiAddToPlaylist(BGM_SLOT, item.id);
      if (!isCurrent()) return;
      await loadPlaylist();
    } catch (e) {
      if (isCurrent()) ElMessage.error(`加入失败: ${(e as Error).message}`);
    }
  }
  async function removeFromPlaylist(i: number): Promise<void> {
    const it = playlist.value[i];
    if (!it) return;
    const isCurrent = captureAction();
    if (!isCurrent()) return;
    try {
      await ElMessageBox.confirm(
        `将「${it.name}」移出播放列表? 只移出列表, 不删除媒体库里的原文件。`,
        '移出确认',
        { confirmButtonText: '移出', cancelButtonText: '取消', type: 'warning' },
      );
    } catch { return; }
    if (!isCurrent()) return;
    if (!it.itemId) { playlist.value.splice(i, 1); return; }   // 没落过库的直接去掉
    try {
      await apiRemoveFromPlaylist(it.itemId);
      if (!isCurrent()) return;
      await loadPlaylist();
      if (!isCurrent()) return;
      if (plIdx.value >= playlist.value.length) plIdx.value = playlist.value.length - 1;
    } catch (e) {
      if (isCurrent()) ElMessage.error(`移除失败: ${(e as Error).message}`);
    }
  }

  /**
   * 改曲目显示名 —— 只改播放列表里的别名, **不动媒体库原文件**。
   * 业主: "在播放列表里面可以更改文件名字, 便于随时查找需要播放的素材"。
   */
  const plEditingId = ref<number | null>(null);
  const plEditingText = ref('');
  async function startRenamePl(it: PlItem): Promise<void> {
    const isCurrent = captureAction();
    if (!(await ensureAdmin('改名'))) return;
    if (!isCurrent()) return;
    if (!it.itemId) return;
    plEditingId.value = it.itemId;
    plEditingText.value = it.name;
  }
  async function commitRenamePl(it: PlItem): Promise<void> {
    const isCurrent = captureAction();
    if (!isCurrent()) return;
    const title = plEditingText.value.trim();
    plEditingId.value = null;
    if (!it.itemId || !title || title === it.name) return;
    const before = it.name;
    it.name = title;
    try {
      await apiRenamePlaylistItem(it.itemId, title);
      if (isCurrent()) ElMessage.success('已改名 (媒体库原文件不变)');
    } catch (e) {
      if (!isCurrent()) return;
      it.name = before;
      ElMessage.error(`改名失败: ${(e as Error).message}`);
    }
  }
  async function clearPlaylist(): Promise<void> {
    const isCurrent = captureAction();
    const sameIdentity = captureIdentityGuard(() => !disposed);
    if (clearing || !isCurrent()) return;
    clearing = true;
    const items = playlist.value.slice();
    try {
      // Do not erase the controls while sound may still be playing after a failed stop.
      if (bgmChannel.value?.currentMediaId) await playbackStore.stop(BGM_SLOT);
      if (!isCurrent()) return;
      stopPlTimer();
      plProgress.value = 0;
      plIdx.value = -1;
      for (const item of items) {
        if (!isCurrent()) return;
        if (item.itemId) await apiRemoveFromPlaylist(item.itemId);
        if (!isCurrent()) return;
        // Keep unconfirmed rows if a later delete fails; never pretend all succeeded.
        playlist.value = playlist.value.filter(row => row !== item);
      }
    } catch (e) {
      if (isCurrent()) ElMessage.error(`清空未完成，未删除的曲目已保留: ${(e as Error).message}`);
    } finally {
      if (sameIdentity()) clearing = false;
    }
  }
  function stopPlTimer(): void {
    if (plTimer !== null) { clearInterval(plTimer); plTimer = null; }
  }
  function pausePlTimer(): void {
    if (plTimer !== null) {
      plTimerElapsed += (Date.now() - plTimerSegStart) / 1000;
      clearInterval(plTimer);
      plTimer = null;
    }
  }
  function resumePlTimer(): void {
    if (disposed || !active || plTimer !== null || !plTimerDuration) return;
    plTimerSegStart = Date.now();
    plTimer = setInterval(() => {
      const elapsed = plTimerElapsed + (Date.now() - plTimerSegStart) / 1000;
      plProgress.value = Math.min(100, (elapsed / plTimerDuration) * 100);
      // 到点只停 + 进度拉满; 切下一首/循环由后端 bgm-player advance 触发, 前端不再
      // 自驱切歌 (进度条纯视觉估算)。后端换曲后 WS 广播 → watch(currentMediaId) 重启进度。
      if (elapsed >= plTimerDuration) { stopPlTimer(); plProgress.value = 100; }
    }, 300);
  }
  function startPlTimer(dur: number | null): void {
    stopPlTimer();
    plProgress.value = 0;
    plTimerElapsed = 0;
    plTimerDuration = dur && dur > 0 ? dur : 0;
    resumePlTimer();
  }

  /**
   * 2026-07-18 业主反馈: "播放进度条不稳定"。根因之一: 部分 mp3 是 VBR 编码,
   * Chrome 读 loadedmetadata 那一刻经常给出 duration=Infinity (要扫完整个文件
   * 才知道真实时长, 浏览器不会现扫), 原来的代码遇到这种情况直接判定"探测失败"
   * 返回 null——那首歌的 plTimerDuration 就成了 0, 进度条压根不走; 换一首没有
   * 这个问题的曲子进度条又正常, 看起来就是"时好时不好"。
   * 标准 workaround: seek 到一个远超正常时长的位置, 逼浏览器把文件扫完并触发
   * durationchange 给出真实值。
   */
  async function detectDuration(mediaId: number): Promise<number | null> {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      let settled = false;
      const cancel = () => finish(null);
      const timer = setTimeout(() => finish(null), 6000);
      durationProbes.add(cancel);
      function finish(d: number | null): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        durationProbes.delete(cancel);
        audio.removeEventListener('loadedmetadata', onMetadata);
        audio.removeEventListener('durationchange', tryResolve);
        audio.removeEventListener('error', cancel);
        audio.src = '';
        resolve(d);
      }
      function tryResolve(): boolean {
        const d = audio.duration;
        if (isFinite(d) && d > 0) { finish(d); return true; }
        return false;
      }
      function onMetadata(): void {
        if (tryResolve()) return;
        // duration 是 Infinity/NaN (常见于 VBR mp3) —— 等 durationchange, 同时
        // seek 到远处强制浏览器扫完整个文件算出真实时长
        audio.addEventListener('durationchange', tryResolve, { once: true });
        try { audio.currentTime = 1e7; } catch { /* 极少数浏览器直接拒绝这么大的 seek, 忽略, 等超时兜底 */ }
      }
      audio.addEventListener('loadedmetadata', onMetadata, { once: true });
      audio.addEventListener('error', cancel, { once: true });
      // File endpoints require access grants; a bare Audio URL cannot carry bearer headers.
      void mediaService.access(mediaId).then(({ url }) => {
        if (!settled) audio.src = absUrl(url);
      }).catch(cancel);
    });
  }

  /**
   * 行点击 = 播放该曲目, 但这一行正在改名时不能触发——不然点名字进编辑态、
   * 或者双击名字确认改名的过程中, 冒泡上来的 click 会先把 playAt 打了一遍,
   * 版本早的时候名字上只有 dblclick.stop, 单击 (双击的前半段) 照样冒泡到这里,
   * 改着改着歌就换了, 改名输入框也跟着被换掉的那次渲染打断, 状态卡住看着像
   * "没保存也退不出编辑"。名字文字本身现在也加了 click.stop, 这里再兜底一层。
   */
  function onPlRowClick(i: number, item: PlItem): void {
    if (plEditingId.value === item.itemId) return;
    void playAt(i);
  }
  async function playAt(i: number): Promise<void> {
    if (playlist.value.length === 0 || i < 0) return;
    const idx = ((i % playlist.value.length) + playlist.value.length) % playlist.value.length;
    const item = playlist.value[idx];
    try {
      // 只"发起播放": 推给后端 → 后端置 currentMediaId → WS 广播 → watch(currentMediaId)
      // 统一更新高亮和进度条。前端不再自己维护一套播放状态 (前端一套 + 后端一套互相
      // 打架, 正是这个背景音乐反复没声的病根)。loopMode 传 'loop' 只是让单曲能先响;
      // 真正的"下一首/循环/随机"由后端按 playMode 在 bgm-player advance 时决定。
      await playbackStore.publish(3, item.id, 'loop');
    } catch (e) { ElMessage.error(`播放失败: ${(e as Error).message}`); }
  }
  /**
   * 前端"跟随"后端 —— 当前在播哪首完全由后端说了算 (用户点歌 / bgm-player 按 playMode
   * 自动推进, 都会改后端 currentMediaId → WS 广播 → 这里)。前端只负责把高亮和进度条
   * 对上, 不再自己算"下一首"。原来那套前端 nextIdx/onTrackEnd 自驱推进跟后端打架,
   * 是背景音乐反复没声的根源, 已删。
   */
  async function syncPlaybackFromChannel(mid: number | null | undefined): Promise<void> {
    if (disposed || !active) return;
    const isCurrent = captureAction();
    if (!mid) { plIdx.value = -1; stopPlTimer(); plProgress.value = 0; return; }
    const i = playlist.value.findIndex((p) => p.id === mid);
    plIdx.value = i; // i=-1 = 当前曲不在列表 (从媒体库临时推的), 正常
    let dur: number | null = i >= 0 ? playlist.value[i].durationSec : null;
    if (!dur) {
      dur = await detectDuration(mid);
      // 审计 P2 竞态: detectDuration 最长 6s, 期间可能已切歌 — 旧实例的结果作废,
      // 否则会拿上一首的时长起进度条/写错列表
      if (!isCurrent() || bgmChannel.value?.currentMediaId !== mid) return;
      const currentItem = playlist.value.find((item) => item.id === mid);
      if (dur && currentItem) currentItem.durationSec = dur;
    }
    // 暂停态不跑进度条 (等 resume), 否则从头估算
    if (bgmChannel.value?.paused) stopPlTimer(); else startPlTimer(dur);
  }
  watch(() => bgmChannel.value?.currentMediaId, (mid) => { void syncPlaybackFromChannel(mid); });
  // 播放模式以后端为准 (多终端一致): 后端推来就同步本地高亮
  watch(() => bgmChannel.value?.playMode, (m) => { if (m) playMode.value = m; }, { immediate: true });
  async function plTogglePause(): Promise<void> {
    const isCurrent = captureAction();
    if (!isCurrent()) return;
    if (!bgmChannel.value?.currentMediaId) {
      // not playing at all — start
      if (playlist.value.length > 0) await playAt(plIdx.value >= 0 ? plIdx.value : 0);
      return;
    }
    try {
      if (bgmChannel.value.paused) {
        await playbackStore.resume(BGM_SLOT);
        if (isCurrent()) resumePlTimer();
      } else {
        await playbackStore.pause(BGM_SLOT);
        if (isCurrent()) pausePlTimer();
      }
    } catch (e) {
      if (isCurrent()) ElMessage.error(`播放控制失败: ${(e as Error).message}`);
    }
  }
  async function plPrev(): Promise<void> {
    if (playlist.value.length === 0) return;
    // 交给后端环形切换 (后端以当前在播 mediaId 定位, 不信前端 index) → WS → watch 同步
    try { await playbackStore.prev(3); } catch (e) { ElMessage.error(`上一首失败: ${(e as Error).message}`); }
  }
  async function plNext(): Promise<void> {
    if (playlist.value.length === 0) return;
    try { await playbackStore.next(3); } catch (e) { ElMessage.error(`下一首失败: ${(e as Error).message}`); }
  }
  /** 点播放模式按钮 → 存后端 (bgm-player advance 时读它决定下一首); 乐观更新, 失败回滚 */
  async function setPlayModeAndSave(mode: PlayMode): Promise<void> {
    const isCurrent = captureAction();
    if (!isCurrent()) return;
    const revision = ++modeRevision;
    const prev = playMode.value;
    playMode.value = mode;
    try { await setChannelPlayMode(3, mode); }
    catch (e) {
      if (!isCurrent() || revision !== modeRevision) return;
      playMode.value = prev;
      ElMessage.error(`设置播放模式失败: ${(e as Error).message}`);
    }
  }
  function fmtDuration(sec: number | null): string {
    if (!sec || sec <= 0) return '';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  const plCurrentItem = computed<PlItem | null>(() =>
    plIdx.value >= 0 && plIdx.value < playlist.value.length ? playlist.value[plIdx.value] : null,
  );

  async function stopBgm(): Promise<void> {
    const isCurrent = captureAction();
    if (!isCurrent()) return;
    try {
      await playbackStore.stop(3);
      if (!isCurrent()) return;
      stopPlTimer();
      plProgress.value = 0;
      plTimerElapsed = 0;
      ElMessage.success('已停止背景音乐');
    } catch (e) {
      if (isCurrent()) ElMessage.error(`停止失败: ${(e as Error).message}`);
    }
  }

  function stopVisualWork(): void {
    stopPlTimer();
    for (const cancel of durationProbes) cancel();
  }
  const unsubscribe = onIdentityChange(() => {
    stopVisualWork();
    playlist.value = [];
    audioAssets.value = [];
    plIdx.value = -1;
    plProgress.value = 0;
    plEditingId.value = null;
    plEditingText.value = '';
    plPickerOpen.value = false;
    clearing = false;
    playMode.value = 'loopAll';
  });
  onActivated(() => { active = true; });
  onDeactivated(() => { active = false; activationRevision++; stopVisualWork(); });
  onScopeDispose(() => { disposed = true; stopVisualWork(); unsubscribe(); });
  return { bgmChannel, playlist, plIdx, playMode, plProgress, plPickerOpen, audioAssets, loadPlaylist, loadAudioAssets, stopPlTimer, syncPlaybackFromChannel, plCurrentItem, stopBgm, playAt, plTogglePause, plPrev, plNext, setPlayModeAndSave, fmtDuration, plEditingId, plEditingText, onPlRowClick, startRenamePl, commitRenamePl, clearPlaylist, addToPlaylist, removeFromPlaylist };
}
