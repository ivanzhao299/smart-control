<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter, useRoute } from 'vue-router';
import {
  ArrowLeft, Speaker, Volume2, VolumeX, Play, Sparkles, Music, Square, Pause,
  SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Trash2, Pencil } from 'lucide-vue-next';
import { audioService } from '@/services/audio.service';
import { audioConfigService } from '@/services/audio-config.service';
import { absUrl } from '@/services/http';
import { usePlaybackStore } from '@/stores/playback';
import {
  listPlaylist,
  addToPlaylist as apiAddToPlaylist,
  removeFromPlaylist as apiRemoveFromPlaylist,
  renamePlaylistItem as apiRenamePlaylistItem,
  setChannelPlayMode,
} from '@/services/playback.service';
import { mediaService } from '@/services/media.service';

const router = useRouter();
const route = useRoute();
const playbackStore = usePlaybackStore();

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
const BGM_SLOT = 3;
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
  try {
    const rows = await listPlaylist(BGM_SLOT);
    playlist.value = rows.map((r) => ({
      id: r.mediaId,
      itemId: r.id,                       // 后端主键 — 改名/删除要用
      name: r.title,                      // 业主起的别名, 空则是媒体原名
      durationSec: r.durationSec,
      missing: r.missing,
    }));
  } catch (e) {
    ElMessage.error(`加载背景音乐列表失败: ${(e as Error).message}`);
  }
}
let plTimer: ReturnType<typeof setInterval> | null = null;
let plTimerDuration = 0;     // total seconds of current track
let plTimerElapsed = 0;      // seconds elapsed before current segment
let plTimerSegStart = 0;     // Date.now() when current segment started

async function loadAudioAssets(): Promise<void> {
  try {
    const { items } = await mediaService.list({ kind: 'audio' });
    audioAssets.value = items.map((i) => ({ id: i.id, name: i.originalName, durationSec: i.durationSec }));
  } catch { /* silent */ }
}

/**
 * 从**设备**读真实路由表.
 *
 * 以前这里读的是 GET /audio/matrix/state —— 后端一个本地 JSON 文件, 记的是
 * "谁点过哪个交叉点", 不是设备状态。而且下发失败时前端照样存进去, 界面就会
 * 亮着一个从没接通过的交叉点。现在直接问设备 (一条命令, ~284ms)。
 *
 * 读不到时**保持上次的值并标记 matrixStale**, 不要清空 —— 清空会让界面看起来
 * "全部断开", 那同样是假的。
 */
const matrixStale = ref(false);
/** 矩阵设备离线(EKX-808 连不上) —— 跟"偶发读失败"分开, 单独给一条醒目提示 */
const matrixOffline = ref(false);
const matrixErrMsg = ref('');
async function loadMatrixState(): Promise<void> {
  try {
    const r = await audioService.getLiveMatrix();
    if (!r.ok || !r.data?.matrix) throw new Error(r.error || '读矩阵失败');
    const next: Record<string, boolean> = {};
    r.data.matrix.forEach((row, out) => {
      row.forEach((on, inCh) => { next[`${out}_${inCh}`] = on; });
    });
    matrixOn.value = next;
    matrixStale.value = false;
    matrixOffline.value = false;
    matrixErrMsg.value = '';
  } catch (e) {
    matrixStale.value = true;
    const msg = (e as Error).message || '';
    matrixErrMsg.value = msg;
    // 后端离线快速失败会带"离线/连不上"; 超时类也归为离线
    matrixOffline.value = /离线|连不上|offline|timed?\s*out|timeout/i.test(msg);
  }
}
/** 加进 BGM 播放列表 —— 落库, 不再只存本地 (换设备就没了) */
async function addToPlaylist(item: PlItem): Promise<void> {
  try {
    await apiAddToPlaylist(BGM_SLOT, item.id);
    await loadPlaylist();
  } catch (e) {
    ElMessage.error(`加入失败: ${(e as Error).message}`);
  }
}
async function removeFromPlaylist(i: number): Promise<void> {
  const it = playlist.value[i];
  if (!it?.itemId) { playlist.value.splice(i, 1); return; }   // 没落过库的直接去掉
  try {
    await apiRemoveFromPlaylist(it.itemId);
    await loadPlaylist();
    if (plIdx.value >= playlist.value.length) plIdx.value = playlist.value.length - 1;
  } catch (e) {
    ElMessage.error(`移除失败: ${(e as Error).message}`);
  }
}

/**
 * 改曲目显示名 —— 只改播放列表里的别名, **不动媒体库原文件**。
 * 业主: "在播放列表里面可以更改文件名字, 便于随时查找需要播放的素材"。
 */
const plEditingId = ref<number | null>(null);
const plEditingText = ref('');
function startRenamePl(it: PlItem): void {
  if (!it.itemId) return;
  plEditingId.value = it.itemId;
  plEditingText.value = it.name;
}
async function commitRenamePl(it: PlItem): Promise<void> {
  const title = plEditingText.value.trim();
  plEditingId.value = null;
  if (!it.itemId || !title || title === it.name) return;
  const before = it.name;
  it.name = title;
  try {
    await apiRenamePlaylistItem(it.itemId, title);
    ElMessage.success('已改名 (媒体库原文件不变)');
  } catch (e) {
    it.name = before;
    ElMessage.error(`改名失败: ${(e as Error).message}`);
  }
}
async function clearPlaylist(): Promise<void> {
  stopPlTimer();
  // 逐条删 —— 后端没有"清空"接口, 而且逐条删有审计价值
  for (const it of playlist.value.slice()) {
    if (it.itemId) await apiRemoveFromPlaylist(it.itemId).catch(() => {});
  }
  playlist.value = [];
  plIdx.value = -1;
  plProgress.value = 0;
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
  if (plTimer !== null || !plTimerDuration) return;
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
  if (!plTimerDuration) return;
  plTimerSegStart = Date.now();
  plTimer = setInterval(() => {
    const elapsed = plTimerElapsed + (Date.now() - plTimerSegStart) / 1000;
    plProgress.value = Math.min(100, (elapsed / plTimerDuration) * 100);
    // 到点只停 + 进度拉满; 切下一首/循环由后端 bgm-player advance 触发, 前端不再
    // 自驱切歌 (进度条纯视觉估算)。后端换曲后 WS 广播 → watch(currentMediaId) 重启进度。
    if (elapsed >= plTimerDuration) { stopPlTimer(); plProgress.value = 100; }
  }, 300);
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
    const timer = setTimeout(() => finish(null), 6000);
    function finish(d: number | null): void {
      clearTimeout(timer);
      audio.src = '';
      resolve(d);
    }
    function tryResolve(): boolean {
      const d = audio.duration;
      if (isFinite(d) && d > 0) { finish(d); return true; }
      return false;
    }
    audio.addEventListener('loadedmetadata', () => {
      if (tryResolve()) return;
      // duration 是 Infinity/NaN (常见于 VBR mp3) —— 等 durationchange, 同时
      // seek 到远处强制浏览器扫完整个文件算出真实时长
      audio.addEventListener('durationchange', tryResolve, { once: true });
      try { audio.currentTime = 1e7; } catch { /* 极少数浏览器直接拒绝这么大的 seek, 忽略, 等超时兜底 */ }
    }, { once: true });
    audio.addEventListener('error', () => finish(null), { once: true });
    audio.src = absUrl(`/api/media/${mediaId}/file`);
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
  if (!mid) { plIdx.value = -1; stopPlTimer(); plProgress.value = 0; return; }
  const i = playlist.value.findIndex((p) => p.id === mid);
  plIdx.value = i; // i=-1 = 当前曲不在列表 (从媒体库临时推的), 正常
  let dur: number | null = i >= 0 ? playlist.value[i].durationSec : null;
  if (!dur) {
    dur = await detectDuration(mid);
    if (dur && i >= 0) playlist.value[i].durationSec = dur;
  }
  // 暂停态不跑进度条 (等 resume), 否则从头估算
  if (bgmChannel.value?.paused) stopPlTimer(); else startPlTimer(dur);
}
watch(() => bgmChannel.value?.currentMediaId, (mid) => { void syncPlaybackFromChannel(mid); });
// 播放模式以后端为准 (多终端一致): 后端推来就同步本地高亮
watch(() => bgmChannel.value?.playMode, (m) => { if (m) playMode.value = m; }, { immediate: true });
async function plTogglePause(): Promise<void> {
  if (!bgmChannel.value?.currentMediaId) {
    // not playing at all — start
    if (playlist.value.length > 0) await playAt(plIdx.value >= 0 ? plIdx.value : 0);
    return;
  }
  if (bgmChannel.value.paused) {
    await playbackStore.resume(3);
    resumePlTimer();
  } else {
    await playbackStore.pause(3);
    pausePlTimer();
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
  const prev = playMode.value;
  playMode.value = mode;
  try { await setChannelPlayMode(3, mode); }
  catch (e) { playMode.value = prev; ElMessage.error(`设置播放模式失败: ${(e as Error).message}`); }
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
  stopPlTimer();
  plProgress.value = 0;
  plTimerElapsed = 0;
  try {
    await playbackStore.stop(3);
    ElMessage.success('已停止背景音乐');
  } catch (e) {
    ElMessage.error(`停止失败: ${(e as Error).message}`);
  }
}

// ============ EKX-808 一键场景 ============
// 场景从后台配置拉 (业主可自定义名字), id = EKX 预设号 1-12
interface Scene { id: number; name: string; hint: string; }
const SCENES = ref<Scene[]>([]);
const currentScene = ref<number | null>(null);

async function loadScenes(): Promise<void> {
  try {
    const rows = await audioConfigService.listScenes();
    SCENES.value = rows.map((s) => ({ id: s.presetNum, name: s.name, hint: s.hint ?? '' }));
  } catch { /* 拉不到就空, 不挡页面 */ }
}
const sceneBusy = ref(false);

async function recallScene(s: Scene): Promise<void> {
  sceneBusy.value = true;
  const prev = currentScene.value;
  currentScene.value = s.id;                         // 乐观高亮: 转满瞬间立即反馈, 不干等硬件串行下发
  ElMessage.info(`切换中: ${s.name} (U${String(s.id).padStart(2, '0')})`);
  try {
    const res = await audioService.applyScene(s.id);
    if (!res.ok) throw new Error(res.error || '场景切换失败');
    ElMessage.success(`场景已切换: ${s.name} (U${String(s.id).padStart(2, '0')})`);
  } catch (err) {
    currentScene.value = prev;                       // 失败回滚高亮
    ElMessage.error(`切换 ${s.name} 失败: ${(err as Error).message}`);
  } finally { sceneBusy.value = false; }
}

// ============ 一键场景「长按激活」防误触 (跟首页磁贴一致) ============
// 轻碰无反应; 按住进度条走满 (~1.1s) 才真正切换; 中途松手 / 划走立即取消.
const HOLD_MS = 1100;
const holdId = ref<number | null>(null);   // 正在按住的预设号
const holdPct = ref(0);                     // 进度 0..100
let holdRaf = 0;
let holdFired = false;
let holdStartX = 0;
let holdStartY = 0;
function resetHold(): void {
  if (holdRaf) cancelAnimationFrame(holdRaf);
  holdRaf = 0; holdId.value = null; holdPct.value = 0;
}
function onHoldStart(s: Scene, ev: PointerEvent): void {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return; // 只认左键/单指
  if (sceneBusy.value) return;
  holdFired = false; holdId.value = s.id; holdPct.value = 0;
  holdStartX = ev.clientX; holdStartY = ev.clientY;
  const start = performance.now();
  if (holdRaf) cancelAnimationFrame(holdRaf);
  const loop = (now: number): void => {
    if (holdId.value !== s.id) return;
    const p = Math.min(100, ((now - start) / HOLD_MS) * 100);
    holdPct.value = p;
    if (p >= 100) { holdFired = true; resetHold(); void recallScene(s); return; }
    holdRaf = requestAnimationFrame(loop);
  };
  holdRaf = requestAnimationFrame(loop);
}
function onHoldMove(ev: PointerEvent): void {
  if (holdId.value === null) return;
  // 移动超过 12px = 想滚动/划走 → 取消
  if (Math.hypot(ev.clientX - holdStartX, ev.clientY - holdStartY) > 12) resetHold();
}
function onHoldEnd(): void {
  if (holdFired) { holdFired = false; return; }
  const p = holdPct.value;
  resetHold();
  if (p >= 10 && p < 100) ElMessage.info('按住场景按钮直到进度条走满，才会切换');
}
onUnmounted(() => {
  matrixPollStopped = true; // 见 scheduleMatrixPoll: 防 await 后又排一个孤儿 timer
  if (holdRaf) cancelAnimationFrame(holdRaf);
  stopPlTimer();
  if (matrixTimer) clearTimeout(matrixTimer); // 不清会在切页面后继续打设备
  if (reconcileTimer) clearTimeout(reconcileTimer); // 同上: 切走后别再对账
  // 拖推子过程中切页 → 别把锁滚动的全局监听漏在 document 上
  document.removeEventListener('touchmove', preventScrollWhileDragging);
});
async function refreshCurrentScene(): Promise<void> {
  try {
    const wrapped = await audioService.currentScene();
    const preset = wrapped?.data?.data?.preset;
    if (typeof preset === 'number' && preset >= 1 && preset <= 12) currentScene.value = preset;
  } catch { /* 静默 */ }
}
/**
 * 矩阵轮询 — 一条命令 ~284ms, 8s 一轮.
 * 这样别人用厂家 PC Editor 改了路由, 这边也能跟上; 更重要的是: 切页面回来
 * 看到的永远是设备当前的真实路由, 而不是本地记忆。
 */
const MATRIX_POLL_MS = 8000;
let matrixTimer: ReturnType<typeof setTimeout> | null = null;
// 2026-07-19 加固: 同 HvacPage, 防切页时 await 后重排出孤儿轮询, 持续打单客户端矩阵。
let matrixPollStopped = false;
function scheduleMatrixPoll(): void {
  matrixTimer = setTimeout(async () => {
    // 有在途写入 / 正等着对账时别读: 设备可能还没落到最新值, 读回来会把用户刚点
    // 的状态覆盖掉 (界面闪一下弹回去)。跳过这轮, 8s 后再来, 反正 scheduleReconcile
    // 会在这批点完后对一次账。
    if (pendingWrites.value === 0 && reconcileTimer === null) {
      await loadMatrixState();
    }
    if (!matrixPollStopped) scheduleMatrixPoll();
  }, MATRIX_POLL_MS);
}

onMounted(async () => {
  await loadPlaylist();
  // 进页面先跟后端"当前在播的"对齐一次 (bgm-player 可能正放着), 之后靠 watch 跟随
  void syncPlaybackFromChannel(bgmChannel.value?.currentMediaId);
  await Promise.all([loadScenes(), loadZones(), loadInputs(), loadMatrixState()]);
  void refreshCurrentScene();
  void loadAudioAssets();
  // 输入增益读一次要 ~4.6s, 不阻塞首屏, 也不进轮询
  void loadInputChannels();
  scheduleMatrixPoll();

  // 恢复静音状态 (从 localStorage)
  try {
    const raw = localStorage.getItem(MUTE_STATE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, { muted: boolean; volume: number }>;
      for (const z of channels.value) {
        if (saved[z.id]) {
          z.muted = saved[z.id].muted;
          z.volume = saved[z.id].volume;
          savedVolumes.value[z.id] = saved[z.id].volume;
        }
      }
    }
  } catch { /* ignore */ }

  // 从媒体库跳转过来时: 把选中的歌加到播放列表
  const pickId = Number(route.query.pick_id);
  const pickName = String(route.query.pick_name ?? '');
  if (pickId && pickName) {
    const dur = route.query.pick_dur ? Number(route.query.pick_dur) : null;
    if (!playlist.value.find((p) => p.id === pickId)) {
      playlist.value.push({ id: pickId, name: pickName, durationSec: dur || null });
    }
    audioTab.value = 'bgm';
    void router.replace({ name: 'audio', query: {} });
    ElMessage.success(`「${pickName}」已加入播放列表`);
  } else if (route.query.tab === 'bgm') {
    audioTab.value = 'bgm';
    void router.replace({ name: 'audio', query: {} });
  }
});

// ============ 分区 ============
interface AudioRow {
  /** 后端 audio_output_zone 主键 — 改名要用它 (下面的 id 是 'audio_out1' 这种展示用字符串) */
  dbId: number;
  id: string; name: string; zone: string; channel: number;
  volume: number; muted: boolean; bgm: string;
  bgmPlaying: boolean; mic: boolean;
  busy: boolean; error: string | null;
}

// 输出通道从后台配置拉 (业主可自定义名字 + 楼层 + 色). zone='out{channel+1}' 对应
// 后端 ZONE_TO_OUT 映射 (channel 0-based). 拉不到时兜底空, onMounted 再填.
const channels = ref<AudioRow[]>([]);

async function loadZones(): Promise<void> {
  try {
    const rows = await audioConfigService.listZones();
    channels.value = rows.map((z) => ({
      dbId: z.id,
      id: `audio_out${z.channel + 1}`,
      name: z.name,
      zone: `out${z.channel + 1}`,
      channel: z.channel,
      volume: 50,
      muted: false,
      bgm: '',
      bgmPlaying: false,
      mic: false,
      busy: false,
      error: null,
    }));
  } catch { /* 拉不到就空 */ }
}

// 页内 tab: 一键场景 / 背景音乐 / 分区音量 / 音源矩阵 — 一屏一组, 不上下滚
const audioTab = ref<'scene' | 'bgm' | 'zones' | 'matrix'>('scene');

// ============ 输出通道改名 ============
// 2026-07-17 业主: "分区音量里的输出通道推子名称应该和上传的照片名称一致, 并且可以编辑"。
// 名字本来就存在 audio_output_zone 表、也早按机柜标签配好了 (一楼门厅…二楼办公区),
// 缺的只是就地编辑。改完落库, 矩阵页的输出名来自同一张表, 会一起变。
const editingCh = ref<number | null>(null);
const editingChText = ref('');
function startRenameCh(z: AudioRow): void {
  editingCh.value = z.dbId;
  editingChText.value = z.name;
}
async function commitRenameCh(z: AudioRow): Promise<void> {
  const name = editingChText.value.trim();
  editingCh.value = null;
  if (!name || name === z.name) return;
  const before = z.name;
  z.name = name;                       // 乐观: 立刻显示
  try {
    await audioConfigService.updateZone(z.dbId, { name });
    ElMessage.success(`已改名为「${name}」`);
  } catch (err) {
    z.name = before;                   // 失败回滚, 不留后端不认的假名字
    ElMessage.error(`改名失败: ${(err as Error).message}`);
  }
}

// ============ 音源矩阵 (EKX-808 8x8 路由) ============
interface AudioIn { channel: number; name: string; }
const inputs = ref<AudioIn[]>([]);
async function loadInputs(): Promise<void> {
  try {
    const rows = await audioConfigService.listInputs();
    inputs.value = rows.map((s) => ({ channel: s.channel, name: s.name }));
  } catch { /* 拉不到就空 */ }
}
// 矩阵本地状态: key = `${outCh}_${inCh}` → 接通与否. 乐观更新 (不回读设备真实矩阵).
const matrixOn = ref<Record<string, boolean>>({});
function isMatrixOn(outCh: number, inCh: number): boolean {
  return !!matrixOn.value[`${outCh}_${inCh}`];
}
/**
 * 点交叉点 → 立即变色 → 后台下发 → 一批点完后**统一复读一次**设备.
 *
 * 失败就回滚成点击前的样子, 不留假连接 (以前失败会 saveMatrixState 把"已接通"
 * 存进本地文件, 提示还写"界面已保存" —— 等于显示一个设备上不存在的连接)。
 *
 * 2026-07-17 性能返工 (业主: "选择和取消动作太迟钝")。原来每点一下要跑两条
 * 设备命令: setMatrix(~287ms) + 收尾的整表复读(~287ms) ≈ 600ms, 而这 600ms
 * 里 matrixBusy 把这个点锁死、**再点直接被静默吞掉**(手感=点了没反应)。
 * EKX808 又是单客户端串行锁, 连点 5 下 = 10 条命令排队 ≈ 3 秒; 后端限流还是
 * 6 次/秒, 而每次点击发两个请求 -> 连点三下就撞限流报错。
 *
 * 现在: 每次点击只发**一条**命令, 不再逐次复读 (交给下面的防抖复读 + 8s 轮询);
 * 同一个点连点用"最后一次为准"合并, 不吞点击。
 */
// 同一个交叉点的目标态 (最后一次点击为准); 有在途请求时不重复起循环
const desiredCross = new Map<string, boolean>();
const inFlightCross = new Set<string>();
const pendingWrites = ref<number>(0);

// 一批点完后再复读一次设备对账 —— 别每点一下都读
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReconcile(): void {
  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    if (pendingWrites.value === 0) void loadMatrixState();
  }, 1200);
}

async function toggleMatrix(outCh: number, inCh: number): Promise<void> {
  const key = `${outCh}_${inCh}`;
  const before = !!matrixOn.value[key];
  const want = !before;
  matrixOn.value = { ...matrixOn.value, [key]: want };   // 乐观: 点击瞬间跟手
  desiredCross.set(key, want);

  // 已有在途循环: 它会读走最新的 desiredCross, 这里直接返回 (但界面已经翻好了)
  if (inFlightCross.has(key)) return;
  inFlightCross.add(key);
  pendingWrites.value += 1;
  try {
    // 排空: 期间又被点了就只发最后那个值, 中间的跳过 —— 少打设备
    while (desiredCross.has(key)) {
      const v = desiredCross.get(key) as boolean;
      desiredCross.delete(key);
      const res = await audioService.setMatrix(outCh, inCh, v);
      if (!res.ok) throw new Error(res.error || '设备未确认');
    }
  } catch (err) {
    desiredCross.delete(key);
    matrixOn.value = { ...matrixOn.value, [key]: before }; // 失败=回到原样
    ElMessage.error(`路由 OUT${outCh + 1}←IN${inCh + 1} 失败: ${(err as Error).message}`);
    void loadMatrixState();                                // 失败才立刻对账
  } finally {
    inFlightCross.delete(key);
    pendingWrites.value -= 1;
    scheduleReconcile();
  }
}

/**
 * 输入增益 — **读设备真实值**, 不再是"默认 80% 的本地状态".
 *
 * 老代码注释自己写着 "本地状态, 默认 80%; 乐观下发, 不回读设备"。2026-07-16
 * 实测真实增益是 IN1=+12dB / IN2=-60dB / IN3=+3.6dB / IN4=+0.1dB —— 跟界面上
 * 那个 80% 毫无关系, 而且切页面就没了。
 *
 * 读一次要 ~4.6s (16 次往返, EKX 单客户端只能串行), 所以只在开页面 / 改完时读,
 * 不轮询。null = 没读到, 界面显示"—"而不是编一个数。
 */
const inputGainDb = ref<Record<number, number | null>>({});
const inputMuted = ref<Record<number, boolean | null>>({});
const inputsLoading = ref(false);

async function loadInputChannels(): Promise<void> {
  inputsLoading.value = true;
  try {
    const r = await audioService.getLiveInputs();
    if (!r.ok || !r.data?.channels) throw new Error(r.error || '读输入通道失败');
    const g: Record<number, number | null> = {};
    const m: Record<number, boolean | null> = {};
    for (const c of r.data.channels) { g[c.ch] = c.gainDb; m[c.ch] = c.muted; }
    inputGainDb.value = g;
    inputMuted.value = m;
  } catch {
    /* 读不到就保持上次的值, 界面按 null 显示"—" */
  } finally {
    inputsLoading.value = false;
  }
}

/** 设备 dB (-60..+12) → 滑条百分比 (0..100), 仅用于 UI 展示 */
function gainDbToPct(db: number): number {
  return Math.round(((db + 60) / 72) * 100);
}
function inputGainOf(ch: number): number {
  const db = inputGainDb.value[ch];
  return db === null || db === undefined ? 0 : gainDbToPct(db);
}
/** 界面上显示的真实 dB 文本; 没读到就是 '—', 不编数 */
function inputGainLabel(ch: number): string {
  const db = inputGainDb.value[ch];
  return db === null || db === undefined ? '—' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

async function onInputGain(ch: number, value: number): Promise<void> {
  try {
    const res = await audioService.setInputVolume(ch, value);
    if (!res.ok) throw new Error(res.error || '执行失败');
  } catch (err) {
    ElMessage.error(`IN${ch + 1} 增益设置失败: ${(err as Error).message}`);
  } finally {
    await loadInputChannels(); // 以设备读回的为准, 不信自己刚才发了什么
  }
}

// 静音前保存各通道音量, 解除静音时用于渐响恢复
const savedVolumes = ref<Record<string, number>>({});
const MUTE_STATE_KEY = 'audio_mute_state_v1';

function saveMuteState(): void {
  const state: Record<string, { muted: boolean; volume: number }> = {};
  for (const z of channels.value) state[z.id] = { muted: z.muted, volume: z.volume };
  localStorage.setItem(MUTE_STATE_KEY, JSON.stringify(state));
}

async function applyVolume(z: AudioRow, value: number): Promise<void> {
  const prev = z.volume;
  z.volume = value;
  z.error = null;
  try {
    const res = await audioService.setVolume(z.id, value, z.zone);
    if (!res.ok) throw new Error(res.error || '执行失败');
  } catch (err) {
    z.volume = prev;
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} 音量调节失败: ${z.error}`);
  }
}
/**
 * 竖向推子交互 —— 不用 <input type="range"> 了。
 *
 * 2026-07-18 业主反馈: "分区音量推子不稳定,点击推子时随之漂动"。根因:
 * 原来是原生 range 输入伪装成竖向 (writing-mode: vertical-lr + direction: rtl,
 * 再叠一层 -webkit-appearance: slider-vertical 兜底), 三种手法一起糊上去。
 * 这类 CSS hack 让浏览器算"点在轨道哪个位置"时经常算错——尤其是**单击**(不是
 * 拖拽)瞬间, 不同 Chrome/Edge 版本对 vertical-lr+rtl 的命中判定不一致, 点下去
 * 报的初始值和手指/鼠标实际位置对不上, 看着就是"一点就跳到别的地方"。
 * 拖拽本身还好 (相对位移一般能跟手), 问题集中在点下那一下。
 *
 * 改法: 自己接管 pointerdown/move/up, 用轨道的 getBoundingClientRect() 直接
 * 算百分比, 不依赖浏览器对 range 输入方向的内部换算, 点哪就是哪。
 */
const draggingFaderId = ref<string | null>(null);
function faderPercentFromY(track: HTMLElement, clientY: number): number {
  const rect = track.getBoundingClientRect();
  const ratio = rect.height > 0 ? (rect.bottom - clientY) / rect.height : 0;
  const raw = Math.max(0, Math.min(100, ratio * 100));
  return Math.round(raw / 5) * 5; // 跟原来 step=5 对齐
}
function onFaderPointerDown(z: AudioRow, ev: PointerEvent): void {
  if (z.muted) return;
  const track = ev.currentTarget as HTMLElement;
  track.setPointerCapture(ev.pointerId);
  draggingFaderId.value = z.id;
  z.volume = faderPercentFromY(track, ev.clientY);
}
function onFaderPointerMove(z: AudioRow, ev: PointerEvent): void {
  if (draggingFaderId.value !== z.id) return;
  z.volume = faderPercentFromY(ev.currentTarget as HTMLElement, ev.clientY);
}
function onFaderPointerUp(z: AudioRow, ev: PointerEvent): void {
  if (draggingFaderId.value !== z.id) return;
  draggingFaderId.value = null;
  const track = ev.currentTarget as HTMLElement;
  if (track.hasPointerCapture(ev.pointerId)) track.releasePointerCapture(ev.pointerId);
  void applyVolume(z, z.volume);
}

/**
 * 拖推子时锁住整页滚动。业主反馈"手机上动推子时整个画面不稳定": iOS 上
 * touch-action:none 只管元素自身, 手指一旦拖出推子范围, 底层 touch 照样把页面
 * 滚起来, 画面就晃。拖动期间在 document 上拦掉 touchmove (必须 passive:false
 * 才能 preventDefault) 才真正锁死, 松手立刻解除。
 */
function preventScrollWhileDragging(e: TouchEvent): void { e.preventDefault(); }
watch(draggingFaderId, (id) => {
  if (id) document.addEventListener('touchmove', preventScrollWhileDragging, { passive: false });
  else document.removeEventListener('touchmove', preventScrollWhileDragging);
});

async function fadeInVolumes(targets: { z: AudioRow; vol: number }[]): Promise<void> {
  const STEPS = 5;
  const STEP_MS = 800; // 4 seconds total
  for (let step = 1; step <= STEPS; step++) {
    const pct = step / STEPS;
    for (const { z, vol } of targets) {
      const v = Math.round(vol * pct);
      z.volume = v;
      void audioService.setVolume(z.id, v, z.zone).catch(() => {});
    }
    if (step < STEPS) await new Promise<void>((r) => { setTimeout(r, STEP_MS); });
  }
}

async function toggleMute(z: AudioRow): Promise<void> {
  const prev = z.muted;
  if (!prev) {
    // 即将静音: 保存当前音量
    savedVolumes.value = { ...savedVolumes.value, [z.id]: z.volume };
  }
  z.muted = !z.muted;
  z.error = null;
  try {
    const res = z.muted
      ? await audioService.mute(z.id, z.zone)
      : await audioService.unmute(z.id, z.zone);
    if (!res.ok) throw new Error(res.error || '执行失败');
    saveMuteState();
    if (!z.muted) {
      // 解除静音: 渐响到保存的音量
      const target = savedVolumes.value[z.id] ?? z.volume;
      z.volume = 0;
      void audioService.setVolume(z.id, 0, z.zone).catch(() => {});
      void fadeInVolumes([{ z, vol: target }]);
    }
  } catch (err) {
    z.muted = prev;
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} ${z.muted ? '静音' : '取消静音'}失败: ${z.error}`);
  }
}


// ============ 总览 ============
const overview = computed(() => {
  const total = channels.value.length;
  const active = channels.value.filter((c) => !c.muted).length;
  const avgVol = active === 0 ? 0 : Math.round(
    channels.value.filter((c) => !c.muted).reduce((s, c) => s + c.volume, 0) / active,
  );
  const playing = channels.value.filter((c) => c.bgmPlaying).length;
  return { total, active, avgVol, playing };
});

function goBack(): void { router.push({ name: 'dashboard' }); }
const allMuted = computed(() =>
  channels.value.length > 0 && channels.value.every((c) => c.muted),
);
async function toggleMuteAll(): Promise<void> {
  if (allMuted.value) {
    // 解除全部静音: 先发 unmute 命令, 再统一渐响
    const fadeTargets: { z: AudioRow; vol: number }[] = [];
    for (const z of channels.value) {
      if (!z.muted) continue;
      const target = savedVolumes.value[z.id] ?? z.volume;
      savedVolumes.value = { ...savedVolumes.value, [z.id]: target };
      z.muted = false;
      z.volume = 0;
      void audioService.unmute(z.id, z.zone).catch(() => {});
      void audioService.setVolume(z.id, 0, z.zone).catch(() => {});
      fadeTargets.push({ z, vol: target });
    }
    saveMuteState();
    ElMessage.success('已解除静音，音量渐响恢复中…');
    void fadeInVolumes(fadeTargets);
  } else {
    // 全部静音: 保存各通道音量
    for (const z of channels.value) {
      if (z.muted) continue;
      savedVolumes.value = { ...savedVolumes.value, [z.id]: z.volume };
      z.muted = true;
      void audioService.mute(z.id, z.zone).catch(() => {});
    }
    saveMuteState();
    ElMessage.success('已全部静音');
  }
}
</script>

<template>
  <section class="v2-page">
    <header class="v2-page-head">
      <div class="back-row">
        <button class="v2-back-btn" @click="goBack" title="返回首页">
          <ArrowLeft :size="18" :stroke-width="2" />
        </button>
        <div class="title-block">
          <div class="title"><Speaker :size="18" :stroke-width="1.8" /> 音响控制</div>
        </div>
        <div class="v2-tabs">
          <button class="v2-tab" :class="{ active: audioTab === 'scene' }" @click="audioTab = 'scene'">一键场景</button>
          <button class="v2-tab" :class="{ active: audioTab === 'bgm' }" @click="audioTab = 'bgm'">背景音乐</button>
          <button class="v2-tab" :class="{ active: audioTab === 'zones' }" @click="audioTab = 'zones'">分区音量</button>
          <button class="v2-tab" :class="{ active: audioTab === 'matrix' }" @click="audioTab = 'matrix'">音源矩阵</button>
        </div>
      </div>
      <div class="quick-actions">
        <button :class="['v2-quick', allMuted ? 'active' : 'danger']" @click="toggleMuteAll">
          <Volume2 v-if="allMuted" :size="14" :stroke-width="2" />
          <VolumeX v-else :size="14" :stroke-width="2" />
          {{ allMuted ? '解除静音' : '全部静音' }}
        </button>
      </div>
    </header>

    <!-- 总览 -->
    <div class="v2-overview audio">
      <div class="ov-item">
        <div class="ov-ico"><Speaker :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">活跃分区</div>
          <div class="ov-value v2-inter">{{ overview.active }}<span class="unit">/ {{ overview.total }}</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Volume2 :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">平均音量</div>
          <div class="ov-value v2-inter">{{ overview.avgVol }}<span class="unit">%</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Play :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">播放中</div>
          <div class="ov-value v2-inter">{{ overview.playing }}<span class="unit">个 BGM</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Sparkles :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">当前预设</div>
          <div class="ov-value v2-inter" style="font-size: 16px;">
            {{ currentScene ? `U${String(currentScene).padStart(2,'0')}` : '—' }}
          </div>
        </div>
      </div>
    </div>

    <!-- 一键场景 U01-U12 -->
    <section v-if="audioTab === 'scene'" class="scene-section">
      <header class="block-head">
        <h2 class="block-title"><span class="accent">●</span>一键场景预设</h2>
        <div class="block-sub">U01-U12 由厂家工程师 PC 软件预录入 · 一条命令切全部 8 路</div>
      </header>
      <div class="scene-grid">
        <button
          v-for="s in SCENES"
          :key="s.id"
          class="scene-btn"
          :class="{ active: currentScene === s.id, holding: holdId === s.id }"
          :disabled="sceneBusy"
          @pointerdown="onHoldStart(s, $event)"
          @pointermove="onHoldMove($event)"
          @pointerup="onHoldEnd"
          @pointerleave="onHoldEnd"
          @pointercancel="onHoldEnd"
        >
          <div class="scene-id v2-inter">U{{ String(s.id).padStart(2,'0') }}</div>
          <div class="scene-name">{{ s.name }}</div>
          <div class="scene-hint">{{ s.hint }}</div>
          <div class="hold-bar" :style="{ width: holdId === s.id ? holdPct + '%' : '0%' }" aria-hidden="true"></div>
        </button>
      </div>
    </section>

    <!-- 背景音乐 (GK9000 声卡 → EKX 输入) -->
    <section v-if="audioTab === 'bgm'" class="bgm-section">
      <!-- 播放器卡片 -->
      <div class="bgm-player" :class="{ playing: bgmChannel?.currentMediaId }">
        <div class="bgm-now-row">
          <div class="bgm-ico-wrap"><Music :size="20" :stroke-width="1.6" /></div>
          <div class="bgm-now-body">
            <div class="bgm-now-name">{{ plCurrentItem?.name || bgmChannel?.currentMediaName || '未播放' }}</div>
            <div class="bgm-now-meta">
              <template v-if="bgmChannel?.currentMediaId">
                {{ bgmChannel.paused ? '已暂停' : '播放中' }} · {{ bgmChannel.alive ? 'GK9000 → 声卡 → EKX' : '⚠ 播放器离线' }}
                <template v-if="plCurrentItem?.durationSec"> · {{ fmtDuration(plCurrentItem.durationSec) }}</template>
              </template>
              <template v-else>添加曲目后点 ▶ 开始播放</template>
            </div>
          </div>
        </div>
        <!-- 进度条 -->
        <div class="bgm-prog-wrap">
          <div class="bgm-prog-fill" :style="{ width: plProgress + '%' }"></div>
        </div>
        <!-- 控制行 -->
        <div class="bgm-ctrl-row">
          <div class="bgm-ctrl-btns">
            <button class="bgm-btn" title="上一首" :disabled="playlist.length === 0" @click="plPrev">
              <SkipBack :size="17" :stroke-width="2" />
            </button>
            <button
              class="bgm-btn bgm-btn-main"
              :title="!bgmChannel?.currentMediaId ? '播放' : bgmChannel.paused ? '继续' : '暂停'"
              :disabled="playlist.length === 0"
              @click="plTogglePause"
            >
              <Pause v-if="bgmChannel?.currentMediaId && !bgmChannel.paused" :size="16" :stroke-width="2" />
              <Play v-else :size="16" :stroke-width="2" />
            </button>
            <button class="bgm-btn" title="下一首" :disabled="playlist.length === 0" @click="plNext">
              <SkipForward :size="17" :stroke-width="2" />
            </button>
            <button class="bgm-btn" title="停止" :disabled="!bgmChannel?.currentMediaId" @click="stopBgm">
              <Square :size="15" :stroke-width="2" />
            </button>
          </div>
          <div class="bgm-mode-row">
            <button :class="['bgm-mode', { active: playMode === 'seq' }]" title="顺序播放" @click="setPlayModeAndSave('seq')">顺序</button>
            <button :class="['bgm-mode', { active: playMode === 'loop1' }]" title="单曲循环" @click="setPlayModeAndSave('loop1')">
              <Repeat1 :size="12" :stroke-width="2.2" /> 单曲
            </button>
            <button :class="['bgm-mode', { active: playMode === 'loopAll' }]" title="列表循环" @click="setPlayModeAndSave('loopAll')">
              <Repeat :size="12" :stroke-width="2.2" /> 列表
            </button>
            <button :class="['bgm-mode', { active: playMode === 'shuffle' }]" title="随机播放" @click="setPlayModeAndSave('shuffle')">
              <Shuffle :size="12" :stroke-width="2.2" /> 随机
            </button>
          </div>
        </div>
      </div>

      <!-- 播放列表 -->
      <div class="bgm-pl">
        <div class="bgm-pl-bar">
          <span class="bgm-pl-label"><ListMusic :size="14" :stroke-width="1.8" /> 播放列表 <span class="bgm-pl-cnt">{{ playlist.length }}</span></span>
          <div class="bgm-pl-acts">
            <button class="v2-quick primary sm" @click="plPickerOpen = true; loadAudioAssets()">
              <Music :size="13" :stroke-width="2" /> 添加曲目
            </button>
            <button v-if="playlist.length > 0" class="v2-quick danger sm" @click="clearPlaylist">
              <Trash2 :size="13" :stroke-width="2" /> 清空
            </button>
          </div>
        </div>
        <div v-if="playlist.length === 0" class="bgm-pl-empty">
          <Music :size="26" :stroke-width="1.2" />
          <span>还没有曲目 · 点「添加曲目」从媒体库选音乐</span>
        </div>
        <div v-else class="bgm-pl-list">
          <div
            v-for="(item, i) in playlist"
            :key="i"
            class="bgm-pl-row"
            :class="{ active: i === plIdx }"
            @click="onPlRowClick(i, item)"
          >
            <div class="bgm-pl-idx">
              <Volume2 v-if="i === plIdx" :size="12" :stroke-width="2" class="bgm-pl-anim" />
              <span v-else>{{ i + 1 }}</span>
            </div>
            <!-- 就地改名: 只改这里的显示名, 不动媒体库原文件 (跟 LED 播放页一致的交互) -->
            <input
              v-if="plEditingId === item.itemId && item.itemId"
              v-model="plEditingText"
              class="bgm-pl-name-input" maxlength="60"
              @click.stop @keyup.enter="commitRenamePl(item)"
              @keyup.esc="plEditingId = null" @blur="commitRenamePl(item)"
            />
            <div v-else class="bgm-pl-name" :title="item.name" @click.stop @dblclick.stop="startRenamePl(item)">
              {{ item.name }}
              <i v-if="item.missing" class="bgm-pl-missing">媒体已删除</i>
            </div>
            <div class="bgm-pl-dur">{{ fmtDuration(item.durationSec) }}</div>
            <button class="bgm-pl-ico" title="改名 (只改显示名, 不动媒体库原文件)" @click.stop="startRenamePl(item)">
              <Pencil :size="12" :stroke-width="2" />
            </button>
            <button class="bgm-pl-del" title="移除" @click.stop="removeFromPlaylist(i)">
              <Square :size="10" :stroke-width="2.5" />
            </button>
          </div>
        </div>
      </div>

      <!-- 音频选择器 dialog -->
      <Teleport to="body">
        <div v-if="plPickerOpen" class="preview-mask" @click.self="plPickerOpen = false">
          <div class="bgm-picker">
            <div class="bgm-picker-head">
              <Music :size="16" :stroke-width="1.8" /> 选择音乐
              <span class="bgm-picker-sub">点击曲目添加到播放列表</span>
            </div>
            <div v-if="audioAssets.length === 0" class="bgm-picker-empty">媒体库暂无音频文件，请先到「媒体库」上传</div>
            <div v-else class="bgm-picker-list">
              <div
                v-for="a in audioAssets"
                :key="a.id"
                class="bgm-picker-row"
                :class="{ added: playlist.some(p => p.id === a.id) }"
                @click="addToPlaylist(a)"
              >
                <Music :size="13" :stroke-width="1.8" class="bgm-picker-ico" />
                <div class="bgm-picker-name">{{ a.name }}</div>
                <div class="bgm-picker-dur">{{ fmtDuration(a.durationSec) }}</div>
                <div class="bgm-picker-tag">{{ playlist.some(p => p.id === a.id) ? '✓ 已添加' : '+ 添加' }}</div>
              </div>
            </div>
            <div class="bgm-picker-foot">
              <button class="v2-quick" @click="plPickerOpen = false">完成</button>
            </div>
          </div>
        </div>
      </Teleport>
    </section>

    <!-- 输出通道控制 — 8 路竖直推子 (调音台式), 一屏不滚 -->
    <section v-if="audioTab === 'zones'" class="zones-section">
      <header class="block-head">
        <h2 class="block-title"><span class="accent">●</span>输出通道</h2>
        <div class="block-sub">EKX-808 共 8 路输出 · 音量 / 静音 · 接好喇叭后可改成区域名</div>
      </header>
      <div class="ch-grid">
        <div
          v-for="z in channels"
          :key="z.id"
          class="ch-card"
          :class="{ muted: z.muted, error: !!z.error }"
        >
          <!-- 就地改名: 双击名字或点笔。名字落 audio_output_zone 表, 矩阵页同源, 一起变 -->
          <input
            v-if="editingCh === z.dbId"
            v-model="editingChText"
            class="ch-name-input" maxlength="24"
            @click.stop @keyup.enter="commitRenameCh(z)"
            @keyup.esc="editingCh = null" @blur="commitRenameCh(z)"
          />
          <div v-else class="ch-name" :title="z.name" @dblclick.stop="startRenameCh(z)">
            {{ z.name }}
            <button class="ch-edit" title="改名" @click.stop="startRenameCh(z)">
              <Pencil :size="12" />
            </button>
          </div>
          <div class="ch-addr v2-inter">{{ z.id.toUpperCase() }}</div>
          <!-- 触摸/拖动接收区是整个 .fader (不是 12px 窄轨) —— 手指粗, 按窄轨极易
               滑出, 一滑出 iOS 就当页面滚动。整块接收 + 拖动中全局锁滚动才不抖。 -->
          <div
            class="fader"
            :class="{ disabled: z.muted, dragging: draggingFaderId === z.id }"
            @pointerdown="onFaderPointerDown(z, $event)"
            @pointermove="onFaderPointerMove(z, $event)"
            @pointerup="onFaderPointerUp(z, $event)"
            @pointercancel="onFaderPointerUp(z, $event)"
          >
            <div class="fader-track">
              <div class="fader-fill" :style="{ height: z.volume + '%' }"></div>
            </div>
            <div class="fader-thumb" :style="{ bottom: 'calc(' + z.volume + '% - 8px)' }" aria-hidden="true"></div>
          </div>
          <button class="v2-toggle" :class="{ on: !z.muted }" @click="toggleMute(z)"></button>
          <span class="vol-value v2-inter">{{ z.volume }}<span class="pct">%</span></span>
        </div>
      </div>
    </section>

    <!-- 音源矩阵 (EKX-808 8x8 路由) -->
    <section v-if="audioTab === 'matrix'" class="matrix-section">
      <div v-if="matrixOffline" class="mx-offline">
        <strong>⚠ 音频矩阵离线</strong>
        <span>{{ matrixErrMsg || 'EKX-808 (192.168.50.61) 连不上' }}</span>
        <span class="mx-offline-hint">音频矩阵是全场声音的中枢 —— 它离线时所有分区都没声。请到功放/音频机柜检查 EKX-808 的电源和网线（改投影/融合器接线时最容易被碰掉）。设备恢复上电联网后会自动重连。</span>
      </div>
      <header class="block-head matrix-head">
        <h2 class="block-title">
          <span class="accent">●</span>音源矩阵
          <!-- 读不到时明说, 别让人以为看到的是当前状态 -->
          <span v-if="matrixStale" class="mx-stale" title="读不到设备, 下面显示的是上次读到的路由">
            设备读取失败 · 显示的是上次的路由
          </span>
          <span v-if="inputsLoading" class="mx-loading">读取增益中…</span>
        </h2>
      </header>
      <div class="input-gains">
        <div class="ig-row">
          <div v-for="inp in inputs" :key="'ig' + inp.channel" class="ig-item">
            <div class="ig-name" :title="inp.name">{{ inp.name }}</div>
            <input
              type="range" :min="0" :max="100" :step="5"
              :value="inputGainOf(inp.channel)"
              class="ig-slider"
              @change="onInputGain(inp.channel, Number(($event.target as HTMLInputElement).value))"
            />
            <!-- 显示设备真实 dB, 不是滑条百分比 —— 百分比是 UI 自己换算的, dB 才是设备说的 -->
            <div class="ig-val v2-inter" :class="{ unknown: inputGainDb[inp.channel] == null }">
              {{ inputGainLabel(inp.channel) }}
            </div>
          </div>
        </div>
      </div>
      <div class="matrix-wrap">
        <div class="matrix-grid" :style="{ gridTemplateColumns: `112px repeat(${inputs.length || 8}, minmax(0, 1fr))`, gridTemplateRows: `auto repeat(${channels.length || 8}, 1fr)` }">
          <div class="mx-corner">输出 ↓ &nbsp;/&nbsp; 输入 →</div>
          <div v-for="inp in inputs" :key="'h' + inp.channel" class="mx-colhead">{{ inp.name }}</div>
          <template v-for="z in channels" :key="'r' + z.channel">
            <div class="mx-rowhead" :title="z.name">{{ z.name }}</div>
            <button
              v-for="inp in inputs"
              :key="z.channel + '_' + inp.channel"
              class="mx-cell"
              :class="{ on: isMatrixOn(z.channel, inp.channel) }"
              :title="`${z.name} ← ${inp.name}`"
              @click="toggleMatrix(z.channel, inp.channel)"
            ><span v-if="isMatrixOn(z.channel, inp.channel)" class="mx-dot"></span></button>
          </template>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
/* BGM 列表就地改名 (业主: "在播放列表里面可以更改文件名字") */
.bgm-pl-name-input {
  flex: 1 1 auto; min-width: 0; padding: 3px 6px; font-size: 13px;
  color: var(--v2-text-1); background: var(--v2-inset-bg);
  border: 1px solid var(--v2-primary); border-radius: 5px; outline: none;
}
.bgm-pl-missing {
  margin-left: 6px; padding: 1px 5px; border-radius: 4px;
  background: #7f1d1d55; color: #EC8880; font-size: 10px; font-style: normal;
}
.bgm-pl-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; flex: 0 0 auto; border-radius: 5px;
  background: transparent; border: none; cursor: pointer;
  color: var(--v2-text-2); opacity: 0; transition: opacity .12s;
}
.bgm-pl-row:hover .bgm-pl-ico { opacity: 1; }
.bgm-pl-ico:hover { color: var(--v2-primary); }
/* 输出通道就地改名 (业主: 推子名称要跟机柜标签一致且可编辑) */
.ch-name-input {
  width: 100%; padding: 3px 6px;
  font-size: 14px; font-weight: 600; text-align: center;
  color: var(--v2-text-1); background: var(--v2-inset-bg);
  border: 1px solid var(--v2-primary); border-radius: 5px; outline: none;
}
.ch-edit {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; margin-left: 3px; border-radius: 4px;
  background: transparent; border: none; cursor: pointer;
  color: var(--v2-text-2); opacity: 0; transition: opacity .12s;
}
.ch-card:hover .ch-edit { opacity: 1; }
.ch-edit:hover { color: var(--v2-primary); }
.v2-page {
  padding: var(--v2-sp-5); display: flex; flex-direction: column; gap: var(--v2-sp-4);
  height: 100%; box-sizing: border-box; overflow: hidden;
}

.v2-page-head { display: flex; justify-content: space-between; align-items: center; gap: var(--v2-sp-4); flex-wrap: wrap; }
.back-row { display: flex; align-items: center; gap: var(--v2-sp-4); }
.v2-back-btn {
  width: 36px; height: 36px; border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  display: grid; place-items: center; cursor: pointer; color: var(--v2-text-2);
  transition: all 0.18s ease;
}
.v2-back-btn:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.title-block { display: flex; flex-direction: column; }
.title { font-size: 15px; font-weight: 600; color: var(--v2-text-1); display: inline-flex; align-items: center; gap: var(--v2-sp-2); }
.sub { font-size: var(--v2-fs-xs); color: var(--v2-text-3); margin-top: 2px; }
.v2-tabs {
  display: inline-flex;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-sm);
  padding: 3px;
  margin-left: var(--v2-sp-3);
}
.v2-tab {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: var(--v2-fs-sm);
  color: var(--v2-text-2);
  cursor: pointer;
  background: transparent;
  border: none;
  transition: all 0.18s ease;
}
.v2-tab.active {
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
  box-shadow: 0 0 0 1px rgba(76, 154, 255, 0.2);
}
.quick-actions { display: flex; gap: var(--v2-sp-2); }
.v2-quick {
  padding: 8px 14px; border-radius: var(--v2-r-sm); font-size: var(--v2-fs-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2); cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: all 0.18s ease; min-height: 36px;
}
.v2-quick:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.v2-quick.primary {
  background: var(--v2-amber-soft); color: var(--v2-amber);
  border-color: rgba(224, 160, 48, 0.3);
}
.v2-quick.danger {
  background: rgba(229, 100, 93, 0.1); color: var(--v2-danger);
  border-color: rgba(229, 100, 93, 0.3);
}
.v2-quick.active {
  background: rgba(63, 191, 135, 0.12); color: var(--v2-success);
  border-color: rgba(63, 191, 135, 0.3);
}

/* Overview (audio green) */
.v2-overview.audio {
  display: flex; align-items: center;
  padding: 8px var(--v2-sp-3);
  background: linear-gradient(135deg, rgba(63, 191, 135, 0.05), rgba(63, 191, 135, 0.01));
  border: 1px solid rgba(63, 191, 135, 0.12);
  border-radius: var(--v2-r-md);
}

/* ── 背景音乐播放器 ── */
.bgm-section { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--v2-sp-3); }

.bgm-player {
  flex-shrink: 0;
  padding: var(--v2-sp-4);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  display: flex; flex-direction: column; gap: var(--v2-sp-3);
  transition: border-color 0.28s ease, background 0.28s ease, box-shadow 0.28s ease;
}
.bgm-player.playing {
  border-color: var(--v2-border-soft);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.07), rgba(76, 154, 255, 0.02));
  box-shadow: inset 0 1px 0 var(--v2-card-hairline), 0 6px 24px -8px rgba(255, 255, 255, 0.08);
}
.bgm-now-row { display: flex; align-items: center; gap: var(--v2-sp-3); }
.bgm-ico-wrap {
  width: 44px; height: 44px; border-radius: var(--v2-r-md); flex-shrink: 0;
  display: grid; place-items: center;
  background: var(--v2-ov-2); color: #c4b5fd;
  transition: box-shadow 0.28s ease;
}
.bgm-player.playing .bgm-ico-wrap { color: #d8b4fe; box-shadow: 0 0 16px rgba(255, 255, 255, 0.08); }
.bgm-now-body { flex: 1; min-width: 0; }
.bgm-now-name { font-size: 15px; font-weight: 600; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bgm-now-meta { font-size: 11px; color: var(--v2-text-3); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bgm-prog-wrap {
  height: 3px; border-radius: 2px; background: var(--v2-surf-2); overflow: hidden;
}
.bgm-prog-fill {
  height: 100%; border-radius: 2px;
  background: linear-gradient(90deg, #9BA1A9, #9BA1A9);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.08);
  transition: width 0.4s linear;
}
.bgm-ctrl-row {
  display: flex; align-items: center; justify-content: space-between; gap: var(--v2-sp-3);
  flex-wrap: wrap;
}
.bgm-ctrl-btns { display: flex; align-items: center; gap: var(--v2-sp-2); }
.bgm-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft);
  display: grid; place-items: center; cursor: pointer; color: var(--v2-text-2);
  transition: all 0.16s ease;
}
.bgm-btn:hover:not(:disabled) { background: var(--v2-surf-1-hover); color: var(--v2-text-1); border-color: var(--v2-border-strong); }
.bgm-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.bgm-btn-main {
  width: 44px; height: 44px; background: var(--v2-ov-2); color: #9BA1A9;
  border-color: var(--v2-border-soft);
}
.bgm-btn-main:hover:not(:disabled) { background: var(--v2-ov-2); color: #d8b4fe; }
.bgm-mode-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.bgm-mode {
  padding: 4px 10px; border-radius: 20px; font-size: 11px; cursor: pointer;
  background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-3); display: inline-flex; align-items: center; gap: 4px;
  transition: all 0.16s ease;
}
.bgm-mode:hover { color: var(--v2-text-2); border-color: var(--v2-border-strong); }
.bgm-mode.active {
  background: var(--v2-ov-2); color: #9BA1A9;
  border-color: var(--v2-border-soft);
}

/* 播放列表 */
.bgm-pl {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg); overflow: hidden;
}
.bgm-pl-bar {
  flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
  padding: 10px var(--v2-sp-4); border-bottom: 1px solid var(--v2-border-soft);
}
.bgm-pl-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; color: var(--v2-text-2);
}
.bgm-pl-cnt {
  font-size: 11px; padding: 1px 7px; border-radius: 10px;
  background: var(--v2-surf-2); color: var(--v2-text-3); font-weight: 500;
}
.bgm-pl-acts { display: flex; gap: 6px; }
.v2-quick.sm { padding: 5px 10px; min-height: 28px; font-size: 12px; }
.bgm-pl-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--v2-sp-2); color: var(--v2-text-3); font-size: 13px;
}
.bgm-pl-list { flex: 1; overflow-y: auto; }
.bgm-pl-row {
  display: grid; grid-template-columns: 30px 1fr auto 28px;
  align-items: center; gap: 8px;
  padding: 8px var(--v2-sp-4);
  border-bottom: 1px solid var(--v2-border-soft);
  cursor: pointer; transition: background 0.14s ease;
}
.bgm-pl-row:last-child { border-bottom: none; }
.bgm-pl-row:hover { background: var(--v2-surf-1-hover); }
.bgm-pl-row.active { background: var(--v2-ov-2); }
.bgm-pl-idx {
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--v2-text-3); font-weight: 500;
}
.bgm-pl-row.active .bgm-pl-idx { color: #9BA1A9; }
.bgm-pl-anim { color: #9BA1A9; }
.bgm-pl-name {
  font-size: 13px; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bgm-pl-row.active .bgm-pl-name { color: #9BA1A9; font-weight: 500; }
.bgm-pl-dur { font-size: 11px; color: var(--v2-text-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.bgm-pl-del {
  display: grid; place-items: center; width: 24px; height: 24px;
  border-radius: var(--v2-r-sm); background: transparent; border: none;
  color: var(--v2-text-3); cursor: pointer; opacity: 0; transition: all 0.14s ease;
}
.bgm-pl-row:hover .bgm-pl-del { opacity: 1; }
.bgm-pl-del:hover { background: rgba(229, 100, 93, 0.12); color: var(--v2-danger); }

/* 音频选择器 dialog */
.bgm-picker {
  background: var(--v2-bg-0); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-xl);
  width: min(560px, 94vw); max-height: 70vh;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 64px -16px rgba(0,0,0,0.6);
}
.bgm-picker-head {
  flex-shrink: 0; padding: var(--v2-sp-4) var(--v2-sp-5);
  border-bottom: 1px solid var(--v2-border-soft);
  font-size: 15px; font-weight: 600; color: var(--v2-text-1);
  display: flex; align-items: center; gap: 8px;
}
.bgm-picker-sub { margin-left: auto; font-size: 11px; color: var(--v2-text-3); font-weight: 400; }
.bgm-picker-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--v2-text-3); font-size: 13px; }
.bgm-picker-list { flex: 1; overflow-y: auto; }
.bgm-picker-row {
  display: grid; grid-template-columns: 20px 1fr auto auto;
  align-items: center; gap: 10px;
  padding: 10px var(--v2-sp-5);
  border-bottom: 1px solid var(--v2-border-soft);
  cursor: pointer; transition: background 0.14s ease;
}
.bgm-picker-row:last-child { border-bottom: none; }
.bgm-picker-row:hover { background: var(--v2-surf-1); }
.bgm-picker-row.added { opacity: 0.65; }
.bgm-picker-ico { color: #9BA1A9; flex-shrink: 0; }
.bgm-picker-name { font-size: 13px; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bgm-picker-dur { font-size: 11px; color: var(--v2-text-3); white-space: nowrap; }
.bgm-picker-tag {
  font-size: 11px; padding: 2px 8px; border-radius: 10px; white-space: nowrap;
  background: var(--v2-surf-2); color: var(--v2-text-3); border: 1px solid var(--v2-border-soft);
}
.bgm-picker-row:not(.added):hover .bgm-picker-tag {
  background: var(--v2-ov-2); color: #9BA1A9; border-color: var(--v2-border-soft);
}
.bgm-picker-row.added .bgm-picker-tag { background: rgba(63, 191, 135, 0.1); color: var(--v2-success); border-color: rgba(63, 191, 135, 0.25); }
.bgm-picker-foot {
  flex-shrink: 0; padding: var(--v2-sp-3) var(--v2-sp-5);
  border-top: 1px solid var(--v2-border-soft);
  display: flex; justify-content: flex-end;
}

/* dialog overlay (shared with picker) */
.preview-mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.82);
  backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
}
.ov-item {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: var(--v2-sp-3);
  padding: 0 var(--v2-sp-4);
  position: relative;
}
.ov-item:not(:first-child)::before {
  content: ''; position: absolute; left: 0; top: 50%;
  transform: translateY(-50%);
  width: 1px; height: 28px;
  background: var(--v2-border-soft);
}
.ov-ico {
  width: 32px; height: 32px; border-radius: var(--v2-r-sm);
  background: rgba(63, 191, 135, 0.14); color: #3FBF87;
  display: grid; place-items: center; flex-shrink: 0;
}
.ov-body { display: flex; flex-direction: column; min-width: 0; }
.ov-label { font-size: var(--v2-fs-xs); color: var(--v2-text-3); letter-spacing: 1px; }
.ov-value { font-size: 17px; font-weight: 600; line-height: 1.1; margin-top: 1px; color: var(--v2-text-1); }
.ov-value .unit { font-size: 11px; color: var(--v2-text-3); margin-left: 2px; font-weight: 400; }

/* block head */
.block-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: var(--v2-sp-3);
}
.block-title {
  font-size: var(--v2-fs-md); font-weight: 600;
  letter-spacing: 0.5px; margin: 0;
}
.block-title .accent { color: var(--v2-primary); margin-right: var(--v2-sp-2); }
.block-sub { font-size: var(--v2-fs-xs); color: var(--v2-text-3); }

/* Scene grid 4x3 */
.scene-grid {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--v2-sp-2);
}
@media (max-width: 1280px) { .scene-grid { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 900px)  { .scene-grid { grid-template-columns: repeat(3, 1fr); } }

.scene-btn {
  position: relative;
  overflow: hidden;
  padding: var(--v2-sp-3);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  cursor: pointer;
  text-align: left;
  color: var(--v2-text-1);
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
  min-height: 80px;
  display: flex; flex-direction: column; gap: 2px;
  user-select: none; -webkit-user-select: none;
}
.scene-btn.holding { border-color: var(--v2-primary); }
.hold-bar {
  position: absolute; left: 0; bottom: 0; height: 3px; width: 0;
  background: linear-gradient(90deg, var(--v2-primary), #22d3ee);
  box-shadow: 0 0 8px rgba(76, 154, 255, 0.7);
  transition: width 60ms linear;
  pointer-events: none;
}
.scene-btn:hover {
  background: var(--v2-surf-1-hover);
  border-color: var(--v2-border-strong);
}
.scene-btn.active {
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
  border-color: rgba(76, 154, 255, 0.4);
  box-shadow: 0 4px 16px -4px rgba(76, 154, 255, 0.4);
}
.scene-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.scene-id { font-size: 10px; color: var(--v2-text-3); letter-spacing: 1px; }
.scene-btn.active .scene-id { color: var(--v2-primary); }
.scene-name { font-size: 14px; font-weight: 600; }
.scene-hint { font-size: 10px; color: var(--v2-text-3); letter-spacing: 0.5px; }
.scene-btn.active .scene-hint { color: rgba(76, 154, 255, 0.7); }

/* zones tab 占满剩余高度, 内部不滚 (8 路竖直推子一屏全显) */
.zones-section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.zones-section .block-head { flex-shrink: 0; }

/* 8 路竖直推子横向并排 */
.ch-grid {
  display: flex; flex-direction: row; gap: var(--v2-sp-2);
  flex: 1; min-height: 0; align-items: stretch;
}
/* 屏矮时进一步压字号 */
@media (max-height: 680px) {
  .ch-name { font-size: 12px; }
  .vol-value { font-size: 13px; }
}

.ch-card {
  flex: 1; min-width: 0;
  padding: var(--v2-sp-3) 6px var(--v2-sp-2);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  transition: border-color 0.18s ease, background 0.18s ease;
  position: relative;
  overflow: hidden;
}
/* 顶部 1px 霓虹绿光带 — 音响主色 */
.ch-card::after {
  content: '';
  position: absolute;
  top: 0; left: 12%; right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--v2-success) 50%, transparent);
  box-shadow: 0 0 8px var(--v2-success);
  opacity: 0.35;
  pointer-events: none;
  transition: opacity 0.28s ease;
}
.ch-card:hover {
  border-color: rgba(63, 191, 135, 0.45);
}
.ch-card:hover::after { opacity: 0.85; }
.ch-card:not(.muted) {
  border-color: rgba(63, 191, 135, 0.5);
  background: linear-gradient(180deg, rgba(63, 191, 135, 0.06), rgba(63, 191, 135, 0.02));
  box-shadow: inset 0 1px 0 rgba(63, 191, 135, 0.45);
}
.ch-card:not(.muted)::after { opacity: 1; }
.ch-card.muted { opacity: 0.7; }
.ch-card.error { border-color: rgba(229, 100, 93, 0.55); }

.ch-name { font-size: 13px; font-weight: 600; color: var(--v2-text-1); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; flex-shrink: 0; }
.ch-addr { font-size: 10px; color: var(--v2-text-3); letter-spacing: 1px; text-align: center; flex-shrink: 0; }

.v2-toggle {
  position: relative; width: 42px; height: 24px;
  border-radius: 12px; background: var(--v2-surf-2);
  cursor: pointer; transition: background 0.22s ease;
  flex-shrink: 0; border: none; padding: 0;
}
.v2-toggle::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 20px; height: 20px; border-radius: 50%;
  background: white; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.v2-toggle.on {
  background: linear-gradient(135deg, #3FBF87, #3FBF87);
  box-shadow:
    0 0 14px rgba(63, 191, 135, 0.6),
    0 0 28px rgba(63, 191, 135, 0.35);
}
.v2-toggle.on::after {
  background: white;
  box-shadow: 0 1px 4px rgba(0,0,0,0.4), 0 0 8px rgba(255, 255, 255, 0.6);
}
.v2-toggle.on::after { transform: translateX(18px); }

/* 竖直推子 (fader) — 占满 card 中段剩余高度, 可竖向拖动 */
.fader {
  position: relative; flex: 1; min-height: 70px; width: 100%;
  display: flex; justify-content: center;
}
.fader-track {
  position: relative; width: 12px; height: 100%;
  background: var(--v2-surf-2); border-radius: 8px; overflow: hidden;
  border: 1px solid var(--v2-border-soft);
}
.fader-fill {
  position: absolute; left: 0; right: 0; bottom: 0;
  background: linear-gradient(0deg, #3FBF87 0%, #3FBF87 55%, #6BFFB9 100%);
  box-shadow: 0 0 14px rgba(63, 191, 135, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3);
  transition: height 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.ch-card.muted .fader-fill { background: var(--v2-surf-2); box-shadow: none; }
/* 推子帽 (拖动手柄) — 跟随音量上下移动, 一看就知道能竖向拖 */
.fader-thumb {
  position: absolute; left: 50%; transform: translateX(-50%);
  width: 24px; height: 16px; border-radius: 5px;
  background: linear-gradient(180deg, #ffffff, #cdebdd);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.55), 0 0 12px rgba(63, 191, 135, 0.5);
  z-index: 2; pointer-events: none;
  transition: bottom 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.fader-thumb::after {
  content: ''; position: absolute; left: 5px; right: 5px; top: 50%;
  height: 2px; transform: translateY(-50%);
  background: rgba(0, 0, 0, 0.22); border-radius: 1px;
}
.ch-card.muted .fader-thumb { background: #8092ab; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5); }
/* fader-track 本身就是拖动接收面 (见 onFaderPointerDown/Move/Up) — 不用透明
   range 输入盖一层了, 见上面 script 里那段改法说明 */
/* 触摸/拖动接收区是整个 .fader (见模板注释 + onFaderPointer*)。touch-action:none
   阻止该区域自身的滚动手势; 手指拖出范围后的全局锁滚动在 script 里
   (preventScrollWhileDragging)。两层一起才治得住"动推子整个画面晃"。 */
.fader { cursor: pointer; touch-action: none; }
.fader.disabled { cursor: not-allowed; }
.fader-track { touch-action: none; }
/* 拖动中禁掉 fill/thumb 的追赶动画 —— 值在快速变, 0.22s 缓动会一路"追"着走, 看着
   就是抖/滞后。松手后 (非 dragging) 恢复, 单击 / 程序改值仍有平滑过渡。 */
.fader.dragging .fader-fill,
.fader.dragging .fader-thumb { transition: none; }

.vol-value { font-size: 15px; font-weight: 700; color: var(--v2-text-1); text-align: center; flex-shrink: 0; }
.ch-card:not(.muted) .vol-value { color: #6BFFB9; text-shadow: var(--v2-text-glow-success); }
.vol-value .pct { font-size: 10px; color: var(--v2-text-3); margin-left: 1px; font-weight: 500; text-shadow: none; }
.ch-card.muted .vol-value { color: var(--v2-text-3); }

/* ============ 音源矩阵 (EKX-808 8x8) ============ */
.matrix-section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.matrix-head { flex-shrink: 0; margin-bottom: 8px; }
.matrix-wrap { flex: 1; min-height: 0; overflow: hidden; }
.matrix-grid { display: grid; gap: 5px; height: 100%; }
.mx-corner {
  font-size: 10px; color: var(--v2-text-3); letter-spacing: 0.5px;
  display: flex; align-items: center; justify-content: center; text-align: center; padding: 4px;
}
.mx-colhead {
  font-size: 11px; color: var(--v2-text-2); font-weight: 500;
  display: flex; align-items: center; justify-content: center; text-align: center;
  padding: 5px 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  border-bottom: 1px solid var(--v2-border-soft);
}
.mx-rowhead {
  font-size: 13px; color: var(--v2-text-1); font-weight: 500;
  display: flex; align-items: center; padding: 0 10px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mx-cell {
  border-radius: 8px;
  background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft);
  cursor: pointer; display: grid; place-items: center;
  transition: background 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.mx-cell:hover { border-color: rgba(63, 191, 135, 0.5); }
.mx-cell.on {
  background: linear-gradient(135deg, #3FBF87, #3FBF87);
  border-color: transparent;
  box-shadow: 0 0 12px rgba(63, 191, 135, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.mx-dot { width: 11px; height: 11px; border-radius: 50%; background: #fff; box-shadow: 0 0 6px rgba(255, 255, 255, 0.85); }

/* 输入增益行 (音源矩阵页顶部) */
.input-gains { flex-shrink: 0; margin-bottom: 10px; }
.ig-row { display: grid; grid-template-columns: repeat(8, 1fr); gap: 10px; }
.ig-item { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.ig-name { font-size: 10px; color: var(--v2-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.ig-slider { width: 100%; accent-color: #3FBF87; cursor: pointer; }
.ig-val { font-size: 11px; color: #6BFFB9; font-weight: 700; }

/* 矩阵读不到 / 增益读取中 的提示 */
.mx-stale {
  margin-left: 10px; padding: 2px 7px; border-radius: 999px;
  font-size: 11px; font-weight: 400; color: #ff9a52;
  background: #3a2a1c; border: 1px solid #6b4526;
}
.mx-loading { margin-left: 10px; font-size: 11px; font-weight: 400; color: #6d7f98; }
.mx-offline {
  display: flex; flex-direction: column; gap: 4px;
  margin-bottom: 14px; padding: 12px 16px; border-radius: 10px;
  background: rgba(229, 100, 93, 0.14); border: 1px solid rgba(229, 100, 93, 0.5);
}
.mx-offline strong { color: #ff8f88; font-size: 15px; }
.mx-offline > span { color: #ffb3ad; font-size: 13px; }
.mx-offline .mx-offline-hint { color: #d69a96; font-size: 12px; line-height: 1.5; font-weight: 400; }
/* 增益没读到时显示 "—", 灰掉, 别让人以为是个真数 */
.ig-val.unknown { color: #55637a; font-style: italic; }
</style>
