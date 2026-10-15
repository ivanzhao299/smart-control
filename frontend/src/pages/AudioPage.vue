<script setup lang="ts">
import { computed, onMounted, onUnmounted, onDeactivated, ref } from 'vue';
import { useActivePolling } from '@/composables/useActivePolling';
import { useRouter, useRoute } from 'vue-router';
import {
  ArrowLeft, Speaker, Volume2, Play, Sparkles, Music, Square, Pause,
  SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Trash2, Pencil } from 'lucide-vue-next';
import { useAdminUnlock } from '@/composables/useAdminUnlock';
import { useAudioPlaylist } from '@/composables/useAudioPlaylist';
import { useAudioInputs } from '@/composables/useAudioInputs';
import { useAudioMatrix } from '@/composables/useAudioMatrix';
import { useAudioOutputCatalog } from '@/composables/useAudioOutputCatalog';
import { useAudioOutputControls } from '@/composables/useAudioOutputControls';
import { useAudioScenes } from '@/composables/useAudioScenes';
import {
  formatAudioDuration,
  summarizeAudioOutputs,
} from '@/features/audio-view-model';

const router = useRouter();
const route = useRoute();
const { ensureAdmin } = useAdminUnlock();
const {
  channels,
  displayChannels,
  editingChannelId: editingCh,
  editingChannelText: editingChText,
  catalogBusy,
  partnerOf,
  displayName,
  isStereo,
  displayAddress: displayAddr,
  stereoRows: duoRows,
  linkOn,
  setLink,
  loadOutputChannels: loadZones,
  startRenameChannel: startRenameCh,
  cancelRenameChannel: cancelRenameCh,
  commitRenameChannel: commitRenameCh,
  stopCatalogActions: stopOutputCatalog,
} = useAudioOutputCatalog({ ensureAdmin });
const {
  draggingFaderId,
  restoreOutputState,
  onFaderPointerDown,
  onFaderPointerMove,
  onFaderPointerUp,
  toggleMute,
  stopOutputControls,
} = useAudioOutputControls({ channels, partnerOf, linkOn });
const {
  inputs,
  inputGainDb,
  inputsLoading,
  loadInputs,
  loadInputChannels,
  inputGainOf,
  inputGainLabel,
  onInputGain,
  stopInputCommands,
} = useAudioInputs();
const {
  matrixStale,
  matrixOffline,
  matrixErrMsg,
  loadMatrixState,
  isMatrixOn,
  toggleMatrix,
  startMatrixPolling,
  stopMatrixPolling,
} = useAudioMatrix();
const {
  bgmChannel,
  playlist,
  plIdx,
  playMode,
  plProgress,
  plPickerOpen,
  audioAssets,
  plEditingId,
  plEditingText,
  plCurrentItem,
  loadPlaylist,
  loadAudioAssets,
  addToPlaylist,
  removeFromPlaylist,
  startRenamePl,
  commitRenamePl,
  clearPlaylist,
  onPlRowClick,
  playAt,
  syncPlaybackFromChannel,
  plTogglePause,
  plPrev,
  plNext,
  setPlayModeAndSave,
  stopBgm,
  addPickedMedia,
  suspendPlaybackProgress,
} = useAudioPlaylist({ ensureAdmin });
const fmtDuration = formatAudioDuration;

// ============ EKX-808 一键场景 ============
// 场景目录、设备切换、失败回滚和长按确认由一个用例边界统一维护。
const {
  scenes: SCENES,
  currentScene,
  sceneBusy,
  holdId,
  holdPct,
  loadScenes,
  refreshCurrentScene,
  onHoldStart,
  onHoldMove,
  onHoldEnd,
} = useAudioScenes();

onUnmounted(() => {
  stopOutputCatalog();
  stopInputCommands();
  stopMatrixPolling();
  stopOutputControls();
});
// keep-alive 切走(组件被缓存、不卸载, 不触发 onUnmounted): 轮询由 useActivePolling
// 停止, 这里补取消长按进度环 RAF 与拖动全局锁; 不置 matrixPollStopped 以便回来能恢复
onDeactivated(() => {
  stopInputCommands();
  stopOutputControls();
});
onMounted(async () => {
  await loadPlaylist();
  // 进页面先跟后端"当前在播的"对齐一次 (bgm-player 可能正放着), 之后靠 watch 跟随
  void syncPlaybackFromChannel(
    bgmChannel.value?.currentMediaId,
    bgmChannel.value?.playbackSession,
  );
  await Promise.all([loadScenes(), loadZones(), loadInputs(), loadMatrixState()]);
  void refreshCurrentScene();
  void loadAudioAssets();
  // 输入真机增益 (inputs/live) 要 16 次往返 ~4.6s 且占 DSP 串行命令, 不在进页面时
  // 自动读; 由输入区"读取真机/校准"按钮按需触发 (loadInputChannels)。
  // (矩阵轮询的启动挪到下面 useActivePolling — 2026-07-27 切页卡顿根治)

  restoreOutputState();

  // 从媒体库跳转过来时: 把选中的歌加到播放列表
  const pickId = Number(route.query.pick_id);
  const pickName = String(route.query.pick_name ?? '');
  if (pickId && pickName) {
    // 2026-07-25 审计 P0: 之前只 push 本地数组不落库 — itemId 为空, 一次 loadPlaylist
    // 就被后端数据覆盖丢失, 其他终端也看不到。改走与手动添加同一条落库路径。
    audioTab.value = 'bgm';
    void router.replace({ name: 'audio', query: {} });
    await addPickedMedia(pickId, pickName);
  } else if (route.query.tab === 'bgm') {
    audioTab.value = 'bgm';
    void router.replace({ name: 'audio', query: {} });
  }
});

// 2026-07-27 切页卡顿根治: keep-alive 下 onUnmounted 不触发, 8s 矩阵轮询 (一条
// 设备命令 ~284ms) + 1s 进度秒针切走后永续后台运行。改 useActivePolling ——
// 在本页才跑; 从缓存回页时立即读一次矩阵 + 重对齐播放进度, 不等下一轮。
let audioPollActive = false;
let firstActivation = true;
function startAudioPolling(): void {
  if (audioPollActive) return; // mounted+activated 双触发, 幂等
  audioPollActive = true;
  startMatrixPolling();
  if (!firstActivation) {
    void syncPlaybackFromChannel(
      bgmChannel.value?.currentMediaId,
      bgmChannel.value?.playbackSession,
    ); // 重启进度秒针
  }
  firstActivation = false; // 首次进页 onMounted 已做全量加载, 不重复
}
function stopAudioPolling(): void {
  audioPollActive = false;
  stopMatrixPolling();
  suspendPlaybackProgress(); // 进度秒针纯视觉, 回页由上面的 sync 重算
}
useActivePolling(startAudioPolling, stopAudioPolling);

// 页内 tab: 一键场景 / 背景音乐 / 分区音量 / 音源矩阵 — 一屏一组, 不上下滚
// 2026-07-31 业主: 默认页改为背景音乐 (最常用)
const audioTab = ref<'scene' | 'bgm' | 'zones' | 'matrix'>('bgm');

// ============ 音源矩阵 (EKX-808 8x8 路由) ============
/** BGM 音源的矩阵输入口 = IN5 (0-based 4, USB 声卡←GK9000 主机, 2026-07-26 割接接线固定) */
const BGM_INPUT_CH = 4;
/** 分区喇叭输出 = OUT5-8 (0-based ≥4); OUT1-4 是 LED/投影的显示屏声道直通, 不该接 BGM */
const bgmZoneOutputs = computed(() => channels.value.filter((z) => z.channel >= 4));

// ============ 总览 ============
const overview = computed(() => summarizeAudioOutputs(
  displayChannels.value,
  Boolean(bgmChannel.value?.currentMediaId),
));

function goBack(): void { router.push({ name: 'dashboard' }); }
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
      <!-- 平均音量/当前预设: 手机上隐藏 (2026-07-31 业主: 状态卡只留两项一行, 空间让给内容) -->
      <div class="ov-item ov-avg">
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
      <div class="ov-item ov-preset">
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
      <!-- 音源矩阵快捷开关 (2026-07-31 业主: "上方加上音源矩阵的开关") —
           哪些分区喇叭接通背景音乐 (矩阵 OUTx←IN5), 与音源矩阵页同一份状态
           同一条下发链路, 切歌前不用再跑矩阵页接分区。 -->
      <div class="bgm-mx-bar">
        <div class="bgm-mx-label">
          <Speaker :size="14" :stroke-width="2" />
          分区接通
        </div>
        <button
          v-for="z in bgmZoneOutputs"
          :key="'bgmmx' + z.channel"
          class="bgm-mx-sw"
          :class="{ on: isMatrixOn(z.channel, BGM_INPUT_CH) }"
          :title="(isMatrixOn(z.channel, BGM_INPUT_CH) ? '已接通背景音乐, 点击断开: ' : '未接背景音乐, 点击接通: ') + z.name"
          @click="toggleMatrix(z.channel, BGM_INPUT_CH)"
        >
          <span class="bgm-mx-dot" aria-hidden="true"></span>
          {{ z.name }}
        </button>
        <span v-if="matrixOffline" class="bgm-mx-offline">矩阵离线, 开关暂不可用</span>
      </div>

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
              :disabled="!bgmChannel?.currentMediaId && playlist.length === 0"
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
            <div v-else class="bgm-pl-name" :title="item.name" @click.stop>
              {{ item.name }}
              <i v-if="item.missing" class="bgm-pl-missing">媒体已删除</i>
            </div>
            <div class="bgm-pl-dur">{{ fmtDuration(item.durationSec) }}</div>
            <!-- 2026-07-30 业主: "没有选择曲目按钮不好切歌" — 曲名区域为保护双击改名吞掉了
                 单击, 整行可点的事实上只剩边缘。给每行一个明确的播放按钮。 -->
            <button
              class="bgm-pl-ico bgm-pl-play"
              :class="{ playing: i === plIdx }"
              :title="i === plIdx ? '正在播放' : '播放这首'"
              :disabled="item.missing"
              @click.stop="playAt(i)"
            >
              <Volume2 v-if="i === plIdx" :size="12" :stroke-width="2" />
              <Play v-else :size="12" :stroke-width="2" />
            </button>
            <button class="bgm-pl-ico" title="改名 (只改显示名, 不动媒体库原文件)" @click.stop="startRenamePl(item)">
              <Pencil :size="12" :stroke-width="2" />
            </button>
            <!-- 2026-07-31 业主: "播放列表应该可以单条删除" — 原按钮 hover 才显形
                 (平板隐形) 且图标是小方块像"停止", 改为常显垃圾桶 + 确认弹窗 -->
            <button class="bgm-pl-ico bgm-pl-del" title="移出播放列表" @click.stop="removeFromPlaylist(i)">
              <Trash2 :size="13" :stroke-width="2" />
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
            <div v-if="audioAssets.length === 0" class="bgm-picker-empty">暂无音频 — 到「媒体库」上传</div>
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
          v-for="z in displayChannels"
          :key="z.id"
          class="ch-card"
          :class="{ muted: z.muted, error: !!z.error, live: !z.muted && z.volume > 0 }"
        >
          <!-- 就地改名: 双击名字或点笔。名字落 audio_output_zone 表, 矩阵页同源, 一起变 -->
          <input
            v-if="editingCh === z.dbId"
            v-model="editingChText"
            class="ch-name-input" maxlength="24"
            @click.stop @keyup.enter="commitRenameCh(z)"
            :disabled="catalogBusy"
            @keyup.esc="cancelRenameCh" @blur="commitRenameCh(z)"
          />
          <div v-else class="ch-name" :title="z.name">
            {{ displayName(z) }}
            <button class="ch-edit" title="改名" :disabled="catalogBusy" @click.stop="startRenameCh(z)">
              <Pencil :size="12" />
            </button>
          </div>
          <div class="ch-addr v2-inter">{{ displayAddr(z) }}</div>
          <!-- 立体声联动/独立: 胶囊分段开关 (2026-07-26 业主: 徽标看不清, 要做明显) -->
          <div v-if="isStereo(z)" class="link-capsule" role="group" @click.stop>
            <button
              class="lc-opt" :class="{ act: linkOn(z) }"
              title="联动: 推任意一边, 左右一起走"
              @click="setLink(z, true)"
            >联动</button>
            <button
              class="lc-opt" :class="{ act: !linkOn(z) }"
              title="独立: 左右各推各的 (做左右平衡)"
              @click="setLink(z, false)"
            >独立</button>
          </div>
          <!-- 立体声对: 左右两根推子并排 (2026-07-26 业主), 联动时一起走, 独立时各推各的 -->
          <div v-if="isStereo(z)" class="fader-duo">
            <div v-for="(r, di) in duoRows(z)" :key="r.id" class="fader-col">
              <div class="duo-label v2-inter">{{ di === 0 ? '左' : '右' }} {{ r.volume }}</div>
              <div
                class="fader"
                :class="{ disabled: r.muted, dragging: draggingFaderId === r.id }"
                @pointerdown="onFaderPointerDown(r, $event)"
                @pointermove="onFaderPointerMove(r, $event)"
                @pointerup="onFaderPointerUp(r, $event)"
                @pointercancel="onFaderPointerUp(r, $event)"
              >
                <div class="fader-track">
                  <div class="fader-fill" :style="{ height: r.volume + '%' }"></div>
                </div>
                <div class="fader-thumb" :style="{ bottom: 'calc(' + r.volume + '% - 8px)' }" aria-hidden="true"></div>
              </div>
            </div>
          </div>
          <!-- 触摸/拖动接收区是整个 .fader (不是 12px 窄轨) —— 手指粗, 按窄轨极易
               滑出, 一滑出 iOS 就当页面滚动。整块接收 + 拖动中全局锁滚动才不抖。 -->
          <div
            v-else
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
          <span v-if="isStereo(z)" class="vol-value v2-inter">{{ z.volume }}<span class="pct">%</span> · {{ partnerOf(z)?.volume ?? '–' }}<span class="pct">%</span></span>
          <span v-else class="vol-value v2-inter">{{ z.volume }}<span class="pct">%</span></span>
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
          <button
            type="button" class="mx-read-btn" :disabled="inputsLoading"
            @click="void loadInputChannels()"
          >{{ inputsLoading ? '读取中…' : '读取真机增益' }}</button>
        </h2>
      </header>
      <div class="input-gains">
        <div class="ig-row">
          <div v-for="inp in inputs" :key="'ig' + inp.channel" class="ig-item">
            <div class="ig-name" :title="inp.name">{{ inp.name }}</div>
            <input
              type="range" :min="0" :max="100" :step="1"
              :value="inputGainOf(inp.channel)"
              class="ig-slider"
              @input="onInputGain(inp.channel, Number(($event.target as HTMLInputElement).value))"
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
/* 播放按钮: 平板没有 hover, 必须常显 + 触摸目标加大 */
.bgm-pl-play {
  opacity: 1;
  width: 32px; height: 32px;
  background: var(--v2-ov-1);
}
.bgm-pl-play.playing { color: var(--v2-primary); }
.bgm-pl-play:disabled { opacity: .35; cursor: not-allowed; }
/* 音源矩阵快捷开关条 (背景音乐 tab 顶部) */
.bgm-mx-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
}
.bgm-mx-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--v2-text-2);
  flex: 0 0 auto; margin-right: 2px;
}
.bgm-mx-sw {
  display: inline-flex; align-items: center; gap: 7px;
  min-height: 36px; padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-ov-1);
  color: var(--v2-text-2);
  font-size: 13px; cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.bgm-mx-sw .bgm-mx-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--v2-text-3); flex: 0 0 auto;
}
.bgm-mx-sw.on {
  background: var(--v2-primary-soft);
  border-color: var(--v2-primary);
  color: var(--v2-text-1);
}
.bgm-mx-sw.on .bgm-mx-dot {
  background: var(--v2-success);
  box-shadow: 0 0 6px var(--v2-success);
}
.bgm-mx-offline { font-size: 12px; color: var(--v2-warning); }

/* 删除按钮: 同播放按钮常显 (平板没有 hover), 红色语义 */
.bgm-pl-del {
  opacity: 1;
  width: 32px; height: 32px;
  background: var(--v2-ov-1);
}
.bgm-pl-del:hover { color: var(--v2-danger); }
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

.v2-page-head {
  display: flex; justify-content: space-between; align-items: center; gap: var(--v2-sp-4); flex-wrap: wrap;
  /* 2026-07-27: 同 LightingPage —— 本页是固定壳 (.v2-page overflow:hidden), 全局
     sticky 页头补丁在这里让头部渲染下移 24px、以不透明底压住 KPI 条顶部 8px
     (业主: "第二行卡片上面被切掉一部分")。固定壳下头部不滚, 整体中和全局补丁。 */
  position: static;
  margin-top: 0;
  padding-top: 0;
  padding-bottom: 0;
  background: transparent;
  box-shadow: none;
}
.back-row { display: flex; align-items: center; gap: var(--v2-sp-4); }
.v2-back-btn {
  width: 36px; height: 36px; border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  display: grid; place-items: center; cursor: pointer; color: var(--v2-text-2);
  transition: all 0.18s ease;
}
.v2-back-btn:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.title-block { display: flex; flex-direction: column; }
.title { font-size: 20px; font-weight: 700; color: var(--v2-text-1); display: inline-flex; align-items: center; gap: var(--v2-sp-2); }
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
/* 出声通道: 薄荷青状态光 (2026-07-25 D1) — 音量>0 且未静音 = "活着", 左光条 +
   低饱和辉光; 静音/零音量回归中性灰。全场哪些区在响, 扫一眼可见。 */
.ch-card.live {
  border-color: color-mix(in srgb, var(--v2-live-audio) 32%, var(--v2-border-soft));
  background: linear-gradient(180deg, var(--v2-live-audio-glow), transparent 55%), var(--v2-surf-1);
  box-shadow: inset 3px 0 0 var(--v2-live-audio);
}
.ch-card.live .ch-name { color: color-mix(in srgb, var(--v2-live-audio) 45%, var(--v2-text-1)); }
.ch-card.muted { opacity: 0.7; }
.ch-card.error { border-color: rgba(229, 100, 93, 0.55); }

.ch-name { font-size: 13px; font-weight: 600; color: var(--v2-text-1); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; flex-shrink: 0; }
.ch-addr { font-size: 10px; color: var(--v2-text-3); letter-spacing: 1px; text-align: center; flex-shrink: 0; }
/* 立体声联动/独立: 胶囊分段开关 (2026-07-26 业主: 之前的小徽标看不清) —
   两段式, 当前态实心高亮 + 白字, 非当前态弱化, 状态一眼可辨 */
.link-capsule {
  display: flex; flex-shrink: 0;
  border-radius: 999px; overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--v2-success) 45%, var(--v2-border-soft));
  background: var(--v2-surf-2);
}
.lc-opt {
  border: none; padding: 3px 10px;
  font-size: 11px; line-height: 1.2; letter-spacing: 1px;
  color: var(--v2-text-3); background: transparent;
  cursor: pointer; user-select: none;
  transition: background 0.18s ease, color 0.18s ease;
}
.lc-opt.act {
  color: #fff;
  background: linear-gradient(135deg, #3FBF87, #2FA873);
  box-shadow: 0 0 10px rgba(63, 191, 135, 0.45);
  font-weight: 700;
}

/* 立体声双推子: 左右两根并排, 各自可拖; 联动时逻辑层同步, 界面看着一起走 */
.fader-duo {
  flex: 1; min-height: 70px; width: 100%;
  display: flex; gap: 4px; justify-content: center;
}
.fader-col {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
}
.duo-label { font-size: 10px; color: var(--v2-text-3); flex-shrink: 0; white-space: nowrap; }
.fader-col .fader { min-height: 50px; }

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
  /* 2026-07-25 业主: 推子必须稳 — 值绑定属性上禁过渡, 点哪停哪不惯性飘 */
}
.ch-card.muted .fader-fill { background: var(--v2-surf-2); box-shadow: none; }
/* 推子帽 (拖动手柄) — 跟随音量上下移动, 一看就知道能竖向拖 */
.fader-thumb {
  position: absolute; left: 50%; transform: translateX(-50%);
  width: 24px; height: 16px; border-radius: 5px;
  background: linear-gradient(180deg, #ffffff, #cdebdd);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.55), 0 0 12px rgba(63, 191, 135, 0.5);
  z-index: 2; pointer-events: none;
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
.ch-card:not(.muted) .vol-value { color: color-mix(in srgb, var(--v2-success) 65%, var(--v2-text-1)); text-shadow: var(--v2-text-glow-success); }
.vol-value .pct { font-size: 10px; color: var(--v2-text-3); margin-left: 1px; font-weight: 500; text-shadow: none; }
.ch-card.muted .vol-value { color: var(--v2-text-3); }

/* ============ 音源矩阵 (EKX-808 8x8) ============ */
.matrix-section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.matrix-head { flex-shrink: 0; margin-bottom: 8px; }
.matrix-wrap { flex: 1; min-height: 0; overflow: hidden; }
.matrix-grid { display: grid; gap: 5px; height: 100%; }
/* 手机 (2026-07-25 生产级整改): 112px + 8 输入列在手机必然溢出 — 矩阵改为
   容器内横向滚动 (行头 112px 保持可读), 推子区字号/留白同步压缩。 */
@media (max-width: 600px) {
  .matrix-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .matrix-grid { min-width: 560px; height: auto; min-height: 100%; }
  .ch-name { font-size: 12px; }
  .vol-value { font-size: 13px; }
  /* 2026-07-28 业主: 手机总览条 4 项挤一行溢出 → 曾改 2×2。
     2026-07-31 业主再改: 去掉"平均音量/当前预设"只留两项一行, 全部静音从头部
     独占行挪进状态条右端 —— 头部+状态共省约两行, 空间让给下面内容。 */
  .v2-overview.audio { padding: 8px 4px; }
  .ov-item { padding: 0 10px; }
  .ov-avg, .ov-preset { display: none; }
  .ov-value { white-space: nowrap; }
  /* 区块标题与右侧说明抢一行 → 标题断行错位, 改上下排列 */
  .block-head { flex-direction: column; align-items: flex-start; gap: 2px; }
}
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
/* 2026-07-26 业主: "加长输入推子, 更灵敏切换到准确数值" —— 8 列一行改 4 列两行,
   每根滑条长度翻倍; step 5→1; 加高触摸区, 手指好抓 */
.ig-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 14px; }
.ig-item { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.ig-name { font-size: 10px; color: var(--v2-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.ig-slider { width: 100%; height: 28px; accent-color: #3FBF87; cursor: pointer; touch-action: none; }
.ig-val { font-size: 11px; color: color-mix(in srgb, var(--v2-success) 65%, var(--v2-text-1)); font-weight: 700; }

/* 矩阵读不到 / 增益读取中 的提示 */
.mx-stale {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px; font-size: 11px;
  background: var(--v2-warning-soft); border: 1px solid color-mix(in srgb, var(--v2-warning) 40%, transparent);
  color: var(--v2-warning);
}
.mx-loading { margin-left: 10px; font-size: 11px; font-weight: 400; color: #6d7f98; }
.mx-read-btn {
  margin-left: 10px; padding: 3px 12px; border-radius: 999px; cursor: pointer;
  font-size: 11px; font-weight: 500; color: var(--v2-primary, #6c8cff);
  background: color-mix(in srgb, var(--v2-primary, #6c8cff) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--v2-primary, #6c8cff) 45%, transparent);
}
.mx-read-btn:disabled { opacity: 0.6; cursor: default; }
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
