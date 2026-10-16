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
import { computed, onMounted, onScopeDispose } from 'vue';
import { captureIdentityGuard } from '@/services/identity-boundary';
import { ElScrollbar } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, MonitorPlay, Play, Pause, Square, SkipBack, SkipForward,
  Upload, ListMusic, History, Pencil, Trash2, Plus, Repeat, Repeat1, AlertTriangle, GripVertical, FolderOpen, X,
  Globe,
  ChevronLeft, ChevronRight, Power, ZoomIn, ZoomOut, Maximize, RefreshCw, RotateCcw,
} from 'lucide-vue-next';
import { usePlaybackStore } from '@/stores/playback';
import { publishWelcome } from '@/services/playback.service';
import { useAdminUnlock } from '@/composables/useAdminUnlock';
import { useWelcomeEditor } from '@/composables/useWelcomeEditor';
import { usePlayerInputSources } from '@/composables/usePlayerInputSources';
import { usePlayerPlaylist } from '@/composables/usePlayerPlaylist';
import { usePlayerDocumentControls } from '@/composables/usePlayerDocumentControls';
import PlayerVideoControls from '@/components/PlayerVideoControls.vue';
import { usePlayerPowerControls } from '@/composables/usePlayerPowerControls';
import { WELCOME_PICK_DEFAULT, detectPlayerInputSource } from '@/features/player-input-source';
import { MEDIA_UPLOAD_ACCEPT } from '@/services/media.service';

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

const { ensureAdmin, ensureContentEditor } = useAdminUnlock();
const playbackStore = usePlaybackStore();
const ch = computed(() => (props.slot === 1 ? playbackStore.slot1 : playbackStore.slot2));

let consoleDisposed = false;
onScopeDispose(() => {
  consoleDisposed = true;
});
function captureConsoleAction(): () => boolean {
  const slot = SLOT.value;
  return captureIdentityGuard(() => !consoleDisposed && SLOT.value === slot);
}
const {
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
} = usePlayerPlaylist({
  slot: SLOT,
  title: () => props.title,
  channel: ch,
  ensureAdmin,
  captureAction: captureConsoleAction,
});
const {
  isDocPlaying,
  docPage,
  docTotal,
  docZoom,
  applyDocZoom,
  gotoDocPage,
  exitDocShow,
} = usePlayerDocumentControls({
  slot: SLOT,
  title: () => props.title,
  channel: ch,
  captureAction: captureConsoleAction,
  stopPlayback,
});

const {
  powerCircuits,
  powerAllOn,
  powerBusy,
  togglePower,
} = usePlayerPowerControls({
  title: () => props.title,
  powerCode: () => props.powerCode,
  powerNameGroups: () => props.powerNameGroups,
  captureAction: captureConsoleAction,
});

onMounted(() => {
  void loadAll(); void refreshWelcomeSchemeOptions(); });

// 输入源身份只从播放通道权威状态派生；切换与运营大屏控制由专用用例编排。
const activeSource = computed(() => detectPlayerInputSource(ch.value));

const {
  welcomeEditOpen,
  welcomeSaving,
  welcomePublishing,
  welcomeLoading,
  welcomeForm,
  welcomeSchemeName,
  welcomeSchemes,
  welcomeSchemesRevision,
  selectedWelcomeSchemeId,
  publishedWelcomeSchemeId,
  LED_CANVAS_RESOLUTION,
  welcomePreviewUrl,
  welcomePreviewFrame,
  logoAssets,
  bgAssets,
  rejectedBgAssetCount,
  incompatibleSelectedBackground,
  incompatibleSelectedLogo,
  welcomeBgUploadInput,
  welcomeLogoUploadInput,
  welcomeAssetUploading,
  welcomeAssetUploadPct,
  welcomeAssetDeletingId,
  lastWelcomeSaveRevision,
  welcomeLayoutOptions,
  welcomeToneOptions,
  welcomeOverlayOptions,
  welcomePositionOptions,
  welcomeLogoSizeOptions, welcomeTitleEffectOptions, welcomeHidden, welcomeDisplayRows,
  markWelcomeDraftChanged,
  setWelcomeSize,
  vWelcomeThumb,
  requestCloseWelcomeEditor,
  pushWelcomePreview,
  selectWelcomeScheme,
  openWelcomeEditor,
  pickWelcomeAsset,
  onWelcomeAssetPicked,
  selectWelcomeBackground,
  deleteWelcomeImage,
  saveWelcomeScheme,
  saveAndCloseWelcomeEditor,
  publishSelectedWelcomeScheme,
  selectWelcomeLogo,
  selectDefaultWelcomeBackground,
  updateWelcomePresentation,
  duplicateWelcomeScheme,
  deleteWelcomeScheme,
} = useWelcomeEditor({
  ensureAdmin,
  ensureContentEditor,
  captureAction: captureConsoleAction,
  isEditableSourceActive: () => activeSource.value === 'welcome-editable',
  // 保持原发布语义：只重推当前动态欢迎页；错误继续抛给编辑器显示“已发布但重推失败”。
  republishEditable: async () => { await publishWelcome(SLOT.value, 'editable'); },
});

const {
  srcHint,
  welcomePickerBusy,
  welcomePickerValue,
  parkOpsPage,
  parkOpsTotalPages,
  parkOpsAuto,
  parkOpsBusy,
  parkOpsClaimed,
  parkOpsClaimByMe,
  parkOpsClaimName,
  parkOpsClaimRemaining,
  releaseParkOps,
  refreshWelcomeSchemeOptions,
  selectContent,
  onWelcomeSchemePick,
  selectParkDashboard,
  parkOpsControl,
} = usePlayerInputSources({
  slot: SLOT,
  title: () => props.title,
  deviceId: () => props.deviceId,
  activeSource,
  playlist,
  busy,
  welcomeSchemes,
  welcomeSchemesRevision,
  publishedWelcomeSchemeId,
  ensureAdmin,
  ensureContentEditor,
  captureAction: captureConsoleAction,
  nextPlayback: (slot) => playbackStore.next(slot),
  reloadLists: loadAll,
});

// 欢迎页编辑和输入源切换均已收敛到组合式用例；本组件保留模板与播放器编排。

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
            <span v-if="parkOpsClaimed" class="claim-tag" :class="{ mine: parkOpsClaimByMe }">
              · {{ parkOpsClaimByMe ? '您正在远程控制' : `${parkOpsClaimName || '远程终端'} 控制中` }}
              {{ Math.ceil(parkOpsClaimRemaining / 1000) }}s
            </span>
            <button v-if="parkOpsClaimByMe" class="claim-release" @click="releaseParkOps">释放控制</button>
          </template>
          <template v-else>
            <span v-if="ch?.currentMediaKind !== 'video' && ch?.loopMode === 'loop'"><Repeat :size="13" /> 循环</span>
            <span v-else-if="ch?.currentMediaKind !== 'video'"><Repeat1 :size="13" /> 播一遍</span>
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
      <PlayerVideoControls :slot="SLOT" />
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
      <select
        class="src-welcome-select"
        :class="{ on: activeSource === 'welcome-editable' || activeSource === 'welcome-default' }"
        :value="welcomePickerValue"
        :disabled="busy || welcomePickerBusy"
        aria-label="选择欢迎页方案"
        @change="onWelcomeSchemePick"
      >
        <option value="" disabled>欢迎页方案</option>
        <option :value="WELCOME_PICK_DEFAULT">静态默认欢迎页</option>
        <option v-for="s in welcomeSchemes" :key="s.id" :value="s.id">
          {{ s.name }}{{ publishedWelcomeSchemeId === s.id ? ' · 使用中' : '' }}
        </option>
      </select>
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
    <div v-if="welcomeEditOpen" class="pick-mask welcome-mask" @click.self="requestCloseWelcomeEditor">
      <div class="pick-box we-box">
        <header class="pick-head">
          <span class="pick-title"><Pencil :size="16" /> 编辑欢迎页</span>
          <button class="pick-close" @click="requestCloseWelcomeEditor"><X :size="18" /></button>
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
            <input v-model="welcomeSchemeName" class="wb-input" maxlength="40" placeholder="如：某公司来访" @input="markWelcomeDraftChanged" />
            <label class="wb-label">主标题 (空 = 默认「热烈欢迎」)</label>
            <div class="wb-text-size-row">
              <input v-model="welcomeForm.welcomeTitle" class="wb-input" maxlength="32" placeholder="热烈欢迎" @input="markWelcomeDraftChanged" />
              <input type="number" class="wb-size-input" :value="welcomeForm.welcomeTitleSize ?? 180" min="40" max="400" step="2" inputmode="numeric" title="主标题字号，默认 180；清空恢复默认" @input="setWelcomeSize($event, 'title')" />
            </div>
            <label class="wb-label">嘉宾行（整行可编辑，空 = 默认整行）</label>
            <div class="wb-text-size-row">
              <input v-model="welcomeForm.welcomeGuest" class="wb-input" maxlength="120" placeholder="各位领导嘉宾莅临参观指导" @input="markWelcomeDraftChanged" />
              <input type="number" class="wb-size-input" :value="welcomeForm.welcomeGuestSize ?? 96" min="24" max="240" step="2" inputmode="numeric" title="嘉宾行字号，默认 96；清空恢复默认" @input="setWelcomeSize($event, 'guest')" />
            </div>
            <label class="wb-label">底部标语 (空 = 默认「智慧展厅 · 数字展贸 · 科创未来」)</label>
            <div class="wb-text-size-row">
              <input v-model="welcomeForm.welcomeTagline" class="wb-input" maxlength="64" placeholder="智慧展厅 · 数字展贸 · 科创未来" @input="markWelcomeDraftChanged" />
              <input type="number" class="wb-size-input" :value="welcomeForm.welcomeTaglineSize ?? 48" min="18" max="160" step="1" inputmode="numeric" title="底部标语字号，默认 48；清空恢复默认" @input="setWelcomeSize($event, 'tagline')" />
            </div>
            <div v-for="row in welcomeDisplayRows" :key="row.formKey" class="wb-display-row">
              <div class="wb-display-main">
                <label class="wb-label">{{ row.label }}</label>
                <input v-model="welcomeForm[row.formKey]" class="wb-input" :maxlength="row.maxlength" :disabled="welcomeHidden[row.hideKey]" :placeholder="row.placeholder" @input="markWelcomeDraftChanged" />
              </div>
              <label class="wb-hide-check"><input type="checkbox" v-model="welcomeHidden[row.hideKey]" @change="markWelcomeDraftChanged" />隐藏</label>
            </div>
            <div class="we-presentation-head">
              <strong>画面版式</strong>
              <span>版式随方案独立保存，切换底图和 Logo 后不会继续套用一张固定模板</span>
            </div>
            <div class="we-layout-grid" role="radiogroup" aria-label="欢迎页画面版式">
              <button
                v-for="option in welcomeLayoutOptions"
                :key="option.value"
                type="button"
                class="we-layout-option"
                :class="{ on: welcomeForm.presentation.layout === option.value }"
                role="radio"
                :aria-checked="welcomeForm.presentation.layout === option.value"
                @click="updateWelcomePresentation('layout', option.value)"
              >
                <span class="we-layout-swatch" :data-layout="option.value"><i></i><b></b></span>
                <strong>{{ option.name }}</strong>
                <small>{{ option.hint }}</small>
              </button>
            </div>
            <div class="we-style-controls">
              <div class="we-style-control">
                <span>文字色调</span>
                <div>
                  <button
                    v-for="option in welcomeToneOptions" :key="option.value" type="button"
                    :class="{ on: welcomeForm.presentation.tone === option.value }"
                    @click="updateWelcomePresentation('tone', option.value)"
                  >{{ option.name }}</button>
                </div>
              </div>
              <div class="we-style-control">
                <span>背景遮罩</span>
                <div>
                  <button
                    v-for="option in welcomeOverlayOptions" :key="option.value" type="button"
                    :class="{ on: welcomeForm.presentation.overlay === option.value }"
                    @click="updateWelcomePresentation('overlay', option.value)"
                  >{{ option.name }}</button>
                </div>
              </div>
              <div class="we-style-control">
                <span>文字位置</span>
                <div>
                  <button
                    v-for="option in welcomePositionOptions" :key="option.value" type="button"
                    :class="{ on: welcomeForm.presentation.contentPosition === option.value }"
                    @click="updateWelcomePresentation('contentPosition', option.value)"
                  >{{ option.name }}</button>
                </div>
              </div>
              <div class="we-style-control">
                <span>Logo 尺寸</span>
                <div>
                  <button
                    v-for="option in welcomeLogoSizeOptions" :key="option.value" type="button"
                    :class="{ on: welcomeForm.presentation.logoSize === option.value }"
                    @click="updateWelcomePresentation('logoSize', option.value)"
                  >{{ option.name }}</button>
                </div>
              </div>
              <div class="we-style-control we-title-effect">
                <span>主标题效果</span>
                <div>
                  <button
                    v-for="option in welcomeTitleEffectOptions" :key="option.value" type="button"
                    :class="{ on: welcomeForm.presentation.titleEffect === option.value }"
                    :title="option.hint"
                    @click="updateWelcomePresentation('titleEffect', option.value)"
                  >{{ option.name }}</button>
                </div>
              </div>
            </div>
            <label class="wb-label we-asset-label">Logo 图片</label>
            <div v-if="incompatibleSelectedLogo" class="we-warning">
              原 Logo 图片已不可用，预览和大屏已回退内置场馆 Logo；保存后会清除旧绑定。
            </div>
            <div class="we-bg-grid we-logo-grid">
              <button
                type="button"
                class="we-bg-item" :class="{ on: welcomeForm.welcomeLogoMediaId === null }"
                title="使用内置场馆 Logo" @click="selectWelcomeLogo(null)"
              ><span class="we-logo-default">内置场馆 Logo</span></button>
              <div v-for="a in logoAssets" :key="`logo-${a.id}`" class="we-asset-card">
                <button
                  type="button"
                  class="we-bg-item" :class="{ on: welcomeForm.welcomeLogoMediaId === a.id }"
                  :title="a.originalName" @click="selectWelcomeLogo(a.id)"
                >
                  <img class="we-logo-image" v-welcome-thumb="{ id: a.id, kind: 'logo' }" alt="" />
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
                type="button"
                class="we-bg-item" :class="{ on: welcomeForm.welcomeBgMediaId === null }"
                title="内置品牌底图" @click="selectDefaultWelcomeBackground"
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
                  <img v-welcome-thumb="{ id: a.id, kind: 'background' }" alt="" />
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
            <button class="v2-quick" :disabled="welcomeSaving || welcomePublishing || !!welcomeAssetUploading || welcomeAssetDeletingId !== null" @click="requestCloseWelcomeEditor">取消</button>
            <button class="v2-quick" :disabled="welcomeSaving || welcomePublishing || !!welcomeAssetUploading || welcomeAssetDeletingId !== null" @click="saveWelcomeScheme">
              {{ welcomeSaving ? '保存并校验中…' : '仅保存方案' }}
            </button>
            <button class="v2-quick secondary" :disabled="welcomeSaving || welcomePublishing || !!welcomeAssetUploading || welcomeAssetDeletingId !== null" @click="saveAndCloseWelcomeEditor">
              保存并关闭
            </button>
            <button class="v2-quick primary" :disabled="welcomeSaving || welcomePublishing || !!welcomeAssetUploading || welcomeAssetDeletingId !== null" @click="publishSelectedWelcomeScheme">
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
  padding: 14px 16px; border-radius: var(--v2-r-lg);
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
.now-sub .claim-tag { color: #D98A2B; } .now-sub .claim-tag.mine { color: #2FA36B; font-weight: 600; }
.now-sub .claim-release { border:1px solid rgba(47,163,107,.45); background:rgba(47,163,107,.12); color:#2FA36B; border-radius:999px; font-size:11px; line-height:1; padding:3px 9px; cursor:pointer; } .now-sub .claim-release:hover { background:rgba(47,163,107,.22); }
.now-ctrl { display: flex; align-items: center; gap: 10px; }
/* 触摸目标做足 —— 现场是站着用平板点的 */
.pc-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; border-radius: var(--v2-r-md); cursor: pointer;
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
  padding: 10px 14px; border-radius: var(--v2-r-md);
  background: var(--v2-surf-1, #14161A); border: 1px solid var(--v2-border-soft);
}
.src-label { font-size: 13px; color: var(--v2-text-2); }
.src-btn {
  padding: 9px 16px; min-height: 40px; border-radius: var(--v2-r-md); cursor: pointer;
  font-size: 14px; color: var(--v2-text-1);
  background: var(--v2-surf-2, #1A1D22); border: 1px solid var(--v2-border-soft, #23262C);
}
.src-btn.on { border-color: var(--v2-primary); background: var(--v2-primary); color: var(--v2-on-primary); }
.src-btn:disabled { opacity: .4; cursor: not-allowed; }
.src-btn.dashboard { display: inline-flex; align-items: center; gap: 5px; }
.src-btn.edit { display: inline-flex; align-items: center; gap: 5px; color: var(--v2-primary); border-style: dashed; }
.src-hint { font-size: 11px; color: var(--v2-text-3); }
.src-welcome-select {
  padding: 9px 14px; min-height: 40px; border-radius: var(--v2-r-md); cursor: pointer;
  font-size: 14px; color: var(--v2-text-1); font-family: inherit;
  background: var(--v2-surf-2, #1A1D22); border: 1px solid var(--v2-border-soft, #23262C);
  max-width: 220px;
}
.src-welcome-select.on { border-color: var(--v2-primary); color: var(--v2-primary); }
.src-welcome-select:disabled { opacity: .4; cursor: not-allowed; }
.src-welcome-select option { color: #e8edf4; background: #14161A; }

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
  padding: 10px 12px; border-radius: var(--v2-r-md);
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
  min-width: 120px; min-height: 43px; padding: 7px 10px; border-radius: var(--v2-r-md); cursor: pointer;
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
  padding: 9px 10px; border: 1px solid var(--v2-border-soft); border-radius: var(--v2-r-md);
  background: var(--v2-surf-2);
}
.we-upload-row .v2-quick { display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.we-upload-row span { color: var(--v2-text-3); font-size: 11px; line-height: 1.35; }
.we-asset-label { margin-top: 10px; }
.we-presentation-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin-top: 10px;
}
.we-presentation-head strong { color: var(--v2-text-1); font-size: 13px; }
.we-presentation-head span { color: var(--v2-text-3); font-size: 11px; text-align: right; }
.we-layout-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.we-layout-option {
  min-width: 0; padding: 9px; border-radius: var(--v2-r-md); cursor: pointer; text-align: left;
  color: var(--v2-text-2); background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft);
}
.we-layout-option.on {
  color: var(--v2-text-1); border-color: var(--v2-primary);
  background: color-mix(in srgb, var(--v2-primary) 9%, var(--v2-surf-2));
}
.we-layout-option:focus-visible, .we-style-control button:focus-visible {
  outline: 2px solid var(--v2-primary); outline-offset: 2px;
}
.we-layout-option > strong { display: block; margin-top: 7px; font-size: 12px; }
.we-layout-option > small { display: block; margin-top: 2px; color: var(--v2-text-3); font-size: 10px; line-height: 1.4; }
.we-layout-swatch {
  position: relative; display: block; height: 42px; overflow: hidden; border-radius: var(--v2-r-sm);
  background: #102942;
}
.we-layout-swatch::before, .we-layout-swatch i, .we-layout-swatch b {
  content: ''; position: absolute; display: block; background: rgba(236,245,255,.9);
}
.we-layout-swatch::before { width: 22%; height: 4px; top: 8px; left: 39%; border-radius: 2px; }
.we-layout-swatch i { width: 48%; height: 5px; top: 19px; left: 26%; border-radius: 2px; }
.we-layout-swatch b { width: 32%; height: 2px; top: 30px; left: 34%; opacity: .65; }
.we-layout-swatch[data-layout="editorial"]::before,
.we-layout-swatch[data-layout="editorial"] i,
.we-layout-swatch[data-layout="editorial"] b { left: 12%; }
.we-layout-swatch[data-layout="editorial"]::before { width: 18%; }
.we-layout-swatch[data-layout="editorial"] i { width: 42%; }
.we-layout-swatch[data-layout="editorial"] b { width: 28%; }
.we-layout-swatch[data-layout="minimal"] { background: #e9eff5; }
.we-layout-swatch[data-layout="minimal"]::before,
.we-layout-swatch[data-layout="minimal"] i,
.we-layout-swatch[data-layout="minimal"] b { background: #173b60; }
.we-layout-swatch[data-layout="minimal"]::before { width: 16%; left: 42%; }
.we-layout-swatch[data-layout="minimal"] i { width: 36%; left: 32%; }
.we-layout-swatch[data-layout="minimal"] b { width: 22%; left: 39%; }
.we-style-controls {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;
  padding: 9px; border: 1px solid var(--v2-border-soft); border-radius: var(--v2-r-md);
}
.we-style-control { min-width: 0; }
.we-style-control > span { display: block; margin-bottom: 5px; color: var(--v2-text-3); font-size: 10px; }
.we-style-control > div { display: flex; gap: 4px; }
.we-style-control button {
  flex: 1 1 0; min-height: 32px; padding: 5px 7px; border-radius: var(--v2-r-sm); cursor: pointer;
  color: var(--v2-text-2); background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  font-size: 11px;
}
.we-style-control button.on {
  color: var(--v2-on-primary); background: var(--v2-primary); border-color: var(--v2-primary);
}
.we-logo-grid { overflow: visible; }
.we-logo-image { object-fit: contain !important; padding: 7px; background: rgba(255,255,255,.92); }
.we-logo-default {
  position: absolute; inset: 0; display: grid; place-items: center; padding: 8px;
  color: var(--v2-primary); font-size: 12px; text-align: center;
  background: radial-gradient(circle at 50% 45%, var(--v2-primary-soft), var(--v2-surf-2) 68%);
}
.we-preview {
  position: relative; width: 100%; aspect-ratio: 3612 / 1462; overflow: hidden;
  margin: 4px 0 8px; border-radius: var(--v2-r-md); background: #06101f;
  border: 1px solid var(--v2-border-soft); box-shadow: inset 0 0 0 1px rgba(255,255,255,.025);
}
.we-preview iframe { width: 100%; height: 100%; display: block; border: 0; pointer-events: none; }
.we-warning, .we-note { padding: 8px 10px; border-radius: var(--v2-r-sm); font-size: 12px; line-height: 1.45; }
.we-warning { color: var(--v2-warning); background: color-mix(in srgb, var(--v2-warning) 10%, transparent); }
.we-note { color: var(--v2-text-3); background: var(--v2-surf-2); }
.we-bg-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 8px; margin-top: 6px;
}
.we-bg-item {
  position: relative; height: 82px; border-radius: var(--v2-r-md); overflow: hidden; cursor: pointer;
  background: var(--v2-surf-2, #1A1D22); border: 2px solid var(--v2-border-soft, #23262C);
  padding: 0; display: grid; place-items: center;
}
.we-asset-card { position: relative; min-width: 0; }
.we-asset-card .we-bg-item { width: 100%; }
.we-bg-item.invalid { opacity: .72; cursor: pointer; border-style: dashed; }
.we-asset-delete {
  position: absolute; z-index: 2; top: 5px; right: 5px;
  width: 40px; height: 40px; padding: 0; border-radius: var(--v2-r-md);
  display: grid; place-items: center; cursor: pointer;
  color: #fff; background: rgba(127, 29, 29, .9); border: 1px solid rgba(255,255,255,.22);
  box-shadow: 0 3px 12px rgba(0,0,0,.28);
}
.we-asset-delete:hover { background: var(--v2-danger); }
.we-asset-delete:disabled { opacity: .5; cursor: wait; }
.we-bg-item.on { border-color: var(--v2-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--v2-primary) 35%, transparent); }
.we-bg-item img { width: 100%; height: 100%; object-fit: cover; }
.we-bg-item img:not([src]) { visibility: hidden; }
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
  .we-presentation-head { align-items: flex-start; flex-direction: column; gap: 2px; }
  .we-presentation-head span { text-align: left; }
  .we-layout-grid { grid-template-columns: 1fr; }
  .we-layout-option { display: grid; grid-template-columns: 90px 1fr; column-gap: 9px; align-items: center; }
  .we-layout-option .we-layout-swatch { grid-row: 1 / 3; }
  .we-layout-option > strong { margin-top: 0; }
  .we-style-controls { grid-template-columns: 1fr; }
  .we-scroll-content { padding-right: 10px; }
  .we-scroll :deep(.el-scrollbar__bar.is-vertical) { width: 7px; }
  .we-bg-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* 44px 触摸目标 + 16px 字号, 防 iOS 聚焦自动放大; 与其它源按钮并排不撑乱 */
  .src-welcome-select { min-height: 44px; font-size: 16px; max-width: 46vw; flex: 1 1 auto; }
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
  border-radius: var(--v2-r-lg); padding: 12px;
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

.empty { padding: 20px; text-align: center; font-size: 13px; color: var(--v2-text-2); border: 1px dashed var(--v2-border-soft); border-radius: var(--v2-r-md); }
.empty-sub { margin-top: 6px; font-size: 12px; color: var(--v2-text-3); }

.pl-list { flex: 1 1 auto; min-height: 0; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.pl-item {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  padding: 8px 10px; border-radius: var(--v2-r-md);
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
  width: 34px; height: 34px; flex: 0 0 auto; border-radius: var(--v2-r-sm); cursor: pointer;
  background: transparent; border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.pl-play:disabled { opacity: .35; cursor: not-allowed; }
.pl-name { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; }
.pl-name-input {
  flex: 1 1 auto; min-width: 0; padding: 5px 8px; font-size: 14px;
  color: var(--v2-text-1); background: var(--v2-inset-bg);
  border: 1px solid var(--v2-primary); border-radius: var(--v2-r-sm); outline: none;
}
.tag-missing { margin-left: 6px; padding: 1px 6px; border-radius: 4px; background: #7f1d1d55; color: #EC8880; font-size: 11px; font-style: normal; }
.pl-now { font-size: 11px; color: var(--v2-primary); flex: 0 0 auto; }
.pl-time { font-size: 12px; color: var(--v2-text-2); flex: 0 0 auto; }
.pl-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; flex: 0 0 auto; border-radius: var(--v2-r-sm); cursor: pointer;
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
  border-radius: var(--v2-r-lg); padding: 14px;
}
.webpage-box { gap: 6px; }
.wb-hint { font-size: 12px; color: var(--v2-text-3); margin-bottom: 8px; }
.wb-label { font-size: 12px; color: var(--v2-text-3); margin-top: 6px; }
.wb-input {
  background: var(--v2-ov-1); border: 1px solid var(--v2-border-soft); border-radius: var(--v2-r-sm);
  padding: 10px 12px; color: var(--v2-text-1); font-size: 14px; outline: none; font-family: inherit;
}
.wb-input:focus { border-color: var(--v2-primary); }
.wb-input:disabled { opacity: .45; cursor: not-allowed; }
.wb-text-size-row { display: flex; align-items: stretch; gap: 8px; }
.wb-text-size-row .wb-input { flex: 1 1 auto; min-width: 0; }
.wb-size-input {
  flex: 0 0 86px; width: 86px; box-sizing: border-box; text-align: center;
  background: var(--v2-ov-1); border: 1px solid var(--v2-border-soft); border-radius: var(--v2-r-sm);
  padding: 10px 6px; color: var(--v2-text-1); font-size: 13px; outline: none; font-family: inherit;
}
.wb-size-input:focus { border-color: var(--v2-primary); }
.wb-size-input::placeholder { color: var(--v2-text-3); }
@media (max-width: 420px) { .wb-size-input { flex-basis: 74px; width: 74px; } }
.wb-display-row { display: flex; align-items: flex-end; gap: 8px; }
.wb-display-main { flex: 1 1 auto; min-width: 0; }
.wb-hide-check {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px;
  padding-bottom: 9px; font-size: 12px; color: var(--v2-text-3); white-space: nowrap; cursor: pointer; user-select: none;
}
.wb-hide-check input { margin: 0; cursor: pointer; }
.we-title-effect > div { flex-wrap: wrap; gap: 5px; }
.we-title-effect button { flex: 0 0 auto; white-space: nowrap; padding: 5px 11px; }
.wb-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.pick-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.pick-title { display: inline-flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 700; color: var(--v2-text-1); }
.pick-tabs { display: flex; gap: 4px; margin-left: auto; }
.pick-tab {
  padding: 7px 14px; min-height: 36px; border-radius: var(--v2-r-sm); cursor: pointer; font-size: 13px;
  background: var(--v2-surf-2, #1A1D22); border: 1px solid var(--v2-border-soft, #23262C); color: var(--v2-text-2);
}
.pick-tab.on { border-color: var(--v2-primary); color: var(--v2-primary); background: var(--v2-primary-soft); font-weight: 600; }
.pick-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: var(--v2-r-sm); cursor: pointer;
  background: transparent; border: 1px solid var(--v2-border-soft); color: var(--v2-text-2);
}
.pick-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.pick-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 11px 12px; min-height: 46px; border-radius: var(--v2-r-md); cursor: pointer; text-align: left;
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
  padding: 11px; min-height: 46px; border-radius: var(--v2-r-md); cursor: pointer; font-size: 14px;
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
  border-radius: var(--v2-r-md);
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
