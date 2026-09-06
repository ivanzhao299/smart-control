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
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, MonitorPlay, Play, Pause, Square, SkipBack, SkipForward,
  Upload, ListMusic, History, Pencil, Trash2, Plus, Repeat, Repeat1, AlertTriangle, GripVertical, FolderOpen, X,
  Globe,
  ChevronLeft, ChevronRight, Power, ZoomIn, ZoomOut, Maximize,
} from 'lucide-vue-next';
import { usePlaybackStore } from '@/stores/playback';
import {
  listPlaylist, addToPlaylist, renamePlaylistItem, removeFromPlaylist, reorderPlaylist,
  listHistory, setDisplayFit, setDocPage, setDocZoom, publishWelcome,
  type DisplayFit, type PlaylistItemView, type PlaybackHistoryView,
} from '@/services/playback.service';
import { projectorService } from '@/services/projector.service';
import { fetchSystemBranding, saveWelcomeConfig } from '@/services/system-branding.service';
import { absUrl } from '@/services/http';
import { useAdminUnlock } from '@/composables/useAdminUnlock';
import { powerCircuitsService, type PowerCircuitView } from '@/services/power-circuits.service';
import { mediaService, MEDIA_UPLOAD_ACCEPT } from '@/services/media.service';
import { ledService } from '@/services/led.service';

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

type SourceKey = 'content' | 'welcome-editable' | 'welcome-default';
/** 当前源: 从通道在播媒体名判断 (内置素材按名定位, 业主改名后回退为"播放内容") */
const activeSource = computed<SourceKey | null>(() => {
  const name = ch.value?.currentMediaName;
  if (!name || !ch.value?.currentMediaId) return null;
  if (name === WELCOME_EDITABLE_NAME) return 'welcome-editable';
  if (WELCOME_DEFAULT_NAMES.includes(name)) return 'welcome-default';
  return 'content';
});
const SRC_HINTS: Record<SourceKey, string> = {
  'content': '正在播放列表内容',
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

// ============ 欢迎页编辑器 (2026-07-28 业主: "编辑放到前端, 不用进后台") ============
// 就地编辑动态欢迎页: 主标题 / 嘉宾称谓 / 底部标语 三段文字 + 底图 (媒体库图片
// 当模板, 不选 = 内置"鎏金夜湖"底)。保存走 PUT /system-branding/welcome (客户端
// token 即可); 欢迎页本体 8s 轮询, 保存后若本屏正在播欢迎页再重推一次强制刷新,
// 业主看到的效果就是"保存立即生效"。
const welcomeEditOpen = ref(false);
const welcomeSaving = ref(false);
const welcomeLoading = ref(false);
const welcomeForm = ref({ welcomeTitle: '', welcomeGuest: '', welcomeTagline: '', welcomeBgMediaId: null as number | null });
const bgAssets = ref<Array<{ id: number; originalName: string; thumbUrl: string | null; fileUrl: string }>>([]);

async function openWelcomeEditor(): Promise<void> {
  if (!(await ensureAdmin('编辑欢迎页'))) return;
  welcomeEditOpen.value = true;
  welcomeLoading.value = true;
  try {
    const [branding, imgs] = await Promise.all([
      fetchSystemBranding(),
      mediaService.list({ kind: 'image' }),
    ]);
    welcomeForm.value = {
      welcomeTitle: branding.welcomeTitle ?? '',
      welcomeGuest: branding.welcomeGuest ?? '',
      welcomeTagline: branding.welcomeTagline ?? '',
      welcomeBgMediaId: branding.welcomeBgMediaId ?? null,
    };
    bgAssets.value = imgs.items.map((m) => ({ id: m.id, originalName: m.originalName, thumbUrl: m.thumbUrl, fileUrl: m.fileUrl }));
  } catch (e) {
    ElMessage.error(`读取欢迎页配置失败: ${(e as Error).message}`);
  } finally { welcomeLoading.value = false; }
}

async function saveWelcomeEdit(): Promise<void> {
  welcomeSaving.value = true;
  try {
    await saveWelcomeConfig({
      welcomeTitle: welcomeForm.value.welcomeTitle.trim() || null,
      welcomeGuest: welcomeForm.value.welcomeGuest.trim() || null,
      welcomeTagline: welcomeForm.value.welcomeTagline.trim() || null,
      welcomeBgMediaId: welcomeForm.value.welcomeBgMediaId,
    });
    // 本屏正在播欢迎页 → 重推强制 kiosk 刷新, 立即生效; 没在播就不打扰当前内容
    if (activeSource.value === 'welcome-editable') {
      await publishWelcome(SLOT.value, 'editable').catch(() => {});
    }
    welcomeEditOpen.value = false;
    ElMessage.success('欢迎页已保存, 大屏几秒内更新');
  } catch (e) {
    ElMessage.error(`保存失败: ${(e as Error).message}`);
  } finally { welcomeSaving.value = false; }
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
          <span v-if="ch?.loopMode === 'loop'"><Repeat :size="13" /> 循环</span>
          <span v-else><Repeat1 :size="13" /> 播一遍</span>
          <span v-if="ch?.currentMediaId && !currentInList" class="tmp">· 临时推送 (不在播放列表里)</span>
        </div>
      </div>
      <!-- 业主: "暂停、切换、上下内容等均可控制" + "随时可以点击终止" -->
      <div class="now-ctrl">
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
    </div><!-- /pc-sticky -->

    <!-- 输入源 — LED/投影两页统一出现 (2026-07-28 业主), 按钮指向见 script 注释 -->
    <section class="src-bar">
      <span class="src-label">输入源</span>
      <button class="src-btn" :class="{ on: activeSource === 'content' }" :disabled="busy" @click="selectContent">播放内容</button>
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

    <!-- 欢迎页编辑器 (2026-07-28 业主: "编辑放到前端"): 文字 + 底图就地编辑, 保存立即生效 -->
    <div v-if="welcomeEditOpen" class="pick-mask" @click.self="welcomeEditOpen = false">
      <div class="pick-box we-box">
        <header class="pick-head">
          <span class="pick-title"><Pencil :size="16" /> 编辑欢迎页</span>
          <button class="pick-close" @click="welcomeEditOpen = false"><X :size="18" /></button>
        </header>
        <div v-if="welcomeLoading" class="pick-empty">读取中…</div>
        <template v-else>
          <div class="we-scroll">
            <label class="wb-label">主标题 (空 = 默认「热烈欢迎」)</label>
            <input v-model="welcomeForm.welcomeTitle" class="wb-input" maxlength="16" placeholder="热烈欢迎" />
            <label class="wb-label">嘉宾称谓 (显示为 恭迎 ×× 莅临参观指导)</label>
            <input v-model="welcomeForm.welcomeGuest" class="wb-input" maxlength="64" placeholder="各位领导嘉宾" />
            <label class="wb-label">底部标语 (空 = 默认「智慧展厅 · 数字展贸 · 科创未来」)</label>
            <input v-model="welcomeForm.welcomeTagline" class="wb-input" maxlength="64" placeholder="智慧展厅 · 数字展贸 · 科创未来" />
            <label class="wb-label">底图模板 — 选媒体库图片当底图; 想用新图先在本页「上传内容」传一张</label>
            <div class="we-bg-grid">
              <button
                class="we-bg-item" :class="{ on: welcomeForm.welcomeBgMediaId === null }"
                title="内置鎏金夜湖底图" @click="welcomeForm.welcomeBgMediaId = null"
              ><span class="we-bg-default">默认底图<br>「鎏金夜湖」</span></button>
              <button
                v-for="a in bgAssets" :key="a.id"
                class="we-bg-item" :class="{ on: welcomeForm.welcomeBgMediaId === a.id }"
                :title="a.originalName" @click="welcomeForm.welcomeBgMediaId = a.id"
              >
                <img :src="absUrl(a.thumbUrl || a.fileUrl)" alt="" loading="lazy" />
                <span class="we-bg-name">{{ a.originalName }}</span>
              </button>
            </div>
          </div>
          <div class="wb-actions">
            <button class="v2-quick" @click="welcomeEditOpen = false">取消</button>
            <button class="v2-quick primary" :disabled="welcomeSaving" @click="saveWelcomeEdit">{{ welcomeSaving ? '保存中…' : '保存并生效' }}</button>
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
.src-btn.edit { display: inline-flex; align-items: center; gap: 5px; color: var(--v2-primary); border-style: dashed; }
.src-hint { font-size: 11px; color: var(--v2-text-3); }

/* 欢迎页编辑器 (2026-07-28) */
.we-box { width: min(680px, 94vw); max-height: 86vh; display: flex; flex-direction: column; }
.we-scroll {
  overflow-y: auto; min-height: 0; padding-right: 4px; -webkit-overflow-scrolling: touch;
  display: flex; flex-direction: column; gap: 6px;   /* label 是 inline 元素, 不排 flex 会挤成一行 */
}
.we-bg-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 8px; margin-top: 6px;
}
.we-bg-item {
  position: relative; height: 82px; border-radius: 9px; overflow: hidden; cursor: pointer;
  background: var(--v2-surf-2, #1A1D22); border: 2px solid var(--v2-border-soft, #23262C);
  padding: 0; display: grid; place-items: center;
}
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
