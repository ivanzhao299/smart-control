<script setup lang="ts">
/**
 * 播放控制台 — LED 大屏 / 投影仪**共用**这一个组件, 只有 slot 和标题不同。
 *
 * 为什么抽成组件而不是两个页面各写一份: 2026-07-17 在空调页刚吃过教训 ——
 * 同一个卡片写两遍, 必然改一处漏一处。这里两块屏的播放控制逻辑 100% 相同
 * (列表/历史/上下曲/暂停/终止/上传), 只是 slot 不一样, 没有任何理由抄两份。
 *
 * **所有操作都在本页完成, 不跳走**。
 *
 * 2026-07-17 业主原话:
 *   "播放页面不应该点击按钮跳转到其他页面, 应该在该页面固定不变"
 *   "平时经常播放的内容应该在播放列表里面, 随时可以切换播放列表内的内容"
 *   "在播放列表里面可以更改文件名字, 便于随时查找需要播放的素材"
 *   "播放过程中应该随时可以点击终止"
 *   "在 LED 大屏播放页面就可以直接点击上传内容"
 *   "播放过的内容应该有播放历史"
 *   "媒体文件夹内容默认不加入播放列表, 需经管理员确认后再手工加入播放列表"
 *
 * 之前: "视频/图片"和"网页"四个按钮全是 router.push 跳到媒体页选片, 选完再跳回来 ——
 * 要换个片子得离开正在盯着的播放页, 这正是业主说的毛病。
 * 现在: 播放列表内嵌本页, 点一下就切; 上传也在本页 (传完只入媒体库, **不自动进列表**,
 * 要人工点"加入列表" —— 业主明确要求媒体库内容需确认后才进列表)。
 *
 * 投影仪 (slot2) 已拆到独立页 ProjectorPage, 本页只管 LED (slot1)。
 */
import { computed, onMounted, onScopeDispose, ref , watch } from 'vue';
import { identityGeneration, captureIdentityGuard, createLatestIdentityRead } from '@/services/identity-boundary';
import { ElMessage, ElMessageBox, ElScrollbar } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, MonitorPlay, Play, Pause, Square, SkipBack, SkipForward,
  Upload, ListMusic, History, Pencil, Trash2, Plus, Repeat, Repeat1, AlertTriangle, GripVertical, FolderOpen, X,
  Globe,
  ChevronLeft, ChevronRight, Power, ZoomIn, ZoomOut, Maximize, RefreshCw, RotateCcw,
} from 'lucide-vue-next';
import { usePlaybackStore } from '@/stores/playback';
import {
  listPlaylist, addToPlaylist, renamePlaylistItem, removeFromPlaylist, reorderPlaylist,
  listHistory, setDisplayFit, setDocPage, setDocZoom, publishWelcome, publishParkDashboard,
  type DisplayFit, type PlaylistItemView, type PlaybackHistoryView,
} from '@/services/playback.service';
import { projectorService } from '@/services/projector.service';
import {
  fetchWelcomeSchemes, publishWelcomeScheme, removeWelcomeAsset, saveWelcomeSchemes,
  type WelcomeScheme, type WelcomeSchemesSnapshot,
} from '@/services/system-branding.service';
import { absUrl } from '@/services/http';
import { useAdminUnlock } from '@/composables/useAdminUnlock';
import { powerCircuitsService, type PowerCircuitView } from '@/services/power-circuits.service';
import { mediaService, MEDIA_UPLOAD_ACCEPT } from '@/services/media.service';
import { ledService } from '@/services/led.service';
import { parkOpsControlService } from '@/services/park-ops-control.service';
import {
  addWelcomeImageAsset,
  classifyWelcomeImageAssets,
  type WelcomeImageAsset,
} from '@/features/welcome-image-assets';
import { normalizeWelcomeBackground } from '@/features/welcome-background-image';

const props = defineProps<{
  /** 1 = LED 大屏 (HDMI1), 2 = 投影仪 (HDMI2) */
  slot: 1 | 2;
  title: string;
  /**
   * 显示设备的 code (如 LED-NOVA-1)。2026-07-28 起"输入源"一栏两页统一显示,
   * deviceId 只影响切源时的"链路拉正"动作: slot1 传了它才能把诺瓦控制器切回
   * HDMI1 (slot2 的链路拉正走融合器 showHdmi, 不需要 deviceId)。
   */
  deviceId?: string;
  /**
   * 本屏的电源回路 code, 传了就显示电源开关 (2026-07-25)。
   * 支持逗号分隔多个 code 一键联动 (2026-07-26): LED=1f-led / 投影=seq-5,seq-4
   * (投影仪 + 视频拼接器同开同关)。
   */
  powerCode?: string;
  /**
   * 追加进电源开关分组的"按名定位"规则 (2026-07-28 业主: 页面开关还要带上时序器
   * 里的功放路——LED 页带「LED大屏功放」, 投影页带「投影仪功放」。功放接在第几路
   * 是业主在电源页改名标定的, code 写不死, 名字才是可靠的锚)。
   * 每条规则 = 关键词数组, 时序器(audio-seq)回路名同时含数组里全部关键词即入组;
   * 多条规则任一命中即可。没命中一路也不报错 (业主还没改名时开关照常控其余回路)。
   * 分组语义 = 同开同关, 仅作用于本页面这个开关; 电源页各路仍单独控制。
   */
  powerNameGroups?: string[][];
}>();
const SLOT = computed(() => props.slot);

const router = useRouter();
function goBack(): void { router.push({ name: 'dashboard' }); }

const { ensureAdmin } = useAdminUnlock();
const playbackStore = usePlaybackStore();
const ch = computed(() => (props.slot === 1 ? playbackStore.slot1 : playbackStore.slot2));

const playlist = ref<PlaylistItemView[]>([]);
const history = ref<PlaybackHistoryView[]>([]);
const busy = ref(false);
const beginListRead = createLatestIdentityRead(() => !consoleDisposed);

async function loadAll(): Promise<void> {
  if (consoleDisposed) return;
  const currentRead = beginListRead();
  const currentAction = captureConsoleAction();
  const slot = SLOT.value;
  try {
    const [pl, his] = await Promise.all([listPlaylist(slot), listHistory(slot)]);
    if (!currentRead() || !currentAction()) return;
    playlist.value = pl;
    history.value = his;
  } catch (e) {
    if (!currentRead() || !currentAction()) return;
    playlist.value = [];
    history.value = [];
    ElMessage.error(`加载播放列表失败: ${(e as Error).message}`);
  }
}
// 审计 P1: 列表/历史只在本页操作后刷新 — 其他终端改动看不到。跟着在播媒体
// 的 WS 变化节流重拉 (playback store 是 WS 实时的, 以它为信号源)。
let reloadT: number | undefined;
watch(SLOT, () => {
  playlist.value = [];
  history.value = [];
  window.clearTimeout(reloadT);
  void loadAll();
}, { flush: 'sync' });
watch(() => ch.value?.currentMediaId, () => {
  window.clearTimeout(reloadT);
  reloadT = window.setTimeout(() => { void loadAll(); }, 800);
});

// ============ 文档翻页 (2026-07-25 文档投屏) ============
const isDocPlaying = computed(() => ch.value?.currentMediaKind === 'doc' && !!ch.value?.currentMediaId);
const docPage = computed(() => ch.value?.docPage ?? 1);
const docTotal = computed(() => ch.value?.currentMediaPageCount ?? null);
/** 文档画面缩放 (2026-07-29 业主: PPT 要能全屏/放大缩小/退出):
 *  改 docZoom → WS → PPT 守护重摆放映窗口 / kiosk PDF 跟随 CSS 缩放。
 *  100=铺满整屏 ("全屏"按钮即回 100); 步进 ±15, 范围 50-200。 */
const docZoom = computed(() => ch.value?.docZoom ?? 100);
let zoomBusy = false;
async function applyDocZoom(z: number): Promise<void> {
  if (zoomBusy) return;
  const session = ch.value?.playbackSession;
  if (!session) { ElMessage.warning('请刷新播放状态后重试'); return; }
  zoomBusy = true;
  try {
    const v = await setDocZoom(SLOT.value, z, session);
    playbackStore.handleWs({ type: 'playback_channel_changed', data: v } as never);
  } catch (e) {
    ElMessage.error(`缩放失败: ${(e as Error).message}`);
  } finally { zoomBusy = false; }
}
/** 退出放映 — 结束文档放映, 屏幕回到播放器待机/原内容 (对应业主"退出全屏") */
async function exitDocShow(): Promise<void> {
  const session = ch.value?.playbackSession;
  const slot = SLOT.value;
  const generation = identityGeneration();
  if (!session) { ElMessage.warning('请刷新播放状态后重试'); return; }
  try {
    await ElMessageBox.confirm(`退出文档放映?${props.title}将回到待机画面。`, '退出放映',
      { type: 'warning', confirmButtonText: '退出', cancelButtonText: '取消' });
  } catch { return; }
  if (consoleDisposed || generation !== identityGeneration() || slot !== SLOT.value) return;
  await stopPlayback(session);
}
let consoleDisposed = false;
onScopeDispose(() => {
  consoleDisposed = true;
  window.clearTimeout(reloadT);
  playlist.value = [];
  history.value = [];
});
function captureConsoleAction(): () => boolean {
  const slot = SLOT.value;
  return captureIdentityGuard(() => !consoleDisposed && SLOT.value === slot);
}
let pageBusy = false;
async function gotoDocPage(p: number): Promise<void> {
  if (pageBusy) return;
  const session = ch.value?.playbackSession;
  if (!session) { ElMessage.warning('请刷新播放状态后重试'); return; }
  const max = docTotal.value ?? Number.MAX_SAFE_INTEGER;
  const target = Math.max(1, Math.min(p, max));
  if (target === docPage.value) return;
  pageBusy = true;
  try {
    const v = await setDocPage(SLOT.value, target, session);
    playbackStore.handleWs({ type: 'playback_channel_changed', data: v } as never);
  } catch (e) {
    ElMessage.error(`翻页失败: ${(e as Error).message}`);
  } finally { pageBusy = false; }
}

// ============ 屏幕电源开关 ============
// powerCode 支持逗号分隔多个回路 code (2026-07-26 业主: 投影仪与视频拼接器
// 同时工作, 一个开关同开同关 —— 投影页传 "seq-5,seq-4")。开关状态 = 全部通电
// 才亮; 拨动 = 所有回路一起 on/off (时序器自身按各路延时依次动作, 保护设备)。
// 2026-07-28 业主: 分组再并入按名定位的功放路 (powerNameGroups), 同开同关。
const powerCircuits = ref<PowerCircuitView[]>([]);
async function loadPowerCircuit(): Promise<void> {
  if (!props.powerCode && !props.powerNameGroups?.length) return;
  const codes = (props.powerCode ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const list = await powerCircuitsService.list();
    const byCode = codes
      .map((code) => list.find((c) => c.code === code))
      .filter((c): c is PowerCircuitView => !!c);
    const byName = (props.powerNameGroups ?? []).length
      ? list.filter((c) =>
          c.category === 'audio-seq'
          && (props.powerNameGroups ?? []).some((kws) => kws.every((k) => c.name.includes(k))))
      : [];
    // code 命中优先保序, 按名命中追加, 按 id 去重
    const seen = new Set<number>();
    powerCircuits.value = [...byCode, ...byName].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  } catch { /* 电源子系统不可达时不显示开关 */ }
}
const powerAllOn = computed(
  () => powerCircuits.value.length > 0 && powerCircuits.value.every((c) => c.reading.on),
);
const powerBusy = ref(false);
async function togglePower(): Promise<void> {
  if (!powerCircuits.value.length || powerBusy.value) return;
  const isCurrent = captureConsoleAction();
  const on = powerAllOn.value;
  if (on) {
    try {
      await ElMessageBox.confirm(`确定断开${props.title}电源?画面会熄灭。`, '断电确认',
        { type: 'warning', confirmButtonText: '断电', cancelButtonText: '取消' });
    } catch { return; }
  }
  if (!isCurrent()) return;
  powerBusy.value = true;
  try {
    // 逐个下发 (共用一条串口链路, 并发会互踩); 部分失败也把能做的做完, 最后统一报
    const failed: string[] = [];
    for (let i = 0; i < powerCircuits.value.length; i += 1) {
      if (!isCurrent()) return;
      const c = powerCircuits.value[i];
      try {
        powerCircuits.value[i] = on ? await powerCircuitsService.off(c.id) : await powerCircuitsService.on(c.id);
      } catch (e) {
        failed.push(`${c.name}: ${(e as Error).message}`);
      }
    }
    if (!isCurrent()) return;
    if (failed.length) {
      ElMessage.error(`部分电源操作失败: ${failed.join('; ')}`);
    } else {
      ElMessage.success(on ? `${props.title}电源已断开` : `${props.title}电源已接通`);
    }
  } finally { powerBusy.value = false; }
}

onMounted(() => {
  void loadPowerCircuit(); void loadAll(); });

/** 当前在播的是列表里的哪一条 (用 mediaId 比, 不信 index —— 可能从媒体库临时推过片子) */
const currentInList = computed(() =>
  playlist.value.find((x) => x.mediaId === ch.value?.currentMediaId) ?? null);

// ============ 播放控制 (业主: "不能一直无脑播放, 保持用户控制状态") ============
async function playItem(it: PlaylistItemView): Promise<void> {
  if (it.missing) { ElMessage.warning('这个媒体已被删除, 先从列表移除'); return; }
  busy.value = true;
  try {
    await playbackStore.publish(SLOT.value, it.mediaId, 'loop');
    await loadAll();                       // 刷新历史
    ElMessage.success(`正在播放「${it.title}」`);
  } catch (e) {
    ElMessage.error(`播放失败: ${(e as Error).message}`);
  } finally { busy.value = false; }
}

/**
 * 播放 / 暂停 / 继续 —— 一个按钮三态。
 *
 * 待机时按下 = **接着上次那个继续播** (业主: "要保持最后状态, 不要每次都丢状态")。
 * 上次播的从**播放历史**里取 (history[0] 就是最近一次), 它还在列表里就播它;
 * 不在了 (被移出列表/媒体被删) 就退回列表第一个 —— 总能播起来, 不会按了没反应。
 */
async function togglePause(): Promise<void> {
  // 待机 -> 起播
  if (!ch.value?.currentMediaId) {
    if (playlist.value.length === 0) {
      ElMessage.warning('播放列表是空的, 先上传内容或从历史里加回来');
      return;
    }
    const lastId = history.value.find((h) => !h.missing)?.mediaId;
    const target = playlist.value.find((x) => x.mediaId === lastId && !x.missing)
      ?? playlist.value.find((x) => !x.missing);
    if (!target) { ElMessage.warning('列表里的媒体都已被删除'); return; }
    await playItem(target);
    return;
  }
  // 播放中 -> 暂停; 已暂停 -> 继续
  busy.value = true;
  try {
    if (ch.value.paused) await playbackStore.resume(SLOT.value);
    else await playbackStore.pause(SLOT.value);
  } catch (e) {
    ElMessage.error(`操作失败: ${(e as Error).message}`);
  } finally { busy.value = false; }
}

/** 随时终止 (业主: "播放过程中应该随时可以点击终止") */
async function stopPlayback(expectedSession = ch.value?.playbackSession): Promise<void> {
  if (!expectedSession) { ElMessage.warning('请刷新播放状态后重试'); return; }
  busy.value = true;
  try {
    await playbackStore.stop(SLOT.value, expectedSession);
    ElMessage.success(`已终止, ${props.title}回到待机`);
  } catch (e) {
    ElMessage.error(`终止失败: ${(e as Error).message}`);
  } finally { busy.value = false; }
}

/** 画面铺放模式 (业主 2026-07-25): 下拉选择, 默认铺满; 后端持久 + WS 推给 kiosk 即时生效 */
async function changeFit(fit: DisplayFit): Promise<void> {
  busy.value = true;
  try {
    await setDisplayFit(SLOT.value, fit);
    await playbackStore.load();   // WS 也会推, 这里再拉一次保证本页立即一致
    const label = fit === 'fill' ? '铺满屏幕' : fit === 'contain' ? '保持比例' : '裁切铺满';
    ElMessage.success(`画面铺放已切为「${label}」`);
  } catch (e) {
    ElMessage.error(`切换铺放模式失败: ${(e as Error).message}`);
  } finally { busy.value = false; }
}

async function step(dir: 'next' | 'prev'): Promise<void> {
  busy.value = true;
  try {
    await (dir === 'next' ? playbackStore.next(SLOT.value) : playbackStore.prev(SLOT.value));
    await loadAll();
  } catch (e) {
    // 列表空时后端返回 400 + 人话, 直接透给业主
    ElMessage.warning((e as Error).message);
  } finally { busy.value = false; }
}

// ============ 播放列表维护 ============
const editingId = ref<number | null>(null);
const editingText = ref('');
// 编辑框一出现就自动聚焦并全选 (原来没聚焦, 得手动点进去, 而父项是 draggable
// 又会把点击当拖拽 —— 于是"点不进/存不了/退不出"。见下 startRename 的 draggable 处理)
const vFocus = {
  mounted(el: HTMLInputElement) { el.focus(); el.select(); },
};
async function startRename(it: PlaylistItemView): Promise<void> {
  if (!(await ensureAdmin('改名'))) return;
  editingId.value = it.id;
  editingText.value = it.title;
}
async function commitRename(it: PlaylistItemView): Promise<void> {
  const title = editingText.value.trim();
  editingId.value = null;
  if (!title || title === it.title) return;
  const before = it.title;
  it.title = title;                        // 乐观
  try {
    await renamePlaylistItem(it.id, title);
    ElMessage.success('已改名 (只改列表显示名, 媒体库原文件不变)');
  } catch (e) {
    it.title = before;
    ElMessage.error(`改名失败: ${(e as Error).message}`);
  }
}

async function removeItem(it: PlaylistItemView): Promise<void> {
  const isCurrent = captureConsoleAction();
  try {
    await ElMessageBox.confirm(`把「${it.title}」移出播放列表? (媒体库里的文件不会删)`, '移出播放列表', { type: 'warning' });
  } catch { return; }
  if (!isCurrent()) return;
  try {
    await removeFromPlaylist(it.id);
    if (!isCurrent()) return;
    await loadAll();
    ElMessage.success('已移出播放列表');
  } catch (e) {
    if (isCurrent()) ElMessage.error(`移出失败: ${(e as Error).message}`);
  }
}

/** 从历史里一键加回列表 (现场常有"刚才那个再放一遍") */
async function addFromHistory(h: PlaybackHistoryView): Promise<void> {
  if (h.missing) { ElMessage.warning('这个媒体已被删除'); return; }
  try {
    await addToPlaylist(SLOT.value, h.mediaId);
    await loadAll();
    ElMessage.success(`「${h.mediaName}」已加入播放列表`);
  } catch (e) {
    ElMessage.error(`加入失败: ${(e as Error).message}`);
  }
}

// ============ 从媒体库选内容加入播放列表 ============
/**
 * 2026-07-17 业主: "昨天上传的视频内容是MP4格式, 但不能发送到屏幕播放, 是什么原因?"
 *                 "现在LED大屏之前的欢迎页和网页选择项不见了"
 *
 * 真因 (我挖的坑): 我重做这个页面时, 把老版"视频/图片""网页"两个按钮 (跳媒体页选片)
 * 砍掉换成了播放列表, 但**只留了两条进列表的路**: 上传新的、从播放历史加回。
 * 于是**之前就躺在媒体库里的东西, 既不在历史里(从没播过)、又没法从媒体库选 —— 根本
 * 进不了播放列表**, 自然"发送不到屏幕"。查证过: 那个 MP4 上传成功、文件在、HTTP 200、
 * 编码是 avc1(H.264) Edge 原生能播 —— **格式从来不是原因, 是没有入口**。
 * 网页同理 (网页在媒体库里就是 kind='webpage' 的条目, PlayerPage 本来就支持渲染)。
 *
 * 补上这个选择器, 三个问题一起解决, 而且**不跳走**。
 */
/** 手机上列表/历史二选一显示; 平板以上两栏并排, 这个值不起作用 */
const mobTab = ref<'list' | 'his'>('list');
const pickerOpen = ref(false);
const pickerKind = ref<'video' | 'image' | 'webpage'>('video');
const assets = ref<Array<{ id: number; originalName: string; kind: string }>>([]);
const pickerLoading = ref(false);
const beginAssetRead = createLatestIdentityRead(() => !consoleDisposed && pickerOpen.value);
watch(SLOT, () => { pickerOpen.value = false; }, { flush: 'sync' });
watch(pickerOpen, open => {
  if (!open) {
    beginAssetRead(); // Invalidate even if the dialog is reopened before completion.
    assets.value = [];
    pickerLoading.value = false;
  }
}, { flush: 'sync' });
onScopeDispose(() => { assets.value = []; });

async function openPicker(): Promise<void> {
  pickerOpen.value = true;
  await loadAssets();
}
async function loadAssets(): Promise<void> {
  if (consoleDisposed || !pickerOpen.value) return;
  const currentRead = beginAssetRead();
  const currentAction = captureConsoleAction();
  const kind = pickerKind.value;
  pickerLoading.value = true;
  assets.value = [];
  try {
    const r = await mediaService.list({ kind });
    if (!currentRead() || !currentAction() || kind !== pickerKind.value) return;
    assets.value = r.items.map((m) => ({ id: m.id, originalName: m.originalName, kind: m.kind }));
  } catch (e) {
    if (currentRead() && currentAction()) ElMessage.error(`读媒体库失败: ${(e as Error).message}`);
  } finally { if (currentRead() && currentAction()) pickerLoading.value = false; }
}
async function pickAsset(a: { id: number; originalName: string }): Promise<void> {
  if (!pickerOpen.value || pickerLoading.value || !assets.value.some(item => item.id === a.id)) return;
  const currentAction = captureConsoleAction();
  try {
    await addToPlaylist(SLOT.value, a.id);
    if (!currentAction()) return;
    await loadAll();
    if (!currentAction()) return;
    ElMessage.success(`「${a.originalName}」已加入播放列表`);
  } catch (e) {
    if (currentAction()) ElMessage.error(`加入失败: ${(e as Error).message}`);
  }
}
/** 已在列表里的不重复加 —— 让业主一眼看出哪些已经加过 */
const inPlaylist = computed(() => new Set(playlist.value.map((x) => x.mediaId)));

// ============ 输入源 (2026-07-28 业主: LED/投影两页统一 + 可选项指向明确) ============
// 三个按钮各自指向固定目标, 按了就知道播的是什么:
//   播放内容       → 本屏回到播放列表推送的画面 (GK9000 输出)
//   欢迎页·可编辑  → 媒体库内置「金湖欢迎页·动态(称谓可编辑)」网页素材 (两屏共用),
//                    文字/底图在本卡「编辑欢迎页」就地改, 保存即生效
//   欢迎页·默认    → 本屏专用尺寸的内置静态欢迎图 (slot1=LED版 / slot2=投影版), 兜底
// 欢迎页统一走 playback 推流 (kiosk 渲染), 和播放列表同一条链路 —— 当前显示什么
// 直接从通道状态读出来 (currentMediaName), 不再靠"记住自己发过什么"猜。
// 每个按钮都先把显示链路拉正 (LED: 诺瓦切回 HDMI1; 投影: 融合器回 GK9000 HDMI),
// 修掉"按了没画面"的历史坑 —— 控制器/融合器停在别的源上时推什么都看不见。
// (旧版诺瓦 'welcome' 内置 preset 入口已撤: 无法回读、内容改不了、易误切;
//  HDMI 直通选项 2026-07-18 就因误切事故被业主要求删除, 经过见 git 历史。)
const WELCOME_EDITABLE_NAME = '金湖欢迎页·动态(称谓可编辑)';
const WELCOME_DEFAULT_NAMES = ['金湖欢迎页·LED大屏.png', '金湖欢迎页·投影.png'];
const PARK_DASHBOARD_NAME = '金湖科创产业园·智慧运营总览(DEMO)';

type SourceKey = 'content' | 'park-dashboard' | 'welcome-editable' | 'welcome-default';
/** 当前源: 从通道在播媒体名判断 (内置素材按名定位, 业主改名后回退为"播放内容") */
const activeSource = computed<SourceKey | null>(() => {
  const name = ch.value?.currentMediaName;
  if (!name || !ch.value?.currentMediaId) return null;
  if (name === PARK_DASHBOARD_NAME) return 'park-dashboard';
  if (name === WELCOME_EDITABLE_NAME) return 'welcome-editable';
  if (WELCOME_DEFAULT_NAMES.includes(name)) return 'welcome-default';
  return 'content';
});
const SRC_HINTS: Record<SourceKey, string> = {
  'content': '正在播放列表内容',
  'park-dashboard': '园区综合态势与运营指标 · 点击即可投放到当前屏幕',
  'welcome-editable': '动态欢迎页 · 点「编辑欢迎页」改文字/底图, 保存即生效',
  'welcome-default': '内置静态欢迎页 (本屏专用尺寸, 不可编辑)',
};
const srcHint = computed(() => (activeSource.value ? SRC_HINTS[activeSource.value] : '当前待机 · 点按钮选择本屏显示内容'));

/** 显示链路拉正 (best-effort): 设备停在别的源上时, 推什么都看不见 */
async function ensureDisplayPath(): Promise<void> {
  try {
    if (props.slot === 1 && props.deviceId) {
      const r = await ledService.switchInput(props.deviceId, 'video');
      if (!r.ok) throw new Error(r.error || '设备未确认');
    } else if (props.slot === 2) {
      await projectorService.showHdmi();
    }
  } catch (e) {
    // 不挡欢迎页推流 —— 链路已经在正确源上时这里失败也无所谓, 只提示一声
    ElMessage.warning(`显示链路切换未确认: ${(e as Error).message}`);
  }
}

async function selectContent(): Promise<void> {
  const isCurrent = captureConsoleAction();
  if (!isCurrent()) return;
  busy.value = true;
  try {
    await ensureDisplayPath();
    if (!isCurrent()) return;
    // 正在播欢迎页时按"播放内容" = 恢复播放列表 (从下一条接着放);
    // 已经在播列表内容时只拉正链路, 不跳片
    if (activeSource.value !== 'content') {
      if (!playlist.value.length) {
        ElMessage.info('播放列表是空的 — 先从媒体库加入素材');
        return;
      }
      await playbackStore.next(SLOT.value);
    }
    if (!isCurrent()) return;
    ElMessage.success('已切到播放内容');
  } catch (e) {
    if (isCurrent()) ElMessage.error(`切换失败: ${(e as Error).message}`);
  } finally { busy.value = false; }
}

async function selectWelcome(variant: 'editable' | 'default'): Promise<void> {
  const isCurrent = captureConsoleAction();
  if (!isCurrent()) return;
  busy.value = true;
  try {
    await ensureDisplayPath();
    if (!isCurrent()) return;
    await publishWelcome(SLOT.value, variant);
    if (!isCurrent()) return;
    ElMessage.success(variant === 'editable' ? '已投放动态欢迎页 (点「编辑欢迎页」可改内容)' : '已投放默认欢迎页');
  } catch (e) {
    if (isCurrent()) ElMessage.error(`投放欢迎页失败: ${(e as Error).message}`);
  } finally { busy.value = false; }
}

async function selectParkDashboard(): Promise<void> {
  const isCurrent = captureConsoleAction();
  if (!isCurrent()) return;
  busy.value = true;
  try {
    await ensureDisplayPath();
    if (!isCurrent()) return;
    await publishParkDashboard(SLOT.value);
    if (!isCurrent()) return;
    ElMessage.success(`已将园区运营大屏投放到${props.title}`);
    void syncParkOpsState();
  } catch (e) {
    if (isCurrent()) ElMessage.error(`投放园区运营大屏失败: ${(e as Error).message}`);
  } finally { busy.value = false; }
}

// ============ 运营大屏翻页控制 (PWA播放控制卡片 → LED大屏端运营大屏) ============
const parkOpsPage = ref(0);
const parkOpsTotalPages = ref(6); // 运营大屏共6页，后端state会同步
const parkOpsAuto = ref(false);
const parkOpsBusy = ref(false);

async function parkOpsControl(action: 'next' | 'prev' | 'auto' | 'refresh'): Promise<void> {
  if (parkOpsBusy.value) return;
  parkOpsBusy.value = true;
  try {
    const state = action === 'next'
      ? await parkOpsControlService.next()
      : action === 'prev'
        ? await parkOpsControlService.prev()
        : action === 'auto'
          ? await parkOpsControlService.setAuto(!parkOpsAuto.value)
          : await parkOpsControlService.refresh();
    parkOpsPage.value = state.page;
    parkOpsAuto.value = state.autoPlay;
    parkOpsTotalPages.value = state.totalPages;
    const successMessage = action === 'next'
      ? '已切到下一页'
      : action === 'prev'
        ? '已切到上一页'
        : action === 'auto'
          ? state.autoPlay ? '自动轮播已开启' : '自动轮播已关闭'
          : '已发送强制刷新指令';
    ElMessage.success(successMessage);
  } catch (e) {
    ElMessage.error(`运营大屏控制失败: ${(e as Error).message}`);
  } finally {
    // 刷新动作增加3秒冷却时间，防止快速点击多次发送刷新请求
    if (action === 'refresh') {
      setTimeout(() => { parkOpsBusy.value = false; }, 3000);
    } else {
      parkOpsBusy.value = false;
    }
  }
}

// 投放运营大屏时同步当前状态
async function syncParkOpsState(): Promise<void> {
  try {
    const state = await parkOpsControlService.state();
    parkOpsPage.value = state.page;
    parkOpsAuto.value = state.autoPlay;
    parkOpsTotalPages.value = state.totalPages;
  } catch { /* ignore */ }
}

// ============ 欢迎页编辑器 (2026-07-28 业主: "编辑放到前端, 不用进后台") ============
// 一套 3612x1462 渲染器承载多套欢迎方案。保存只写带版本号的方案库，发布才更新
// 当前欢迎页快照；因此准备下一场接待不会误改正在播放的画面。
const welcomeEditOpen = ref(false);
const welcomeSaving = ref(false);
const welcomePublishing = ref(false);
const welcomeLoading = ref(false);
const welcomeForm = ref({
  welcomeTitle: '', welcomeGuest: '', welcomeTagline: '',
  welcomeBgMediaId: null as number | null,
  welcomeLogoMediaId: null as number | null,
});
const welcomeSchemeName = ref('');
const welcomeSchemes = ref<WelcomeScheme[]>([]);
const welcomeSchemesRevision = ref(0);
const selectedWelcomeSchemeId = ref('');
const publishedWelcomeSchemeId = ref<string | null>(null);
const LED_CANVAS_RESOLUTION = '3612x1462';
const welcomePreviewUrl = `${import.meta.env.DEV ? '/' : import.meta.env.BASE_URL}welcome/index.html?preview=1`;
const welcomePreviewFrame = ref<HTMLIFrameElement | null>(null);
const logoAssets = ref<WelcomeImageAsset[]>([]);
const bgAssets = ref<WelcomeImageAsset[]>([]);
const compatibleBgAssets = computed(() =>
  bgAssets.value.filter((item) => item.resolution?.toLowerCase() === LED_CANVAS_RESOLUTION),
);
const rejectedBgAssetCount = computed(() => bgAssets.value.length - compatibleBgAssets.value.length);
const incompatibleSelectedBackground = ref(false);
const incompatibleSelectedLogo = ref(false);
const welcomeBgUploadInput = ref<HTMLInputElement | null>(null);
const welcomeLogoUploadInput = ref<HTMLInputElement | null>(null);
const welcomeAssetUploading = ref<'background' | 'logo' | null>(null);
const welcomeAssetUploadPct = ref(0);
const welcomeAssetDeletingId = ref<number | null>(null);
const lastWelcomeSaveRevision = ref<number | null>(null);
const LAST_WELCOME_SCHEME_KEY = 'sc.welcome.lastSelectedSchemeId';

function rememberedWelcomeSchemeId(): string {
  try { return window.localStorage.getItem(LAST_WELCOME_SCHEME_KEY) ?? ''; }
  catch { return ''; }
}

function rememberWelcomeSchemeId(id: string): void {
  if (!id) return;
  try { window.localStorage.setItem(LAST_WELCOME_SCHEME_KEY, id); }
  catch { /* private mode or disabled storage */ }
}

function pushWelcomePreview(): void {
  const selected = compatibleBgAssets.value.find((item) => item.id === welcomeForm.value.welcomeBgMediaId);
  const selectedLogo = logoAssets.value.find((item) => item.id === welcomeForm.value.welcomeLogoMediaId);
  welcomePreviewFrame.value?.contentWindow?.postMessage({
    type: 'smart-control:welcome-preview',
    payload: {
      welcomeTitle: welcomeForm.value.welcomeTitle,
      welcomeGuest: welcomeForm.value.welcomeGuest,
      welcomeTagline: welcomeForm.value.welcomeTagline,
      welcomeBgUrl: selected ? absUrl(selected.fileUrl) : null,
      welcomeLogoUrl: selectedLogo ? absUrl(selectedLogo.fileUrl) : null,
    },
  }, window.location.origin);
}

watch(welcomeForm, pushWelcomePreview, { deep: true });

function applyWelcomeScheme(id: string): void {
  const scheme = welcomeSchemes.value.find((item) => item.id === id);
  if (!scheme) return;
  selectedWelcomeSchemeId.value = id;
  rememberWelcomeSchemeId(id);
  welcomeSchemeName.value = scheme.name;
  incompatibleSelectedBackground.value = scheme.welcomeBgMediaId !== null
    && !compatibleBgAssets.value.some((item) => item.id === scheme.welcomeBgMediaId);
  incompatibleSelectedLogo.value = scheme.welcomeLogoMediaId !== null
    && !logoAssets.value.some((item) => item.id === scheme.welcomeLogoMediaId);
  welcomeForm.value = {
    welcomeTitle: scheme.welcomeTitle ?? '',
    welcomeGuest: scheme.welcomeGuest ?? '',
    welcomeTagline: scheme.welcomeTagline ?? '',
    welcomeBgMediaId: incompatibleSelectedBackground.value ? null : scheme.welcomeBgMediaId,
    welcomeLogoMediaId: incompatibleSelectedLogo.value ? null : scheme.welcomeLogoMediaId,
  };
}

function syncSelectedWelcomeDraft(): boolean {
  const index = welcomeSchemes.value.findIndex((item) => item.id === selectedWelcomeSchemeId.value);
  if (index < 0) return false;
  const name = welcomeSchemeName.value.trim();
  if (!name) {
    ElMessage.error('方案名称不能为空');
    return false;
  }
  if (welcomeForm.value.welcomeBgMediaId !== null
    && !compatibleBgAssets.value.some((item) => item.id === welcomeForm.value.welcomeBgMediaId)) {
    ElMessage.error(`欢迎页底图必须是 LED 原生分辨率 ${LED_CANVAS_RESOLUTION}`);
    return false;
  }
  if (welcomeForm.value.welcomeLogoMediaId !== null
    && !logoAssets.value.some((item) => item.id === welcomeForm.value.welcomeLogoMediaId)) {
    ElMessage.error('欢迎页 Logo 必须是已上传的图片');
    return false;
  }
  welcomeSchemes.value[index] = {
    id: selectedWelcomeSchemeId.value,
    name,
    welcomeTitle: welcomeForm.value.welcomeTitle.trim() || null,
    welcomeGuest: welcomeForm.value.welcomeGuest.trim() || null,
    welcomeTagline: welcomeForm.value.welcomeTagline.trim() || null,
    welcomeBgMediaId: welcomeForm.value.welcomeBgMediaId,
    welcomeLogoMediaId: welcomeForm.value.welcomeLogoMediaId,
  };
  return true;
}

function selectWelcomeScheme(id: string): void {
  if (id === selectedWelcomeSchemeId.value) return;
  if (!syncSelectedWelcomeDraft()) return;
  applyWelcomeScheme(id);
}

async function openWelcomeEditor(): Promise<void> {
  if (!(await ensureAdmin('编辑欢迎页'))) return;
  welcomeEditOpen.value = true;
  welcomeLoading.value = true;
  lastWelcomeSaveRevision.value = null;
  try {
    const [snapshot, imgs] = await Promise.all([
      fetchWelcomeSchemes(),
      mediaService.list({ kind: 'image' }),
    ]);
    const assets = imgs.items.map((m) => ({
      id: m.id,
      originalName: m.originalName,
      thumbUrl: m.thumbUrl,
      fileUrl: m.fileUrl,
      resolution: m.resolution,
      remark: m.remark,
      source: m.source,
    }));
    const libraries = classifyWelcomeImageAssets(assets, snapshot.config.schemes);
    bgAssets.value = libraries.backgrounds;
    logoAssets.value = libraries.logos;
    welcomeSchemes.value = snapshot.config.schemes.map((item) => ({ ...item }));
    welcomeSchemesRevision.value = snapshot.revision;
    publishedWelcomeSchemeId.value = snapshot.publishedSchemeId;
    const preferredId = selectedWelcomeSchemeId.value || rememberedWelcomeSchemeId();
    const initialId = snapshot.config.schemes.some((item) => item.id === preferredId)
      ? preferredId
      : (snapshot.publishedSchemeId ?? snapshot.config.schemes[0].id);
    applyWelcomeScheme(initialId);
  } catch (e) {
    ElMessage.error(`读取欢迎页配置失败: ${(e as Error).message}`);
  } finally { welcomeLoading.value = false; }
}

function pickWelcomeAsset(kind: 'background' | 'logo'): void {
  if (welcomeAssetUploading.value) return;
  (kind === 'background' ? welcomeBgUploadInput.value : welcomeLogoUploadInput.value)?.click();
}

async function onWelcomeAssetPicked(kind: 'background' | 'logo', event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    ElMessage.error('请选择 PNG、JPG 或 WebP 图片');
    return;
  }
  if (!(await ensureAdmin(kind === 'background' ? '上传欢迎页底图' : '上传欢迎页 Logo'))) return;
  const targetSchemeId = selectedWelcomeSchemeId.value;
  const isCurrent = captureConsoleAction();
  welcomeAssetUploading.value = kind;
  welcomeAssetUploadPct.value = 0;
  try {
    const uploadFile = kind === 'background'
      ? await normalizeWelcomeBackground(file)
      : file;
    const uploaded = await mediaService.upload(uploadFile, {
      remark: kind === 'background' ? '欢迎页底图' : '欢迎页 Logo',
      onProgress: (pct: number) => { welcomeAssetUploadPct.value = pct; },
    });
    if (!isCurrent()) return;
    if (uploaded.kind !== 'image') throw new Error('上传文件不是可用图片');
    const access = await mediaService.access(uploaded.id);
    if (!isCurrent()) return;
    const asset: WelcomeImageAsset = {
      id: uploaded.id,
      originalName: uploaded.originalName,
      thumbUrl: null,
      fileUrl: access.url,
      resolution: uploaded.resolution,
      remark: uploaded.remark,
      source: uploaded.source,
    };
    const libraries = addWelcomeImageAsset(
      { backgrounds: bgAssets.value, logos: logoAssets.value },
      kind,
      asset,
    );
    bgAssets.value = libraries.backgrounds;
    logoAssets.value = libraries.logos;
    if (selectedWelcomeSchemeId.value !== targetSchemeId) {
      ElMessage.info('图片已上传到媒体库；当前已切换方案，因此没有自动绑定');
      return;
    }
    if (kind === 'background') {
      if (asset.resolution?.toLowerCase() !== LED_CANVAS_RESOLUTION) {
        ElMessage.warning(`底图必须是 ${LED_CANVAS_RESOLUTION}，当前为 ${asset.resolution || '未知尺寸'}；图片已保存在媒体库，但没有绑定`);
        return;
      }
      welcomeForm.value.welcomeBgMediaId = asset.id;
      incompatibleSelectedBackground.value = false;
      ElMessage.success('底图已转换为 LED 原生尺寸并选中，保存方案后保留');
    } else {
      welcomeForm.value.welcomeLogoMediaId = asset.id;
      incompatibleSelectedLogo.value = false;
      ElMessage.success('Logo 已上传并选中，保存方案后保留');
    }
  } catch (error) {
    ElMessage.error(`上传失败: ${(error as Error).message}`);
  } finally {
    welcomeAssetUploading.value = null;
    welcomeAssetUploadPct.value = 0;
  }
}

async function selectWelcomeBackground(asset: WelcomeImageAsset): Promise<void> {
  if (welcomeAssetUploading.value || welcomeAssetDeletingId.value !== null) return;
  if (asset.resolution?.toLowerCase() === LED_CANVAS_RESOLUTION) {
    welcomeForm.value.welcomeBgMediaId = asset.id;
    incompatibleSelectedBackground.value = false;
    return;
  }
  if (!(await ensureAdmin('转换欢迎页底图'))) return;
  const targetSchemeId = selectedWelcomeSchemeId.value;
  const isCurrent = captureConsoleAction();
  welcomeAssetUploading.value = 'background';
  welcomeAssetUploadPct.value = 0;
  try {
    const access = await mediaService.access(asset.id);
    const response = await fetch(absUrl(access.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`读取原底图失败 (${response.status})`);
    const blob = await response.blob();
    const source = new File([blob], asset.originalName, {
      type: blob.type || 'image/jpeg',
      lastModified: Date.now(),
    });
    const normalized = await normalizeWelcomeBackground(source);
    const uploaded = await mediaService.upload(normalized, {
      remark: '欢迎页底图',
      onProgress: (pct: number) => { welcomeAssetUploadPct.value = pct; },
    });
    if (!isCurrent()) return;
    if (uploaded.kind !== 'image' || uploaded.resolution?.toLowerCase() !== LED_CANVAS_RESOLUTION) {
      throw new Error(`服务器未确认 ${LED_CANVAS_RESOLUTION} 底图`);
    }
    const uploadedAccess = await mediaService.access(uploaded.id);
    if (!isCurrent()) return;
    const converted: WelcomeImageAsset = {
      id: uploaded.id,
      originalName: uploaded.originalName,
      thumbUrl: null,
      fileUrl: uploadedAccess.url,
      resolution: uploaded.resolution,
      remark: uploaded.remark,
      source: uploaded.source,
    };
    const libraries = addWelcomeImageAsset(
      { backgrounds: bgAssets.value, logos: logoAssets.value },
      'background',
      converted,
    );
    bgAssets.value = libraries.backgrounds;
    logoAssets.value = libraries.logos;
    if (selectedWelcomeSchemeId.value !== targetSchemeId) {
      ElMessage.info('底图已转换保存；当前已切换方案，因此没有自动绑定');
      return;
    }
    welcomeForm.value.welcomeBgMediaId = converted.id;
    incompatibleSelectedBackground.value = false;
    ElMessage.success('旧底图已转换为 LED 原生尺寸并选中，保存方案后生效');
  } catch (error) {
    ElMessage.error(`底图转换失败: ${(error as Error).message}`);
  } finally {
    welcomeAssetUploading.value = null;
    welcomeAssetUploadPct.value = 0;
  }
}

async function deleteWelcomeImage(kind: 'background' | 'logo', asset: WelcomeImageAsset): Promise<void> {
  if (asset.source === 'system' || welcomeAssetDeletingId.value !== null) return;
  if (!(await ensureAdmin(kind === 'background' ? '删除欢迎页底图' : '删除欢迎页 Logo'))) return;
  const referencedCount = welcomeSchemes.value.filter((scheme) =>
    kind === 'background'
      ? scheme.welcomeBgMediaId === asset.id
      : scheme.welcomeLogoMediaId === asset.id,
  ).length;
  const referenceHint = referencedCount
    ? `\n该图片已被 ${referencedCount} 套方案使用，删除后这些方案会自动改用默认${kind === 'background' ? '底图' : '场馆 Logo'}。`
    : '';
  try {
    await ElMessageBox.confirm(
      `确定永久删除“${asset.originalName}”吗？${referenceHint}`,
      kind === 'background' ? '删除欢迎页底图' : '删除欢迎页 Logo',
      {
        confirmButtonText: '删除图片',
        cancelButtonText: '取消',
        type: 'warning',
        modalClass: 'welcome-image-delete-confirm',
      },
    );
  } catch { return; }

  const selectedId = selectedWelcomeSchemeId.value;
  const isCurrent = captureConsoleAction();
  welcomeAssetDeletingId.value = asset.id;
  lastWelcomeSaveRevision.value = null;
  try {
    const result = await removeWelcomeAsset(asset.id, welcomeSchemesRevision.value);
    if (!isCurrent()) return;
    welcomeSchemes.value = result.schemes.config.schemes.map((item) => ({ ...item }));
    welcomeSchemesRevision.value = result.schemes.revision;
    publishedWelcomeSchemeId.value = result.schemes.publishedSchemeId;
    bgAssets.value = bgAssets.value.filter((item) => item.id !== asset.id);
    logoAssets.value = logoAssets.value.filter((item) => item.id !== asset.id);
    applyWelcomeScheme(
      welcomeSchemes.value.some((item) => item.id === selectedId)
        ? selectedId
        : welcomeSchemes.value[0].id,
    );
    ElMessage.success(result.cleanupPending ? '图片记录已删除，服务器正在清理文件' : '图片已删除');
  } catch (error) {
    ElMessage.error(`删除失败: ${(error as Error).message}`);
  } finally {
    welcomeAssetDeletingId.value = null;
  }
}

async function persistWelcomeSchemes(checkAdmin = true): Promise<WelcomeSchemesSnapshot | null> {
  if (!syncSelectedWelcomeDraft()) return null;
  if (checkAdmin && !(await ensureAdmin('保存欢迎方案'))) return null;
  welcomeSaving.value = true;
  try {
    const selectedId = selectedWelcomeSchemeId.value;
    const saved = await saveWelcomeSchemes(
      { version: 1, schemes: welcomeSchemes.value },
      welcomeSchemesRevision.value,
    );
    // A 200 response is not enough: immediately read the server document back so
    // the UI cannot claim success while displaying a stale or different revision.
    const confirmed = await fetchWelcomeSchemes();
    if (confirmed.revision !== saved.revision
      || confirmed.checksum !== saved.checksum
      || JSON.stringify(confirmed.config) !== JSON.stringify(saved.config)) {
      throw new Error('服务器回读结果与本次保存不一致，请重新打开后再保存');
    }
    welcomeSchemes.value = confirmed.config.schemes.map((item) => ({ ...item }));
    welcomeSchemesRevision.value = confirmed.revision;
    publishedWelcomeSchemeId.value = confirmed.publishedSchemeId;
    lastWelcomeSaveRevision.value = confirmed.revision;
    applyWelcomeScheme(selectedId);
    return confirmed;
  } catch (e) {
    ElMessage.error(`保存失败: ${(e as Error).message}`);
    return null;
  } finally { welcomeSaving.value = false; }
}

async function saveWelcomeScheme(): Promise<void> {
  const schemeName = welcomeSchemeName.value.trim();
  const saved = await persistWelcomeSchemes();
  if (saved) {
    ElMessage.success(`“${schemeName}”已保存到服务器方案库（版本 ${saved.revision}），当前 LED 画面未切换`);
  }
}

async function publishSelectedWelcomeScheme(): Promise<void> {
  if (!(await ensureAdmin('发布欢迎页'))) return;
  if (!(await persistWelcomeSchemes(false))) return;
  welcomePublishing.value = true;
  try {
    const selectedId = selectedWelcomeSchemeId.value;
    const selected = welcomeSchemes.value.find((item) => item.id === selectedId);
    if (!selected) throw new Error('当前方案不存在，请重新打开编辑器');
    const published = await publishWelcomeScheme(selectedId, welcomeSchemesRevision.value);
    const confirmed = published.branding.welcomeTitle === selected.welcomeTitle
      && published.branding.welcomeGuest === selected.welcomeGuest
      && published.branding.welcomeTagline === selected.welcomeTagline
      && published.branding.welcomeBgMediaId === selected.welcomeBgMediaId
      && published.branding.welcomeLogoMediaId === selected.welcomeLogoMediaId;
    if (!confirmed) throw new Error('服务器未确认发布结果，原大屏画面保持不变，请重试');
    publishedWelcomeSchemeId.value = selectedId;
    let refreshFailed = false;
    if (activeSource.value === 'welcome-editable') {
      try { await publishWelcome(SLOT.value, 'editable'); }
      catch { refreshFailed = true; }
    }
    if (refreshFailed) ElMessage.warning('方案已发布；大屏重推失败，将在轮询后自动更新');
    else ElMessage.success('方案已发布到 LED 大屏');
  } catch (e) {
    ElMessage.error(`发布失败: ${(e as Error).message}`);
  } finally { welcomePublishing.value = false; }
}

function duplicateWelcomeScheme(): void {
  if (!syncSelectedWelcomeDraft()) return;
  if (welcomeSchemes.value.length >= 20) {
    ElMessage.warning('最多保存 20 套欢迎方案');
    return;
  }
  const source = welcomeSchemes.value.find((item) => item.id === selectedWelcomeSchemeId.value);
  if (!source) return;
  const copy: WelcomeScheme = {
    ...source,
    id: `scheme-${Date.now().toString(36)}`,
    name: `${source.name} 副本`.slice(0, 40),
  };
  welcomeSchemes.value.push(copy);
  applyWelcomeScheme(copy.id);
}

async function deleteWelcomeScheme(): Promise<void> {
  if (welcomeSchemes.value.length <= 1) {
    ElMessage.warning('至少保留一套欢迎方案');
    return;
  }
  if (selectedWelcomeSchemeId.value === publishedWelcomeSchemeId.value) {
    ElMessage.warning('当前正在使用这套方案，请先发布另一套方案');
    return;
  }
  try {
    await ElMessageBox.confirm(`确定删除“${welcomeSchemeName.value}”吗？`, '删除欢迎方案', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
    });
  } catch { return; }
  const index = welcomeSchemes.value.findIndex((item) => item.id === selectedWelcomeSchemeId.value);
  welcomeSchemes.value.splice(index, 1);
  applyWelcomeScheme(welcomeSchemes.value[Math.max(0, index - 1)].id);
}

// ============ 拖拽排序 ============
// 原生 HTML5 drag & drop, 不引第三方库。顺序**存后端** (reorderPlaylist):
// 现场是主控机+平板+手机多终端, 只存前端的话每台设备顺序都不一样, 等于没排 ——
// 灯光分区排序已经论证过这一点, 同一个道理。
const dragId = ref<number | null>(null);
const dragOverId = ref<number | null>(null);

function onDragStart(it: PlaylistItemView, ev: DragEvent): void {
  dragId.value = it.id;
  ev.dataTransfer?.setData('text/plain', String(it.id));   // Firefox 不设这个不触发 drop
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
}
function onDragOver(it: PlaylistItemView, ev: DragEvent): void {
  if (dragId.value === null || dragId.value === it.id) return;
  ev.preventDefault();                                     // 不 preventDefault 就不允许 drop
  dragOverId.value = it.id;
}
async function onDrop(target: PlaylistItemView): Promise<void> {
  const from = dragId.value;
  dragId.value = null;
  dragOverId.value = null;
  if (from === null || from === target.id) return;

  const list = playlist.value.slice();
  const fi = list.findIndex((x) => x.id === from);
  const ti = list.findIndex((x) => x.id === target.id);
  if (fi < 0 || ti < 0) return;
  if (new Set(list.map(item => item.ownerUserId)).size > 1) {
    ElMessage.warning('当前包含共享及个人列表，不能混合排序');
    return;
  }
  const [moved] = list.splice(fi, 1);
  list.splice(ti, 0, moved);
  const before = playlist.value;
  playlist.value = list;                                   // 乐观: 松手立刻就位
  try {
    await reorderPlaylist(SLOT.value, list.map((x) => x.id));
  } catch (e) {
    playlist.value = before;                               // 失败回滚, 不留后端不认的假顺序
    ElMessage.error(`排序保存失败: ${(e as Error).message}`);
  }
}
function onDragEnd(): void {
  dragId.value = null;
  dragOverId.value = null;
}

// ============ 本页直接上传 (业主: "在 LED 大屏播放页面就可以直接点击上传内容") ============
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadPct = ref(0);
function pickFile(): void { fileInput.value?.click(); }

async function onFilePicked(ev: Event): Promise<void> {
  const f = (ev.target as HTMLInputElement).files?.[0];
  (ev.target as HTMLInputElement).value = '';    // 允许连续传同一个文件
  if (!f) return;
  const isCurrent = captureConsoleAction();
  uploading.value = true;
  uploadPct.value = 0;
  try {
    const m = await mediaService.upload(f, { onProgress: (pct: number) => { uploadPct.value = pct; } });
    if (!isCurrent()) return;
    // **只入媒体库, 不自动进播放列表** —— 业主: "媒体文件夹内容默认不加入播放列表,
    // 需经管理员确认后再手工加入"。所以这里问一句, 由人决定。
    try {
      await ElMessageBox.confirm(
        `「${m.originalName}」已上传到媒体库。要现在加入播放列表吗?`,
        '上传完成',
        { confirmButtonText: '加入播放列表', cancelButtonText: '只放媒体库', type: 'success' },
      );
      if (!isCurrent()) return;
      await addToPlaylist(SLOT.value, m.id);
      if (!isCurrent()) return;
      await loadAll();
      ElMessage.success('已加入播放列表');
    } catch {
      if (isCurrent()) ElMessage.info('已保存到媒体库 (未加入播放列表)');
    }
  } catch (e) {
    if (isCurrent()) ElMessage.error(`上传失败: ${(e as Error).message}`);
  } finally {
    uploading.value = false;
  }
}

// ============ 添加网页 (业主: "说的可以播放网页内容也没加上吗") ============
// "从媒体库选"的网页 tab 只能挑**已经存在**的网页条目 —— 库里一条没有的话形同虚设,
// 得先去媒体页用"添加网页"建一条再回来选, 业主感受就是"没加上"。跟"上传内容"
// 同一个道理, 本页直接能建, 不用跳走 (业主: "播放页面不应该点击按钮跳转到其他页面")。
const webpageDialog = ref(false);
const webpageForm = ref<{ name: string; url: string }>({ name: '', url: '' });
function openWebpageDialog(): void {
  webpageForm.value = { name: '', url: '' };
  webpageDialog.value = true;
}
async function submitWebpage(): Promise<void> {
  const url = webpageForm.value.url.trim();
  if (!/^https?:\/\//i.test(url)) { ElMessage.warning('网址要以 http:// 或 https:// 开头'); return; }
  try {
    const m = await mediaService.createWebpage(webpageForm.value.name.trim() || url, url);
    await addToPlaylist(SLOT.value, m.id);
    await loadAll();
    webpageDialog.value = false;
    ElMessage.success(`「${m.originalName}」已加入播放列表`);
  } catch (e) {
    ElMessage.error(`添加失败: ${(e as Error).message}`);
  }
}
</script>

<template>
  <section class="led-page">
    <!-- 播放器区置顶固定 (2026-07-25 业主): 头部+报警+正在播放 钉住, 列表在下面滚 -->
    <div class="pc-sticky">
    <header class="led-head">
      <button class="v2-back-btn" @click="goBack" title="返回首页">
        <ArrowLeft :size="18" :stroke-width="2" />
      </button>
      <div class="led-title"><MonitorPlay :size="18" :stroke-width="1.8" /> {{ title }}</div>
      <span class="led-state" :class="{ on: ch?.occupied, off: !ch?.occupied }">
        {{ ch?.occupied ? (ch.paused ? '已暂停' : '播放中') : '待机' }}
      </span>
      <span v-if="ch && !ch.alive" class="led-warn" title="播放器没有心跳">
        <AlertTriangle :size="14" /> 播放器离线
      </span>
      <!-- 屏幕电源开关 (放"待机"状态行末尾, 时序器拨动样式), 分组同开同关:
           LED=空开(1f-led)+LED大屏功放(按名) / 投影=seq-5+seq-4+投影仪功放(按名) -->
      <div v-if="powerCircuits.length" class="now-power">
        <Power :size="15" :stroke-width="2" />
        <span class="np-label">电源</span>
        <button
          class="v2-toggle"
          :class="{ on: powerAllOn }"
          :disabled="powerBusy"
          :title="(powerAllOn ? '断开' : '接通') + powerCircuits.map((c) => c.name).join('+')"
          @click="togglePower"
        ></button>
        <span class="np-state" :class="{ on: powerAllOn }">
          {{ powerAllOn ? '已通电' : (powerCircuits.some((c) => c.reading.on) ? '部分通电' : '已断电') }}
        </span>
      </div>
    </header>


    <!-- ===== 正在播 + 播放控制 ===== -->
    <section class="now">
      <!-- 报警插槽 (2026-07-26 业主: 移到播放卡片内部): 设备/输出异常条,
           投影页融合器状态用; 占满整行显示在卡片顶部 -->
      <slot name="alert" />
      <div class="now-info">
        <div class="now-label">正在播放</div>
        <div class="now-name" :title="ch?.currentMediaName || ''">
          {{ ch?.restricted ? '其他用户的内容正在使用此设备' : (currentInList?.title || ch?.currentMediaName || '— 待机中 —') }}
        </div>
        <div class="now-sub">
          <template v-if="activeSource === 'park-dashboard'">
            <span class="v2-inter">第 {{ parkOpsPage + 1 }} / {{ parkOpsTotalPages }} 页</span>
            <span>· {{ parkOpsAuto ? '自动轮播中' : '手动翻页' }}</span>
          </template>
          <template v-else>
            <span v-if="ch?.loopMode === 'loop'"><Repeat :size="13" /> 循环</span>
            <span v-else><Repeat1 :size="13" /> 播一遍</span>
            <span v-if="ch?.currentMediaId && !currentInList" class="tmp">· 临时推送 (不在播放列表里)</span>
          </template>
        </div>
      </div>
      <!-- 业主: "暂停、切换、上下内容等均可控制" + "随时可以点击终止" -->
      <div class="now-ctrl">
        <!-- 输入源=园区运营大屏时, 复用这四个主按钮为:
             上一页 / 自动轮播(开关) / 下一页 / 强制刷新, 纯图标, 不再另弹控制条 (2026-09-15) -->
        <template v-if="activeSource === 'park-dashboard'">
          <button class="pc-btn" :disabled="parkOpsBusy" title="运营大屏 · 上一页" @click="parkOpsControl('prev')">
            <ChevronLeft :size="20" />
          </button>
          <button
            class="pc-btn main"
            :class="{ on: parkOpsAuto }"
            :disabled="parkOpsBusy"
            :title="parkOpsAuto ? '自动轮播：开（点击关闭）' : '自动轮播：关（点击开启）'"
            @click="parkOpsControl('auto')"
          >
            <RefreshCw :size="20" />
          </button>
          <button class="pc-btn" :disabled="parkOpsBusy" title="运营大屏 · 下一页" @click="parkOpsControl('next')">
            <ChevronRight :size="20" />
          </button>
          <button class="pc-btn refresh" :disabled="parkOpsBusy" title="强制刷新：让大屏清缓存加载最新前端构建" @click="parkOpsControl('refresh')">
            <RotateCcw :size="18" />
          </button>
        </template>
        <template v-else>
          <button class="pc-btn" :disabled="busy || playlist.length === 0" title="上一首" @click="step('prev')">
            <SkipBack :size="20" />
          </button>
          <!-- 待机时必须是「播放」而不是一个被禁用的「暂停」(2026-07-17 业主:
               "有停止和暂停按钮, 但是没有播放按钮")。原来 disabled 挂在
               !ch.currentMediaId 上 —— 恰恰在最需要它的时候(待机)把它锁死了。
               口径对齐音响页 BGM 那个已验证好用的: disabled 只看列表空不空。 -->
          <button
            class="pc-btn main"
            :disabled="busy || (!ch?.currentMediaId && playlist.length === 0)"
            :title="!ch?.currentMediaId ? '播放' : (ch.paused ? '继续' : '暂停')"
            @click="togglePause"
          >
            <Pause v-if="ch?.currentMediaId && !ch.paused" :size="22" />
            <Play v-else :size="22" />
          </button>
          <button class="pc-btn" :disabled="busy || playlist.length === 0" title="下一首" @click="step('next')">
            <SkipForward :size="20" />
          </button>
          <button class="pc-btn stop" :disabled="busy || !ch?.currentMediaId" title="终止播放, 回到待机" @click="stopPlayback()">
            <Square :size="18" />
          </button>
        </template>
      </div>

      <!-- 画面铺放 (业主 2026-07-25): 图片/视频都吃, 默认铺满; 改完即时生效并记住 -->
      <div class="fit-row">
        <span class="fit-label">画面铺放</span>
        <el-select
          class="fit-select"
          :model-value="ch?.displayFit || 'fill'"
          size="small"
          :disabled="busy"
          @change="changeFit"
        >
          <el-option value="fill" label="铺满屏幕 (拉伸)" />
          <el-option value="contain" label="保持比例 (留黑边)" />
          <el-option value="cover" label="裁切铺满 (不变形)" />
        </el-select>
      </div>
    </section>

      <!-- 文档翻页条 (2026-07-25 文档投屏): PPT 原生放映/Word PDF 都由它遥控 -->
      <div v-if="isDocPlaying" class="doc-pager">
        <button class="pg-btn" :disabled="docPage <= 1" @click="gotoDocPage(1)" title="第一页">
          <SkipBack :size="15" />
        </button>
        <button class="pg-btn big" :disabled="docPage <= 1" @click="gotoDocPage(docPage - 1)">
          <ChevronLeft :size="20" /> 上一页
        </button>
        <span class="pg-num v2-inter">{{ docPage }}<i>/ {{ docTotal ?? '…' }}</i></span>
        <button class="pg-btn big" :disabled="docTotal !== null && docPage >= docTotal" @click="gotoDocPage(docPage + 1)">
          下一页 <ChevronRight :size="20" />
        </button>
        <button class="pg-btn" :disabled="docTotal === null || docPage >= docTotal" @click="docTotal && gotoDocPage(docTotal)" title="最后一页">
          <SkipForward :size="15" />
        </button>
        <!-- 缩放/全屏/退出 (2026-07-29 业主: PPT 放映控制补全) -->
        <span class="pg-gap"></span>
        <button class="pg-btn" :disabled="docZoom <= 50" title="缩小画面" @click="applyDocZoom(docZoom - 15)">
          <ZoomOut :size="15" />
        </button>
        <span class="pg-zoom v2-inter" :class="{ hot: docZoom !== 100 }">{{ docZoom }}%</span>
        <button class="pg-btn" :disabled="docZoom >= 200" title="放大画面" @click="applyDocZoom(docZoom + 15)">
          <ZoomIn :size="15" />
        </button>
        <button class="pg-btn big" :disabled="docZoom === 100" title="铺满整屏显示" @click="applyDocZoom(100)">
          <Maximize :size="15" /> 全屏
        </button>
        <button class="pg-btn exit" title="退出放映, 回到待机画面" @click="exitDocShow">
          <X :size="15" /> 退出
        </button>
      </div>

      <!-- 运营大屏的 上一页/自动轮播/下一页/强制刷新 已并入上方 .now-ctrl 四个主按钮,
           不再在切源后另弹一条控制按钮 (2026-09-15 应业主要求精简) -->
    </div><!-- /pc-sticky -->

    <!-- 输入源 — LED/投影两页统一出现 (2026-07-28 业主), 按钮指向见 script 注释 -->
    <section class="src-bar">
      <span class="src-label">输入源</span>
      <button class="src-btn" :class="{ on: activeSource === 'content' }" :disabled="busy" @click="selectContent">播放内容</button>
      <button class="src-btn dashboard" :class="{ on: activeSource === 'park-dashboard' }" :disabled="busy" @click="selectParkDashboard"><Globe :size="13" /> 园区运营大屏</button>
      <button class="src-btn" :class="{ on: activeSource === 'welcome-editable' }" :disabled="busy" @click="selectWelcome('editable')">欢迎页·可编辑称谓</button>
      <button class="src-btn" :class="{ on: activeSource === 'welcome-default' }" :disabled="busy" @click="selectWelcome('default')">欢迎页·默认</button>
      <button class="src-btn edit" :disabled="busy" @click="openWelcomeEditor"><Pencil :size="13" /> 编辑欢迎页</button>
      <span class="src-hint">{{ srcHint }}</span>
    </section>

    <!-- 手机上把「播放列表 / 播放历史」做成切换页 (业主 2026-07-17: "播放列表和播放
         历史应该做成切换页, 因为手机端放不下太多内容" + "下方还有不少空间")。
         平板/主控机宽度够, 两栏并排, 这一行 tab 不出现。 -->
    <div class="mob-tabs">
      <button class="mob-tab" :class="{ on: mobTab === 'list' }" @click="mobTab = 'list'">
        <ListMusic :size="15" /> 播放列表 <i>{{ playlist.length }}</i>
      </button>
      <button class="mob-tab" :class="{ on: mobTab === 'his' }" @click="mobTab = 'his'">
        <History :size="15" /> 播放历史 <i>{{ history.length }}</i>
      </button>
    </div>

    <div class="cols" :data-tab="mobTab">
      <!-- ===== 播放列表 ===== -->
      <section class="panel panel-list">
        <header class="panel-head">
          <span class="panel-title"><ListMusic :size="16" /> 播放列表</span>
          <span class="panel-count">{{ playlist.length }}</span>
          <input ref="fileInput" type="file" class="hidden-file" :accept="MEDIA_UPLOAD_ACCEPT" @change="onFilePicked" />
          <!-- 从媒体库选 —— 之前躺在媒体库里的东西必须有路进列表, 否则永远播不了
               (2026-07-17 业主的 MP4 就是卡在这) -->
          <button class="v2-quick" @click="openPicker">
            <FolderOpen :size="14" /> 从媒体库选
          </button>
          <button
            class="v2-quick primary" :class="{ uploading }"
            :style="uploading ? { '--pct': uploadPct + '%' } : undefined"
            :disabled="uploading" @click="pickFile"
          >
            <Upload :size="14" /> <span>{{ uploading ? `上传中 ${uploadPct}%` : '上传内容' }}</span>
          </button>
          <button class="v2-quick" @click="openWebpageDialog">
            <Globe :size="14" /> 添加网页
          </button>
        </header>

        <div v-if="playlist.length === 0" class="empty">
          暂无内容 — 点「上传内容」添加。
          <div class="empty-sub"></div>
        </div>

        <div v-else class="pl-list">
          <div
            v-for="it in playlist" :key="it.id"
            class="pl-item"
            :class="{
              playing: ch?.currentMediaId === it.mediaId, missing: it.missing,
              dragging: dragId === it.id, dropzone: dragOverId === it.id,
            }"
            :draggable="editingId !== it.id"
            @dragstart="onDragStart(it, $event)"
            @dragover="onDragOver(it, $event)"
            @drop.prevent="onDrop(it)"
            @dragend="onDragEnd"
          >
            <span class="pl-grip" title="按住拖动可调整顺序"><GripVertical :size="15" /></span>
            <button class="pl-play" :disabled="busy || it.missing" title="播放这个" @click="playItem(it)">
              <Play :size="15" />
            </button>
            <input
              v-if="editingId === it.id"
              v-focus
              v-model="editingText" class="pl-name-input" maxlength="60"
              @click.stop @mousedown.stop @keyup.enter="commitRename(it)"
              @keyup.esc="editingId = null" @blur="commitRename(it)"
            />
            <span v-else class="pl-name" :title="it.title">
              {{ it.title }}
              <i v-if="it.missing" class="tag-missing">媒体已删除</i>
            </span>
            <span v-if="ch?.currentMediaId === it.mediaId" class="pl-now">播放中</span>
            <button class="pl-ico" title="改名 (只改这里的显示名, 不动媒体库原文件)" @click="startRename(it)">
              <Pencil :size="14" />
            </button>
            <button class="pl-ico danger" title="移出播放列表" @click="removeItem(it)">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </section>

      <!-- ===== 播放历史 ===== -->
      <section class="panel panel-his">
        <header class="panel-head">
          <span class="panel-title"><History :size="16" /> 播放历史</span>
          <span class="panel-count">{{ history.length }}</span>
        </header>
        <div v-if="history.length === 0" class="empty">还没有播放记录</div>
        <div v-else class="pl-list">
          <div v-for="h in history" :key="h.mediaId" class="pl-item" :class="{ missing: h.missing }">
            <span class="pl-name" :title="h.mediaName">
              {{ h.mediaName }}
              <i v-if="h.missing" class="tag-missing">已删除</i>
            </span>
            <span class="pl-time">{{ new Date(h.playedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
            <button class="pl-ico" :disabled="h.missing" title="加入播放列表" @click="addFromHistory(h)">
              <Plus :size="15" />
            </button>
          </div>
        </div>
      </section>
    </div>

    <!-- 媒体库选择器 — 不跳走, 就在本页选 -->
    <div v-if="pickerOpen" class="pick-mask" @click.self="pickerOpen = false">
      <div class="pick-box">
        <header class="pick-head">
          <span class="pick-title"><FolderOpen :size="16" /> 从媒体库选内容</span>
          <div class="pick-tabs">
            <button
              v-for="k in ([
                { v: 'video', t: '视频' },
                { v: 'image', t: '图片' },
                { v: 'webpage', t: '网页' },
              ] as const)"
              :key="k.v"
              class="pick-tab" :class="{ on: pickerKind === k.v }"
              @click="pickerKind = k.v; loadAssets()"
            >{{ k.t }}</button>
          </div>
          <button class="pick-close" @click="pickerOpen = false"><X :size="18" /></button>
        </header>
        <div v-if="pickerLoading" class="pick-empty">读取中…</div>
        <div v-else-if="assets.length === 0" class="pick-empty">媒体库里还没有这类内容</div>
        <div v-else class="pick-list">
          <button
            v-for="a in assets" :key="a.id"
            class="pick-item" :class="{ added: inPlaylist.has(a.id) }"
            :disabled="inPlaylist.has(a.id)"
            :title="inPlaylist.has(a.id) ? '已在播放列表里' : '加入播放列表'"
            @click="pickAsset(a)"
          >
            <span class="pick-name">{{ a.originalName }}</span>
            <span v-if="inPlaylist.has(a.id)" class="pick-added">已加入</span>
            <Plus v-else :size="15" />
          </button>
        </div>
      </div>
    </div>

    <!-- 欢迎页编辑器：多套方案可先保存草稿，明确发布后才更新 LED 画面。 -->
    <div v-if="welcomeEditOpen" class="pick-mask welcome-mask" @click.self="welcomeEditOpen = false">
      <div class="pick-box we-box">
        <header class="pick-head">
          <span class="pick-title"><Pencil :size="16" /> 编辑欢迎页</span>
          <button class="pick-close" @click="welcomeEditOpen = false"><X :size="18" /></button>
        </header>
        <input
          ref="welcomeLogoUploadInput" type="file" class="hidden-file"
          accept="image/png,image/jpeg,image/webp" @change="onWelcomeAssetPicked('logo', $event)"
        />
        <input
          ref="welcomeBgUploadInput" type="file" class="hidden-file"
          accept="image/png,image/jpeg,image/webp" @change="onWelcomeAssetPicked('background', $event)"
        />
        <div v-if="welcomeLoading" class="pick-empty">读取中…</div>
        <template v-else>
          <ElScrollbar class="we-scroll" always>
            <div class="we-scroll-content">
            <div class="we-resolution">
              <strong>LED 原生画布 {{ LED_CANVAS_RESOLUTION }}</strong>
              <span>输出、浏览器、V2460 与屏体像素点对点，正式画面不缩放、不裁切。</span>
            </div>
            <div class="we-scheme-head">
              <div>
                <strong>欢迎方案</strong>
                <span>保存草稿不会改变大屏，点击发布后才正式上屏</span>
              </div>
              <div class="we-scheme-tools">
                <button class="v2-quick" :disabled="welcomeSchemes.length >= 20" @click="duplicateWelcomeScheme">复制为新方案</button>
                <button class="v2-quick danger" :disabled="welcomeSchemes.length <= 1" @click="deleteWelcomeScheme">删除</button>
              </div>
            </div>
            <div class="we-scheme-list" role="tablist" aria-label="欢迎方案列表">
              <button
                v-for="scheme in welcomeSchemes"
                :key="scheme.id"
                class="we-scheme-item"
                :class="{ on: selectedWelcomeSchemeId === scheme.id }"
                role="tab"
                :aria-selected="selectedWelcomeSchemeId === scheme.id"
                @click="selectWelcomeScheme(scheme.id)"
              >
                <span>{{ scheme.name }}</span>
                <em v-if="publishedWelcomeSchemeId === scheme.id">正在使用</em>
              </button>
            </div>
            <div class="we-upload-row" aria-label="欢迎页图片上传">
              <button class="v2-quick secondary" :disabled="!!welcomeAssetUploading" @click="pickWelcomeAsset('logo')">
                <Upload :size="14" />
                {{ welcomeAssetUploading === 'logo' ? `Logo 上传中 ${welcomeAssetUploadPct}%` : '上传 Logo' }}
              </button>
              <button class="v2-quick secondary" :disabled="!!welcomeAssetUploading" @click="pickWelcomeAsset('background')">
                <Upload :size="14" />
                {{ welcomeAssetUploading === 'background' ? `底图上传中 ${welcomeAssetUploadPct}%` : '上传底图' }}
              </button>
              <span>Logo 推荐透明底 PNG/WebP；底图上传后自动居中裁切并转换为 {{ LED_CANVAS_RESOLUTION }}</span>
            </div>
            <div class="we-preview" aria-label="LED 欢迎页实时预览">
              <iframe
                ref="welcomePreviewFrame"
                :src="welcomePreviewUrl"
                title="LED 欢迎页实时预览"
                tabindex="-1"
                @load="pushWelcomePreview"
              ></iframe>
            </div>
            <label class="wb-label">方案名称</label>
            <input v-model="welcomeSchemeName" class="wb-input" maxlength="40" placeholder="如：某公司来访" />
            <label class="wb-label">主标题 (空 = 默认「热烈欢迎」)</label>
            <input v-model="welcomeForm.welcomeTitle" class="wb-input" maxlength="16" placeholder="热烈欢迎" />
            <label class="wb-label">嘉宾称谓 (显示为 恭迎 ×× 莅临参观指导)</label>
            <input v-model="welcomeForm.welcomeGuest" class="wb-input" maxlength="64" placeholder="各位领导嘉宾" />
            <label class="wb-label">底部标语 (空 = 默认「智慧展厅 · 数字展贸 · 科创未来」)</label>
            <input v-model="welcomeForm.welcomeTagline" class="wb-input" maxlength="64" placeholder="智慧展厅 · 数字展贸 · 科创未来" />
            <label class="wb-label we-asset-label">Logo 图片</label>
            <div v-if="incompatibleSelectedLogo" class="we-warning">
              原 Logo 图片已不可用，预览和大屏已回退内置场馆 Logo；保存后会清除旧绑定。
            </div>
            <div class="we-bg-grid we-logo-grid">
              <button
                class="we-bg-item" :class="{ on: welcomeForm.welcomeLogoMediaId === null }"
                title="使用内置场馆 Logo" @click="welcomeForm.welcomeLogoMediaId = null"
              ><span class="we-logo-default">内置场馆 Logo</span></button>
              <div v-for="a in logoAssets" :key="`logo-${a.id}`" class="we-asset-card">
                <button
                  class="we-bg-item" :class="{ on: welcomeForm.welcomeLogoMediaId === a.id }"
                  :title="a.originalName" @click="welcomeForm.welcomeLogoMediaId = a.id"
                >
                  <img class="we-logo-image" :src="absUrl(a.thumbUrl || a.fileUrl)" alt="" loading="lazy" />
                  <span class="we-bg-name">{{ a.originalName }}</span>
                </button>
                <button
                  v-if="a.source !== 'system'"
                  class="we-asset-delete"
                  :disabled="welcomeAssetDeletingId !== null"
                  :title="`删除 Logo：${a.originalName}`"
                  :aria-label="`删除 Logo：${a.originalName}`"
                  @click.stop="deleteWelcomeImage('logo', a)"
                ><Trash2 :size="13" /></button>
              </div>
            </div>
            <label class="wb-label we-asset-label">底图模板 — 上屏文件统一为 {{ LED_CANVAS_RESOLUTION }}</label>
            <div v-if="incompatibleSelectedBackground" class="we-warning">
              原底图不是 {{ LED_CANVAS_RESOLUTION }}，预览和大屏已回退默认底图；保存后会清除旧绑定。
            </div>
            <div v-else-if="rejectedBgAssetCount > 0" class="we-note">
              有 {{ rejectedBgAssetCount }} 张旧底图尺寸不符；点击后会生成 LED 原生尺寸副本并选中。
            </div>
            <div class="we-bg-grid">
              <button
                class="we-bg-item" :class="{ on: welcomeForm.welcomeBgMediaId === null }"
                title="内置品牌底图" @click="welcomeForm.welcomeBgMediaId = null"
              ><span class="we-bg-default">默认品牌底图</span></button>
              <div v-for="a in bgAssets" :key="`background-${a.id}`" class="we-asset-card">
                <button
                  class="we-bg-item"
                  :class="{
                    on: welcomeForm.welcomeBgMediaId === a.id,
                    invalid: a.resolution?.toLowerCase() !== LED_CANVAS_RESOLUTION,
                  }"
                  :title="a.resolution?.toLowerCase() === LED_CANVAS_RESOLUTION
                    ? a.originalName
                    : `${a.originalName}：点击自动转换为 ${LED_CANVAS_RESOLUTION}`"
                  @click="selectWelcomeBackground(a)"
                >
                  <img :src="absUrl(a.thumbUrl || a.fileUrl)" alt="" loading="lazy" />
                  <span class="we-bg-name">{{ a.originalName }} · {{ a.resolution || '未知尺寸' }}</span>
                </button>
                <button
                  v-if="a.source !== 'system'"
                  class="we-asset-delete"
                  :disabled="welcomeAssetDeletingId !== null"
                  :title="`删除底图：${a.originalName}`"
                  :aria-label="`删除底图：${a.originalName}`"
                  @click.stop="deleteWelcomeImage('background', a)"
                ><Trash2 :size="13" /></button>
              </div>
            </div>
            </div>
          </ElScrollbar>
          <div class="wb-actions">
            <span v-if="lastWelcomeSaveRevision !== null" class="we-save-receipt">
              已保存到服务器 · 版本 {{ lastWelcomeSaveRevision }}
            </span>
            <button class="v2-quick" @click="welcomeEditOpen = false">取消</button>
            <button class="v2-quick secondary" :disabled="welcomeSaving || welcomePublishing" @click="saveWelcomeScheme">
              {{ welcomeSaving ? '保存并校验中…' : '仅保存方案' }}
            </button>
            <button class="v2-quick primary" :disabled="welcomeSaving || welcomePublishing" @click="publishSelectedWelcomeScheme">
              {{ welcomePublishing ? '发布中…' : '保存并发布到 LED' }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- 添加网页 dialog — 不跳走, 就在本页建 -->
    <div v-if="webpageDialog" class="pick-mask" @click.self="webpageDialog = false">
      <div class="pick-box webpage-box">
        <header class="pick-head">
          <span class="pick-title"><Globe :size="16" /> 添加网页</span>
          <button class="pick-close" @click="webpageDialog = false"><X :size="18" /></button>
        </header>
        <div class="wb-hint">网页会进媒体库并直接加入本页播放列表, 可像视频一样推到 LED 大屏</div>
        <label class="wb-label">名称</label>
        <input v-model="webpageForm.name" class="wb-input" placeholder="如 公司官网 / 活动大屏 H5" />
        <label class="wb-label">网址</label>
        <input v-model="webpageForm.url" class="wb-input" placeholder="https://..." @keyup.enter="submitWebpage" />
        <div class="wb-actions">
          <button class="v2-quick" @click="webpageDialog = false">取消</button>
          <button class="v2-quick primary" @click="submitWebpage">添加</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* LED 播放页 — 所有操作内嵌本页, 不跳走 (业主: "播放页面不应该点击按钮跳转到其他页面") */
/* overflow: hidden 兜底 (2026-07-26): 保证本页永远不产生外层滚动 —— 顶部标题栏+
   播放卡片钉死, 只有下方播放列表/历史内部滚动。之前投影页可滑是外层壳打断了高度链,
   壳已去掉; 这条再上一道保险, 让 LED/投影 100% 一致、任何细微溢出都不会让整页滑。 */
.led-page { display: flex; flex-direction: column; gap: 12px; height: 100%; padding: 12px; min-height: 0; overflow: hidden; }
.led-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
/* 返回键: 与灯光/音响/空调等功能页统一成深色描边按钮 (业主 2026-07-26)。
   原来 PlayerConsole 没定义, 用了浏览器默认白按钮, 和其它页不一致。 */
.v2-back-btn {
  width: 36px; height: 36px; border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  display: grid; place-items: center; cursor: pointer; color: var(--v2-text-2);
}
.v2-back-btn:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.led-title { display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 700; color: var(--v2-text-1); }
.led-state { padding: 3px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; }
.led-state.on { background: color-mix(in srgb, var(--v2-success) 20%, transparent); color: var(--v2-success); }
.led-state.off { background: var(--v2-surf-2); color: var(--v2-text-2); }
.led-warn { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: var(--v2-warning); }

/* 正在播 + 控制条 */
.now {
  position: relative; /* alert 插槽绝对定位锚点 (投影页警示行不撑高卡片) */
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 14px 16px; border-radius: 14px;
  background: var(--v2-surf-1, #14161A); border: 1px solid var(--v2-border-soft);
  /* 2026-07-26 业主: ① 与顶部标题栏留出间距(不紧贴); ② LED/投影卡片等高固定,
     报警文字(投影融合器状态)出现时在此高度内容纳、不撑高卡片。内容垂直居中,
     没报警时留白均分在上下, 看着是平衡的内边距而非空洞。 */
  margin-top: 12px;
  min-height: 116px;
}
.now-info { flex: 1 1 240px; min-width: 0; }
.now-label { font-size: 12px; color: var(--v2-text-2); }
.now-name {
  font-size: 22px; font-weight: 700; color: var(--v2-text-1);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.now-sub { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--v2-text-2); margin-top: 3px; }
.now-sub .tmp { color: #E0A030; }
.now-ctrl { display: flex; align-items: center; gap: 10px; }
/* 触摸目标做足 —— 现场是站着用平板点的 */
.pc-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; border-radius: 12px; cursor: pointer;
  background: var(--v2-surf-2, #1A1D22);
  border: 1px solid var(--v2-border-soft, #23262C); color: var(--v2-text-1);
}
.pc-btn:disabled { opacity: .35; cursor: not-allowed; }
.pc-btn.main { width: 60px; height: 60px; background: var(--v2-primary); border-color: var(--v2-primary); color: var(--v2-on-primary); }
.pc-btn.stop:not(:disabled):hover { border-color: #E5645D; color: #E5645D; }
/* 运营大屏复用主按钮: 自动轮播激活=绿色高亮, 强制刷新=醒目琥珀色 */
.pc-btn.main.on { background: var(--v2-success, #3FBF87); border-color: var(--v2-success, #3FBF87); color: #04101f; box-shadow: 0 0 14px rgba(63,191,135,.45); }
.pc-btn.refresh:not(:disabled) { background: linear-gradient(135deg, #f59e0b, #d97706); border-color: #f59e0b; color: #fff; }
.pc-btn.refresh:not(:disabled):hover { background: linear-gradient(135deg, #fbbf24, #f59e0b); box-shadow: 0 0 12px rgba(245,158,11,.45); }

.fit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.fit-label {
  font-size: 12px;
  color: var(--v2-text-2);
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.fit-select { width: 180px; }

.src-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 14px; border-radius: 12px;
  background: var(--v2-surf-1, #14161A); border: 1px solid var(--v2-border-soft);
}
.src-label { font-size: 13px; color: var(--v2-text-2); }
.src-btn {
  padding: 9px 16px; min-height: 40px; border-radius: 9px; cursor: pointer;
  font-size: 14px; color: var(--v2-text-1);
  background: var(--v2-surf-2, #1A1D22); border: 1px solid var(--v2-border-soft, #23262C);
}
.src-btn.on { border-color: var(--v2-primary); background: var(--v2-primary); color: var(--v2-on-primary); }
.src-btn:disabled { opacity: .4; cursor: not-allowed; }
.src-btn.dashboard { display: inline-flex; align-items: center; gap: 5px; }
.src-btn.edit { display: inline-flex; align-items: center; gap: 5px; color: var(--v2-primary); border-style: dashed; }
.src-hint { font-size: 11px; color: var(--v2-text-3); }

/* 欢迎页编辑器 (2026-07-28) */
.pick-box.we-box {
  width: min(920px, calc(100vw - 32px));
  height: min(90vh, 900px); max-height: calc(100vh - 20px);
  height: min(90dvh, 900px); max-height: calc(100dvh - 20px);
  min-height: 0; display: flex; flex-direction: column; overflow: hidden;
}
.we-box > .pick-head, .we-box > .wb-actions { flex: 0 0 auto; }
.we-save-receipt { margin-right: auto; color: var(--v2-success); font-size: 12px; }
.we-scroll {
  flex: 1 1 0; min-height: 0;
}
.we-scroll-content {
  min-height: 100%; padding-right: 18px;
  display: flex; flex-direction: column; gap: 6px;   /* label 是 inline 元素, 不排 flex 会挤成一行 */
}
.we-scroll :deep(.el-scrollbar__wrap) {
  overflow-x: hidden; -webkit-overflow-scrolling: touch;
  touch-action: pan-y; overscroll-behavior-y: contain;
}
.we-scroll :deep(.el-scrollbar__bar.is-vertical) { width: 12px; right: 1px; opacity: 1; }
.we-scroll :deep(.el-scrollbar__thumb) {
  min-height: 48px; opacity: 1;
  background: color-mix(in srgb, var(--v2-primary) 72%, var(--v2-text-3));
}
.we-scroll :deep(.el-scrollbar__thumb:hover) { background: var(--v2-primary); }
.we-resolution {
  display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
  padding: 10px 12px; border-radius: 9px;
  color: var(--v2-text-2); background: color-mix(in srgb, var(--v2-primary) 9%, var(--v2-surf-2));
  border: 1px solid color-mix(in srgb, var(--v2-primary) 28%, var(--v2-border-soft));
}
.we-resolution strong { color: var(--v2-primary); font-size: 13px; white-space: nowrap; }
.we-resolution span { font-size: 12px; text-align: right; }
.we-scheme-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px;
}
.we-scheme-head > div:first-child { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.we-scheme-head strong { font-size: 14px; color: var(--v2-text-1); }
.we-scheme-head span { font-size: 11px; color: var(--v2-text-3); }
.we-scheme-tools { display: flex; gap: 6px; flex: none; }
.we-scheme-tools .v2-quick { min-height: 32px; padding: 6px 10px; font-size: 12px; }
.we-scheme-tools .danger { color: var(--v2-danger); }
.we-scheme-list {
  display: flex; gap: 7px; overflow-x: auto; padding: 2px 2px 5px; scrollbar-width: thin;
}
.we-scheme-item {
  min-width: 120px; min-height: 43px; padding: 7px 10px; border-radius: 9px; cursor: pointer;
  display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px;
  color: var(--v2-text-2); background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft);
}
.we-scheme-item span { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.we-scheme-item em { font-size: 10px; font-style: normal; color: var(--v2-primary); }
.we-scheme-item.on {
  color: var(--v2-text-1); border-color: var(--v2-primary);
  background: color-mix(in srgb, var(--v2-primary) 10%, var(--v2-surf-2));
}
.we-upload-row {
  display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center; gap: 8px;
  padding: 9px 10px; border: 1px solid var(--v2-border-soft); border-radius: 9px;
  background: var(--v2-surf-2);
}
.we-upload-row .v2-quick { display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.we-upload-row span { color: var(--v2-text-3); font-size: 11px; line-height: 1.35; }
.we-asset-label { margin-top: 10px; }
.we-logo-grid { overflow: visible; }
.we-logo-image { object-fit: contain !important; padding: 7px; background: rgba(255,255,255,.92); }
.we-logo-default {
  position: absolute; inset: 0; display: grid; place-items: center; padding: 8px;
  color: var(--v2-primary); font-size: 12px; text-align: center;
  background: radial-gradient(circle at 50% 45%, var(--v2-primary-soft), var(--v2-surf-2) 68%);
}
.we-preview {
  position: relative; width: 100%; aspect-ratio: 3612 / 1462; overflow: hidden;
  margin: 4px 0 8px; border-radius: 10px; background: #06101f;
  border: 1px solid var(--v2-border-soft); box-shadow: inset 0 0 0 1px rgba(255,255,255,.025);
}
.we-preview iframe { width: 100%; height: 100%; display: block; border: 0; pointer-events: none; }
.we-warning, .we-note { padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.45; }
.we-warning { color: var(--v2-warning); background: color-mix(in srgb, var(--v2-warning) 10%, transparent); }
.we-note { color: var(--v2-text-3); background: var(--v2-surf-2); }
.we-bg-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 8px; margin-top: 6px;
}
.we-bg-item {
  position: relative; height: 82px; border-radius: 9px; overflow: hidden; cursor: pointer;
  background: var(--v2-surf-2, #1A1D22); border: 2px solid var(--v2-border-soft, #23262C);
  padding: 0; display: grid; place-items: center;
}
.we-asset-card { position: relative; min-width: 0; }
.we-asset-card .we-bg-item { width: 100%; }
.we-bg-item.invalid { opacity: .72; cursor: pointer; border-style: dashed; }
.we-asset-delete {
  position: absolute; z-index: 2; top: 5px; right: 5px;
  width: 40px; height: 40px; padding: 0; border-radius: 9px;
  display: grid; place-items: center; cursor: pointer;
  color: #fff; background: rgba(127, 29, 29, .9); border: 1px solid rgba(255,255,255,.22);
  box-shadow: 0 3px 12px rgba(0,0,0,.28);
}
.we-asset-delete:hover { background: var(--v2-danger); }
.we-asset-delete:disabled { opacity: .5; cursor: wait; }
.we-bg-item.on { border-color: var(--v2-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--v2-primary) 35%, transparent); }
.we-bg-item img { width: 100%; height: 100%; object-fit: cover; }
.we-bg-name {
  position: absolute; left: 0; right: 0; bottom: 0;
  font-size: 10px; line-height: 1.2; padding: 3px 5px;
  background: rgba(6, 10, 18, 0.72); color: var(--v2-text-2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;
}
.we-bg-default {
  font-size: 12px; color: #e8c66a; text-align: center; line-height: 1.5;
  background: radial-gradient(120px 70px at 50% 110%, rgba(212, 175, 55, 0.25), transparent 70%),
    radial-gradient(160px 90px at 50% 50%, #0d2038, #06101f);
  position: absolute; inset: 0; display: grid; place-items: center;
}
@media (max-width: 640px) {
  .welcome-mask { padding: 0; align-items: stretch; overflow: hidden; }
  .welcome-mask .pick-box.we-box {
    width: 100%; height: 100vh; max-height: 100vh; height: 100dvh; max-height: 100dvh; border-radius: 0;
    padding: max(10px, env(safe-area-inset-top)) 10px max(8px, env(safe-area-inset-bottom));
  }
  .welcome-mask .pick-head { margin-bottom: 6px; }
  .welcome-mask .wb-actions { margin-top: 8px; flex-wrap: wrap; }
  .welcome-mask .wb-actions .v2-quick { flex: 1 1 auto; min-width: 92px; }
  .we-scheme-head { align-items: flex-start; flex-direction: column; }
  .we-scheme-head > div:first-child { align-items: flex-start; flex-direction: column; gap: 2px; }
  .we-resolution { align-items: flex-start; flex-direction: column; gap: 3px; }
  .we-resolution span { text-align: left; }
  .we-preview { flex: 0 0 auto; }
  .we-upload-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .we-upload-row span { grid-column: 1 / -1; }
  .we-scroll-content { padding-right: 10px; }
  .we-scroll :deep(.el-scrollbar__bar.is-vertical) { width: 7px; }
  .we-bg-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .we-asset-delete { width: 44px; height: 44px; top: 4px; right: 4px; }
}

/* align-items: start (不是默认的 stretch) —— 列表/历史内容短的时候(比如只有 2 条),
   不强行把卡片撑满 .cols 剩余高度, 卡片底下露一大截空白背景 (业主反馈: "下面还有不少
   空间")。卡片改成跟内容一样高, 多出来的空间就是页面背景, 不再是半空的卡片。
   长列表需要滚动时靠 .panel 的 max-height + .pl-list 的 overflow-y 兜底, 不受影响。 */
.cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; flex: 0 1 auto; max-height: 100%; min-height: 0; align-items: start; }
.panel {
  display: flex; flex-direction: column; min-height: 0; max-height: 100%;
  /* min-width: 0 关键 (2026-07-26): panel 是 .cols 的网格子项, 默认 min-width:auto
     不肯收缩到内容(超长文件名 nowrap)以下 —— 于是被撑得比屏幕还宽, 右侧连同圆角
     被挤出视口外, 看着就是"圆角缺失/被切"。设 0 后 panel 收缩到网格轨道宽,
     长文件名走 .pl-name 的省略号, 卡片回到屏内、圆角完整。 */
  min-width: 0;
  border-radius: 14px; padding: 12px;
  background: var(--v2-surf-1, #14161A); border: 1px solid var(--v2-border-soft);
}
.panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.panel-title { display: inline-flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 700; color: var(--v2-text-1); }
.panel-count { font-size: 12px; color: var(--v2-text-2); background: var(--v2-surf-2); border-radius: 20px; padding: 2px 8px; }
.panel-head .v2-quick { margin-left: auto; }
/* 上传中: 原来 disabled 让按钮变灰, 文字跟底色糊在一起完全看不清 (业主截图坐实)。
   改成"进度填充"样式: 深底 + 亮字 + 一条随进度走的填充, 一眼看得见传到哪了。 */
.v2-quick.uploading {
  position: relative; overflow: hidden;
  opacity: 1 !important;                 /* 盖掉 disabled 的变灰 */
  color: var(--v2-text-1); font-weight: 600;
  background: color-mix(in srgb, var(--v2-info) 14%, var(--v2-surf-1)); border-color: var(--v2-primary);
}
.v2-quick.uploading::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: var(--pct, 0%); background: var(--v2-primary-soft);
  transition: width .2s linear; z-index: 0;
}
.v2-quick.uploading > * { position: relative; z-index: 1; }
.hidden-file { display: none; }

.empty { padding: 20px; text-align: center; font-size: 13px; color: var(--v2-text-2); border: 1px dashed var(--v2-border-soft); border-radius: 10px; }
.empty-sub { margin-top: 6px; font-size: 12px; color: var(--v2-text-3); }

.pl-list { flex: 1 1 auto; min-height: 0; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.pl-item {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  padding: 8px 10px; border-radius: 10px;
  background: var(--v2-surf-2, #1A1D22); border: 1px solid transparent;
}
.pl-item.playing { border-color: var(--v2-primary); background: color-mix(in srgb, var(--v2-primary) 20%, var(--v2-surf-1)); }
.pl-item.dragging { opacity: .45; }
/* 拖到哪儿哪儿亮一条虚线 —— 松手前就知道会落在哪, 不用猜 */
.pl-item.dropzone { outline: 2px dashed var(--v2-primary); outline-offset: 2px; }
.pl-grip { display: inline-flex; align-items: center; color: var(--v2-text-2); cursor: grab; flex: 0 0 auto; }
.pl-grip:active { cursor: grabbing; }
.pl-item.missing { opacity: .55; }
.pl-play {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; flex: 0 0 auto; border-radius: 8px; cursor: pointer;
  background: transparent; border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.pl-play:disabled { opacity: .35; cursor: not-allowed; }
.pl-name { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; }
.pl-name-input {
  flex: 1 1 auto; min-width: 0; padding: 5px 8px; font-size: 14px;
  color: var(--v2-text-1); background: var(--v2-inset-bg);
  border: 1px solid var(--v2-primary); border-radius: 6px; outline: none;
}
.tag-missing { margin-left: 6px; padding: 1px 6px; border-radius: 4px; background: #7f1d1d55; color: #EC8880; font-size: 11px; font-style: normal; }
.pl-now { font-size: 11px; color: var(--v2-primary); flex: 0 0 auto; }
.pl-time { font-size: 12px; color: var(--v2-text-2); flex: 0 0 auto; }
.pl-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; flex: 0 0 auto; border-radius: 8px; cursor: pointer;
  background: transparent; border: none; color: var(--v2-text-2);
}
.pl-ico:hover { color: var(--v2-text-1); }
.pl-ico.danger:hover { color: var(--v2-danger); }
.pl-ico:disabled { opacity: .3; cursor: not-allowed; }

/* 选择器弹窗 */
.pick-mask {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.pick-box {
  width: min(560px, 100%); max-height: 76vh; display: flex; flex-direction: column;
  background: var(--v2-surf-1, #14161A); border: 1px solid var(--v2-border-soft, #23262C);
  border-radius: 14px; padding: 14px;
}
.webpage-box { gap: 6px; }
.wb-hint { font-size: 12px; color: var(--v2-text-3); margin-bottom: 8px; }
.wb-label { font-size: 12px; color: var(--v2-text-3); margin-top: 6px; }
.wb-input {
  background: var(--v2-ov-1); border: 1px solid var(--v2-border-soft); border-radius: 8px;
  padding: 10px 12px; color: var(--v2-text-1); font-size: 14px; outline: none; font-family: inherit;
}
.wb-input:focus { border-color: var(--v2-primary); }
.wb-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.pick-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.pick-title { display: inline-flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 700; color: var(--v2-text-1); }
.pick-tabs { display: flex; gap: 4px; margin-left: auto; }
.pick-tab {
  padding: 7px 14px; min-height: 36px; border-radius: 8px; cursor: pointer; font-size: 13px;
  background: var(--v2-surf-2, #1A1D22); border: 1px solid var(--v2-border-soft, #23262C); color: var(--v2-text-2);
}
.pick-tab.on { border-color: var(--v2-primary); color: var(--v2-primary); background: var(--v2-primary-soft); font-weight: 600; }
.pick-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 8px; cursor: pointer;
  background: transparent; border: 1px solid var(--v2-border-soft); color: var(--v2-text-2);
}
.pick-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.pick-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 11px 12px; min-height: 46px; border-radius: 10px; cursor: pointer; text-align: left;
  background: var(--v2-surf-2, #1A1D22); border: 1px solid transparent; color: var(--v2-text-1);
}
.pick-item:hover:not(:disabled) { border-color: var(--v2-primary); }
.pick-item.added { opacity: .5; cursor: default; }
.pick-name { flex: 1 1 auto; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pick-added { font-size: 11px; color: var(--v2-primary); flex: 0 0 auto; }
.pick-empty { padding: 24px; text-align: center; font-size: 13px; color: var(--v2-text-2); }

/* 手机/平板 tab — 宽屏不显示 (两栏并排放得下) */
.mob-tabs { display: none; gap: 8px; }
.mob-tab {
  flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 11px; min-height: 46px; border-radius: 10px; cursor: pointer; font-size: 14px;
  background: var(--v2-surf-1, #14161A); border: 1px solid var(--v2-border-soft, #23262C); color: var(--v2-text-2);
}
.mob-tab.on { border-color: var(--v2-primary); color: var(--v2-primary); background: var(--v2-primary-soft); font-weight: 600; }
.mob-tab i { font-style: normal; font-size: 12px; opacity: .8; }

@media (max-width: 900px) {
  /* 列表/历史二选一, 不再上下堆两个半高的空面板 (业主: "下方还有不少空间") */
  .mob-tabs { display: flex; }
  .cols { grid-template-columns: 1fr; }
  .cols[data-tab='list'] .panel-his { display: none; }
  .cols[data-tab='his'] .panel-list { display: none; }
  .now-ctrl { width: 100%; justify-content: center; }
  .panel-head { flex-wrap: wrap; }
  .panel-head .v2-quick { margin-left: 0; }
  .panel-head .panel-title { flex: 1 1 100%; }
}

/* 播放器区置顶固定 (业主 2026-07-25): 滚动时头部+正在播放钉在顶部, 只滚列表 */
.pc-sticky {
  position: sticky; top: 0; z-index: 60;
  background: var(--v2-bg-0);
  padding-bottom: 4px;
  box-shadow: 0 8px 16px -12px rgba(0, 0, 0, 0.35);
}

/* ---- 文档翻页条 (2026-07-25) ---- */
.doc-pager {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 8px 12px; margin: 6px var(--v2-sp-5) 0;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
}
.pg-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 9px 12px; border-radius: var(--v2-r-sm); cursor: pointer;
  background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-1); font-size: 14px; font-weight: 600;
}
.pg-btn.big { padding: 11px 20px; font-size: 15px; background: var(--v2-primary); color: var(--v2-on-primary); border-color: var(--v2-primary); }
.pg-btn:disabled { opacity: .4; cursor: not-allowed; }
.pg-num { font-size: 18px; font-weight: 700; min-width: 72px; text-align: center; color: var(--v2-text-1); }
.pg-num i { font-style: normal; font-size: 13px; color: var(--v2-text-3); margin-left: 3px; }
/* 缩放/全屏/退出 (2026-07-29) */
.pg-gap { width: 1px; height: 22px; background: var(--v2-border-soft); margin: 0 4px; }
.pg-zoom { font-size: 13px; font-weight: 600; min-width: 44px; text-align: center; color: var(--v2-text-2); }
.pg-zoom.hot { color: var(--v2-warning); }
.pg-btn.big { display: inline-flex; align-items: center; gap: 5px; }
.pg-btn.exit { display: inline-flex; align-items: center; gap: 4px; color: var(--v2-danger); }
.pg-label { font-size: 14px; font-weight: 700; color: var(--v2-primary); margin-right: 4px; white-space: nowrap; }
/* ---- 电源开关 (标题栏"待机"行末尾, 时序器同款拨动开关) ---- */
/* 报警插槽在卡片内占满整行, 显示在顶部 (投影融合器状态) */
.now :deep(.out-bar) { flex-basis: 100%; width: 100%; }
/* 2026-07-26: 收紧间距/去掉状态字固定预留宽, 让整块更窄, LED 页("LED 大屏"标题较宽)
   电源块也能留在"待机"同一行不换行。 */
.now-power {
  margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
  color: var(--v2-text-2); flex-shrink: 0; white-space: nowrap;
}
.np-label { font-size: 13px; font-weight: 600; color: var(--v2-text-1); }
.np-state { font-size: 12px; font-weight: 600; color: var(--v2-text-3); }
.np-state.on { color: var(--v2-live-power, #48D597); }

/* 拨动开关 —— 抄自电源页时序器 (.v2-toggle), 保持全站一致 */
.v2-toggle {
  position: relative;
  width: 46px; height: 26px;
  border-radius: 13px;
  background: var(--v2-surf-2);
  cursor: pointer;
  transition: background 0.22s ease;
  flex-shrink: 0;
  border: none;
  padding: 0;
}
.v2-toggle::after {
  content: '';
  position: absolute;
  top: 2px; left: 2px;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.v2-toggle.on {
  background: linear-gradient(135deg, #9BA1A9, #9BA1A9);
  box-shadow: 0 0 14px rgba(255, 255, 255, 0.08), 0 0 28px rgba(255, 255, 255, 0.08);
}
.v2-toggle.on::after {
  transform: translateX(20px);
  box-shadow: 0 1px 4px rgba(0,0,0,0.4), 0 0 8px rgba(255, 255, 255, 0.6);
}
.v2-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 640px) {
  .v2-toggle { width: 48px; height: 28px; }
  .v2-toggle::after { width: 24px; height: 24px; }
  .v2-toggle.on::after { transform: translateX(20px); }
}
</style>
