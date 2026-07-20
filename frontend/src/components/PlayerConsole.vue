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
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, MonitorPlay, Play, Pause, Square, SkipBack, SkipForward,
  Upload, ListMusic, History, Pencil, Trash2, Plus, Repeat, Repeat1, AlertTriangle, GripVertical, FolderOpen, X,
  Globe,
} from 'lucide-vue-next';
import { usePlaybackStore } from '@/stores/playback';
import {
  listPlaylist, addToPlaylist, renamePlaylistItem, removeFromPlaylist, reorderPlaylist,
  listHistory, type PlaylistItemView, type PlaybackHistoryView,
} from '@/services/playback.service';
import { mediaService } from '@/services/media.service';
import { ledService, type LedInput } from '@/services/led.service';

const props = defineProps<{
  /** 1 = LED 大屏 (HDMI1), 2 = 投影仪 (HDMI2) */
  slot: 1 | 2;
  title: string;
  /**
   * 显示设备的 code (如 LED-NOVA-1) —— 传了才显示"输入源"那一栏。
   * 业主 2026-07-17: "把投影仪页面单独摘出来, 在工具栏页面可以切换各种输入源以及播放素材"。
   * 不传 = 这块屏没有可切的输入源 (比如它只吃我们推的内容), 那一栏就不出现,
   * 而不是摆一排点了没用的按钮。
   */
  deviceId?: string;
}>();
const SLOT = computed(() => props.slot);

const router = useRouter();
function goBack(): void { router.push({ name: 'dashboard' }); }

const playbackStore = usePlaybackStore();
const ch = computed(() => (props.slot === 1 ? playbackStore.slot1 : playbackStore.slot2));

const playlist = ref<PlaylistItemView[]>([]);
const history = ref<PlaybackHistoryView[]>([]);
const busy = ref(false);

async function loadAll(): Promise<void> {
  try {
    const [pl, his] = await Promise.all([listPlaylist(SLOT.value), listHistory(SLOT.value)]);
    playlist.value = pl;
    history.value = his;
  } catch (e) {
    ElMessage.error(`加载播放列表失败: ${(e as Error).message}`);
  }
}
onMounted(() => { void loadAll(); });

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
async function stopPlayback(): Promise<void> {
  busy.value = true;
  try {
    await playbackStore.stop(SLOT.value);
    ElMessage.success(`已终止, ${props.title}回到待机`);
  } catch (e) {
    ElMessage.error(`终止失败: ${(e as Error).message}`);
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
function startRename(it: PlaylistItemView): void {
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
  try {
    await ElMessageBox.confirm(`把「${it.title}」移出播放列表? (媒体库里的文件不会删)`, '移出播放列表', { type: 'warning' });
  } catch { return; }
  try {
    await removeFromPlaylist(it.id);
    await loadAll();
    ElMessage.success('已移出播放列表');
  } catch (e) {
    ElMessage.error(`移出失败: ${(e as Error).message}`);
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

async function openPicker(): Promise<void> {
  pickerOpen.value = true;
  await loadAssets();
}
async function loadAssets(): Promise<void> {
  pickerLoading.value = true;
  try {
    const r = await mediaService.list({ kind: pickerKind.value });
    assets.value = r.items.map((m) => ({ id: m.id, originalName: m.originalName, kind: m.kind }));
  } catch (e) {
    ElMessage.error(`读媒体库失败: ${(e as Error).message}`);
  } finally { pickerLoading.value = false; }
}
async function pickAsset(a: { id: number; originalName: string }): Promise<void> {
  try {
    await addToPlaylist(SLOT.value, a.id);
    await loadAll();
    ElMessage.success(`「${a.originalName}」已加入播放列表`);
  } catch (e) {
    ElMessage.error(`加入失败: ${(e as Error).message}`);
  }
}
/** 已在列表里的不重复加 —— 让业主一眼看出哪些已经加过 */
const inPlaylist = computed(() => new Set(playlist.value.map((x) => x.mediaId)));

// ============ 输入源切换 (业主: "在工具栏页面可以切换各种输入源") ============
// 诺瓦控制器支持的源见 nova-vx1000-protocol.ts: HDMI1=0x11 / HDMI2=0x12,
// 另外 welcome(欢迎页) / video(播我们推的内容) 是控制器的内置动作。
// 2026-07-18 业主: "大屏没声音", 排查发现真因是 HDMI1/HDMI2 直通选项容易被误切到 ——
// 切过去以后, 控制器显示的是外部 HDMI 信号源, 不是我们这套播控系统推的内容/声音,
// 平台这边完全不知道、也管不了。协议又没有"当前源"回读命令 (见下面 lastInput 那条
// 注释), 误切了只能靠人眼现场发现, 排查成本很高。业主原话: "直接删掉, 避免错乱"——
// 干脆不给这个误触的入口, 只留我们真正会用到的两个源。
const INPUTS: Array<{ v: LedInput; label: string; hint: string }> = [
  { v: 'video',   label: '播放内容', hint: '播我们从这里推的视频/图片' },
  { v: 'welcome', label: '欢迎页',   hint: '控制器内置欢迎画面' },
];
/** 当前源没法从设备回读 (协议没有查询命令), 所以只记我们自己发过什么, 不假装知道 */
const lastInput = ref<LedInput | null>(null);
async function switchInput(v: LedInput): Promise<void> {
  if (!props.deviceId) return;
  busy.value = true;
  try {
    const r = await ledService.switchInput(props.deviceId, v);
    if (!r.ok) throw new Error(r.error || '设备未确认');
    lastInput.value = v;
    ElMessage.success(`已切到「${INPUTS.find((x) => x.v === v)?.label}」`);
  } catch (e) {
    ElMessage.error(`切换输入源失败: ${(e as Error).message}`);
  } finally { busy.value = false; }
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
  uploading.value = true;
  uploadPct.value = 0;
  try {
    const m = await mediaService.upload(f, { onProgress: (pct: number) => { uploadPct.value = pct; } });
    // **只入媒体库, 不自动进播放列表** —— 业主: "媒体文件夹内容默认不加入播放列表,
    // 需经管理员确认后再手工加入"。所以这里问一句, 由人决定。
    try {
      await ElMessageBox.confirm(
        `「${m.originalName}」已上传到媒体库。要现在加入播放列表吗?`,
        '上传完成',
        { confirmButtonText: '加入播放列表', cancelButtonText: '只放媒体库', type: 'success' },
      );
      await addToPlaylist(SLOT.value, m.id);
      await loadAll();
      ElMessage.success('已加入播放列表');
    } catch {
      ElMessage.info('已保存到媒体库 (未加入播放列表)');
    }
  } catch (e) {
    ElMessage.error(`上传失败: ${(e as Error).message}`);
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
    <header class="led-head">
      <button class="v2-back-btn" @click="goBack" title="返回首页">
        <ArrowLeft :size="18" :stroke-width="2" />
      </button>
      <div class="led-title"><MonitorPlay :size="18" :stroke-width="1.8" /> {{ title }}</div>
      <span class="led-state" :class="{ on: ch?.currentMediaId, off: !ch?.currentMediaId }">
        {{ ch?.currentMediaId ? (ch.paused ? '已暂停' : '播放中') : '待机' }}
      </span>
      <span v-if="ch && !ch.alive" class="led-warn" title="播放器没有心跳">
        <AlertTriangle :size="14" /> 播放器离线
      </span>
    </header>

    <!-- ===== 正在播 + 播放控制 ===== -->
    <section class="now">
      <div class="now-info">
        <div class="now-label">正在播放</div>
        <div class="now-name" :title="ch?.currentMediaName || ''">
          {{ currentInList?.title || ch?.currentMediaName || '— 待机中 —' }}
        </div>
        <div class="now-sub">
          <span v-if="ch?.loopMode === 'loop'"><Repeat :size="13" /> 循环</span>
          <span v-else><Repeat1 :size="13" /> 播一遍</span>
          <span v-if="ch?.currentMediaId && !currentInList" class="tmp">· 临时推送 (不在播放列表里)</span>
        </div>
      </div>
      <!-- 业主: "暂停、切换、上下内容等均可控制" + "随时可以点击终止" -->
      <div class="now-ctrl">
        <button class="pc-btn" :disabled="busy || playlist.length === 0" title="上一个" @click="step('prev')">
          <SkipBack :size="20" />
        </button>
        <!-- 待机时必须是「播放」而不是一个被禁用的「暂停」(2026-07-17 业主:
             "有停止和暂停按钮, 但是没有播放按钮")。原来 disabled 挂在
             !ch.currentMediaId 上 —— 恰恰在最需要它的时候(待机)把它锁死了。
             口径对齐音响页 BGM 那个已验证好用的: disabled 只看列表空不空。 -->
        <button
          class="pc-btn main"
          :disabled="busy || playlist.length === 0"
          :title="!ch?.currentMediaId ? '播放' : (ch.paused ? '继续' : '暂停')"
          @click="togglePause"
        >
          <Pause v-if="ch?.currentMediaId && !ch.paused" :size="22" />
          <Play v-else :size="22" />
        </button>
        <button class="pc-btn" :disabled="busy || playlist.length === 0" title="下一个" @click="step('next')">
          <SkipForward :size="20" />
        </button>
        <button class="pc-btn stop" :disabled="busy || !ch?.currentMediaId" title="终止播放, 回到待机" @click="stopPlayback">
          <Square :size="18" />
        </button>
      </div>
    </section>

    <!-- 输入源 — 只在传了 deviceId 时出现 (业主: "工具栏页面可以切换各种输入源") -->
    <section v-if="deviceId" class="src-bar">
      <span class="src-label">输入源</span>
      <button
        v-for="i in INPUTS" :key="i.v"
        class="src-btn" :class="{ on: lastInput === i.v }"
        :disabled="busy" :title="i.hint"
        @click="switchInput(i.v)"
      >{{ i.label }}</button>
      <span v-if="!lastInput" class="src-hint">当前源以设备实际为准 — 协议没有回读命令, 这里只记本次切过什么</span>
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
          <input ref="fileInput" type="file" class="hidden-file" accept="video/*,image/*,audio/*" @change="onFilePicked" />
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
          播放列表是空的。点「上传内容」传新素材, 或从右侧历史里加回来。
          <div class="empty-sub">媒体库里的文件不会自动进这里 — 需要你确认后手工加入</div>
        </div>

        <div v-else class="pl-list">
          <div
            v-for="it in playlist" :key="it.id"
            class="pl-item"
            :class="{
              playing: ch?.currentMediaId === it.mediaId, missing: it.missing,
              dragging: dragId === it.id, dropzone: dragOverId === it.id,
            }"
            draggable="true"
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
              v-model="editingText" class="pl-name-input" maxlength="60"
              @click.stop @keyup.enter="commitRename(it)"
              @keyup.esc="editingId = null" @blur="commitRename(it)"
            />
            <span v-else class="pl-name" :title="it.title" @dblclick="startRename(it)">
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
.led-page { display: flex; flex-direction: column; gap: 12px; height: 100%; padding: 12px; min-height: 0; }
.led-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.led-title { display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 700; color: var(--v2-text-1); }
.led-state { padding: 3px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; }
.led-state.on { background: #14532d55; color: #4ade80; }
.led-state.off { background: #1A1D22; color: var(--v2-text-2); }
.led-warn { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: #E0A030; }

/* 正在播 + 控制条 */
.now {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 14px 16px; border-radius: 14px;
  background: var(--v2-surface, #14161A); border: 1px solid var(--v2-border-soft);
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
  background: var(--v2-surface-2, #1A1D22);
  border: 1px solid var(--v2-border, #23262C); color: var(--v2-text-1);
}
.pc-btn:disabled { opacity: .35; cursor: not-allowed; }
.pc-btn.main { width: 60px; height: 60px; background: var(--v2-primary-soft); border-color: var(--v2-primary); color: #fff; }
.pc-btn.stop:not(:disabled):hover { border-color: #E5645D; color: #E5645D; }

.src-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 14px; border-radius: 12px;
  background: var(--v2-surface, #14161A); border: 1px solid var(--v2-border-soft);
}
.src-label { font-size: 13px; color: var(--v2-text-2); }
.src-btn {
  padding: 9px 16px; min-height: 40px; border-radius: 9px; cursor: pointer;
  font-size: 14px; color: var(--v2-text-1);
  background: var(--v2-surface-2, #1A1D22); border: 1px solid var(--v2-border, #23262C);
}
.src-btn.on { border-color: var(--v2-primary); background: var(--v2-primary-soft); color: #fff; }
.src-btn:disabled { opacity: .4; cursor: not-allowed; }
.src-hint { font-size: 11px; color: #6d7f98; }

/* align-items: start (不是默认的 stretch) —— 列表/历史内容短的时候(比如只有 2 条),
   不强行把卡片撑满 .cols 剩余高度, 卡片底下露一大截空白背景 (业主反馈: "下面还有不少
   空间")。卡片改成跟内容一样高, 多出来的空间就是页面背景, 不再是半空的卡片。
   长列表需要滚动时靠 .panel 的 max-height + .pl-list 的 overflow-y 兜底, 不受影响。 */
.cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; flex: 0 1 auto; max-height: 100%; min-height: 0; align-items: start; }
.panel {
  display: flex; flex-direction: column; min-height: 0; max-height: 100%;
  border-radius: 14px; padding: 12px;
  background: var(--v2-surface, #14161A); border: 1px solid var(--v2-border-soft);
}
.panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.panel-title { display: inline-flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 700; color: var(--v2-text-1); }
.panel-count { font-size: 12px; color: var(--v2-text-2); background: #1A1D22; border-radius: 20px; padding: 2px 8px; }
.panel-head .v2-quick { margin-left: auto; }
/* 上传中: 原来 disabled 让按钮变灰, 文字跟底色糊在一起完全看不清 (业主截图坐实)。
   改成"进度填充"样式: 深底 + 亮字 + 一条随进度走的填充, 一眼看得见传到哪了。 */
.v2-quick.uploading {
  position: relative; overflow: hidden;
  opacity: 1 !important;                 /* 盖掉 disabled 的变灰 */
  color: #fff; font-weight: 600;
  background: #0f2942; border-color: var(--v2-primary);
}
.v2-quick.uploading::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: var(--pct, 0%); background: var(--v2-primary-soft);
  transition: width .2s linear; z-index: 0;
}
.v2-quick.uploading > * { position: relative; z-index: 1; }
.hidden-file { display: none; }

.empty { padding: 20px; text-align: center; font-size: 13px; color: var(--v2-text-2); border: 1px dashed var(--v2-border-soft); border-radius: 10px; }
.empty-sub { margin-top: 6px; font-size: 12px; color: #6d7f98; }

.pl-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.pl-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 10px;
  background: var(--v2-surface-2, #1A1D22); border: 1px solid transparent;
}
.pl-item.playing { border-color: var(--v2-primary); background: #16375a; }
.pl-item.dragging { opacity: .45; }
/* 拖到哪儿哪儿亮一条虚线 —— 松手前就知道会落在哪, 不用猜 */
.pl-item.dropzone { outline: 2px dashed var(--v2-primary); outline-offset: 2px; }
.pl-grip { display: inline-flex; align-items: center; color: var(--v2-text-2); cursor: grab; flex: 0 0 auto; }
.pl-grip:active { cursor: grabbing; }
.pl-item.missing { opacity: .55; }
.pl-play {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; flex: 0 0 auto; border-radius: 8px; cursor: pointer;
  background: transparent; border: 1px solid var(--v2-border); color: var(--v2-text-1);
}
.pl-play:disabled { opacity: .35; cursor: not-allowed; }
.pl-name { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; }
.pl-name-input {
  flex: 1 1 auto; min-width: 0; padding: 5px 8px; font-size: 14px;
  color: var(--v2-text-1); background: rgba(0,0,0,.35);
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
.pl-ico.danger:hover { color: #ff6b6b; }
.pl-ico:disabled { opacity: .3; cursor: not-allowed; }

/* 选择器弹窗 */
.pick-mask {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.pick-box {
  width: min(560px, 100%); max-height: 76vh; display: flex; flex-direction: column;
  background: var(--v2-surface, #14161A); border: 1px solid var(--v2-border, #23262C);
  border-radius: 14px; padding: 14px;
}
.webpage-box { gap: 6px; }
.wb-hint { font-size: 12px; color: var(--v2-text-3); margin-bottom: 8px; }
.wb-label { font-size: 12px; color: var(--v2-text-3); margin-top: 6px; }
.wb-input {
  background: rgba(255,255,255,0.04); border: 1px solid var(--v2-border-soft); border-radius: 8px;
  padding: 10px 12px; color: var(--v2-text-1); font-size: 14px; outline: none; font-family: inherit;
}
.wb-input:focus { border-color: var(--v2-primary); }
.wb-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.pick-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.pick-title { display: inline-flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 700; color: var(--v2-text-1); }
.pick-tabs { display: flex; gap: 4px; margin-left: auto; }
.pick-tab {
  padding: 7px 14px; min-height: 36px; border-radius: 8px; cursor: pointer; font-size: 13px;
  background: var(--v2-surface-2, #1A1D22); border: 1px solid var(--v2-border, #23262C); color: var(--v2-text-2);
}
.pick-tab.on { border-color: var(--v2-primary); color: #fff; background: var(--v2-primary-soft); }
.pick-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 8px; cursor: pointer;
  background: transparent; border: 1px solid var(--v2-border); color: var(--v2-text-2);
}
.pick-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.pick-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 11px 12px; min-height: 46px; border-radius: 10px; cursor: pointer; text-align: left;
  background: var(--v2-surface-2, #1A1D22); border: 1px solid transparent; color: var(--v2-text-1);
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
  background: var(--v2-surface, #14161A); border: 1px solid var(--v2-border, #23262C); color: var(--v2-text-2);
}
.mob-tab.on { border-color: var(--v2-primary); color: #fff; background: var(--v2-primary-soft); }
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
</style>
