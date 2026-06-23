<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, Speaker, Volume2, VolumeX, Play, Sparkles, Music, Square,
  SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Trash2,
} from 'lucide-vue-next';
import { audioService } from '@/services/audio.service';
import { audioConfigService } from '@/services/audio-config.service';
import { usePlaybackStore } from '@/stores/playback';
import { mediaService } from '@/services/media.service';

const router = useRouter();
const playbackStore = usePlaybackStore();

// ============ 背景音乐 (slot 3 → GK9000 声卡 → EKX) ============
const bgmChannel = computed(() => playbackStore.slotAudio);

// ── 播放列表 ──
interface PlItem { id: number; name: string; durationSec: number | null; }
const playlist = ref<PlItem[]>([]);
const plIdx = ref(-1);
type PlayMode = 'seq' | 'loop1' | 'loopAll' | 'shuffle';
const playMode = ref<PlayMode>('loopAll');
const plProgress = ref(0);
const plPickerOpen = ref(false);
const audioAssets = ref<PlItem[]>([]);
let plTimer: ReturnType<typeof setInterval> | null = null;
let plTimerStart = 0;
let plTimerDuration = 0;

async function loadAudioAssets(): Promise<void> {
  try {
    const { items } = await mediaService.list({ kind: 'audio' });
    audioAssets.value = items.map((i) => ({ id: i.id, name: i.originalName, durationSec: i.durationSec }));
  } catch { /* silent */ }
}
function addToPlaylist(item: PlItem): void { playlist.value.push({ ...item }); }
function removeFromPlaylist(i: number): void {
  playlist.value.splice(i, 1);
  if (plIdx.value >= playlist.value.length) plIdx.value = playlist.value.length - 1;
}
function clearPlaylist(): void {
  stopPlTimer();
  playlist.value = [];
  plIdx.value = -1;
  plProgress.value = 0;
}
function stopPlTimer(): void {
  if (plTimer !== null) { clearInterval(plTimer); plTimer = null; }
}
function startPlTimer(dur: number | null): void {
  stopPlTimer();
  plProgress.value = 0;
  if (!dur || dur <= 0) return;
  plTimerStart = Date.now();
  plTimerDuration = dur;
  plTimer = setInterval(() => {
    const elapsed = (Date.now() - plTimerStart) / 1000;
    plProgress.value = Math.min(100, (elapsed / plTimerDuration) * 100);
    if (elapsed >= plTimerDuration) { stopPlTimer(); onTrackEnd(); }
  }, 300);
}
async function playAt(i: number): Promise<void> {
  if (playlist.value.length === 0 || i < 0) return;
  const idx = ((i % playlist.value.length) + playlist.value.length) % playlist.value.length;
  plIdx.value = idx;
  const item = playlist.value[idx];
  try {
    await playbackStore.publish(3, item.id, 'once');
    startPlTimer(item.durationSec);
  } catch (e) { ElMessage.error(`播放失败: ${(e as Error).message}`); }
}
function nextIdx(): number {
  const len = playlist.value.length;
  if (len === 0) return -1;
  if (playMode.value === 'seq') return plIdx.value < len - 1 ? plIdx.value + 1 : -1;
  if (playMode.value === 'loop1') return plIdx.value;
  if (playMode.value === 'loopAll') return (plIdx.value + 1) % len;
  // shuffle
  if (len === 1) return 0;
  const others = Array.from({ length: len }, (_, k) => k).filter((k) => k !== plIdx.value);
  return others[Math.floor(Math.random() * others.length)];
}
function onTrackEnd(): void {
  const ni = nextIdx();
  if (ni >= 0) void playAt(ni); else { plIdx.value = -1; plProgress.value = 0; }
}
async function plPlayPause(): Promise<void> {
  if (bgmChannel.value?.currentMediaId) {
    await stopBgm();
  } else if (playlist.value.length > 0) {
    await playAt(plIdx.value >= 0 ? plIdx.value : 0);
  }
}
async function plPrev(): Promise<void> {
  if (playlist.value.length === 0) return;
  await playAt((plIdx.value - 1 + playlist.value.length) % playlist.value.length);
}
async function plNext(): Promise<void> {
  if (playlist.value.length === 0) return;
  stopPlTimer(); onTrackEnd();
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
onUnmounted(() => { if (holdRaf) cancelAnimationFrame(holdRaf); stopPlTimer(); });
async function refreshCurrentScene(): Promise<void> {
  try {
    const wrapped = await audioService.currentScene();
    const preset = wrapped?.data?.data?.preset;
    if (typeof preset === 'number' && preset >= 1 && preset <= 12) currentScene.value = preset;
  } catch { /* 静默 */ }
}
onMounted(async () => {
  await Promise.all([loadScenes(), loadZones(), loadInputs()]);
  void refreshCurrentScene();
  void loadAudioAssets();
});

// ============ 分区 ============
interface AudioRow {
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
const matrixBusy = ref<Record<string, boolean>>({});
function isMatrixOn(outCh: number, inCh: number): boolean {
  return !!matrixOn.value[`${outCh}_${inCh}`];
}
async function toggleMatrix(outCh: number, inCh: number): Promise<void> {
  const key = `${outCh}_${inCh}`;
  if (matrixBusy.value[key]) return;
  const want = !matrixOn.value[key];
  matrixOn.value = { ...matrixOn.value, [key]: want };        // 乐观: 立即点亮/熄灭
  matrixBusy.value = { ...matrixBusy.value, [key]: true };
  try {
    const res = await audioService.setMatrix(outCh, inCh, want);
    if (!res.ok) throw new Error(res.error || '执行失败');
  } catch (err) {
    matrixOn.value = { ...matrixOn.value, [key]: !want };     // 失败回滚
    ElMessage.error(`路由 OUT${outCh + 1}←IN${inCh + 1} 失败: ${(err as Error).message}`);
  } finally {
    matrixBusy.value = { ...matrixBusy.value, [key]: false };
  }
}

// 输入增益 (本地状态, 默认 80%; 乐观下发, 不回读设备). EKX 预设常把输入压到 -60dB.
const inputGain = ref<Record<number, number>>({});
function inputGainOf(ch: number): number {
  return inputGain.value[ch] ?? 80;
}
async function onInputGain(ch: number, value: number): Promise<void> {
  const prev = inputGain.value[ch] ?? 80;
  inputGain.value = { ...inputGain.value, [ch]: value };
  try {
    const res = await audioService.setInputVolume(ch, value);
    if (!res.ok) throw new Error(res.error || '执行失败');
  } catch (err) {
    inputGain.value = { ...inputGain.value, [ch]: prev };
    ElMessage.error(`IN${ch + 1} 增益设置失败: ${(err as Error).message}`);
  }
}

async function applyVolume(z: AudioRow, value: number): Promise<void> {
  // 乐观: 滑条即时生效, 后台异步下发, 失败回滚
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
function onVolInput(z: AudioRow, ev: Event): void {
  z.volume = Number((ev.target as HTMLInputElement).value);
}
function onVolChange(z: AudioRow, ev: Event): void {
  void applyVolume(z, Number((ev.target as HTMLInputElement).value));
}

async function toggleMute(z: AudioRow): Promise<void> {
  // 乐观: 立即翻转 UI, 失败回滚
  const prev = z.muted;
  z.muted = !z.muted;
  z.error = null;
  try {
    const res = z.muted ? await audioService.mute(z.id, z.zone) : await audioService.unmute(z.id, z.zone);
    if (!res.ok) throw new Error(res.error || '执行失败');
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
    for (const z of channels.value) { if (z.muted) await toggleMute(z); }
  } else {
    for (const z of channels.value) { if (!z.muted) await toggleMute(z); }
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
                播放中 · {{ bgmChannel.alive ? 'GK9000 → 声卡 → EKX' : '⚠ 播放器离线' }}
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
            <button class="bgm-btn bgm-btn-main" :title="bgmChannel?.currentMediaId ? '停止' : '播放'" :disabled="playlist.length === 0" @click="plPlayPause">
              <Square v-if="bgmChannel?.currentMediaId" :size="16" :stroke-width="2" />
              <Play v-else :size="16" :stroke-width="2" />
            </button>
            <button class="bgm-btn" title="下一首" :disabled="playlist.length === 0" @click="plNext">
              <SkipForward :size="17" :stroke-width="2" />
            </button>
          </div>
          <div class="bgm-mode-row">
            <button :class="['bgm-mode', { active: playMode === 'seq' }]" title="顺序播放" @click="playMode = 'seq'">顺序</button>
            <button :class="['bgm-mode', { active: playMode === 'loop1' }]" title="单曲循环" @click="playMode = 'loop1'">
              <Repeat1 :size="12" :stroke-width="2.2" /> 单曲
            </button>
            <button :class="['bgm-mode', { active: playMode === 'loopAll' }]" title="列表循环" @click="playMode = 'loopAll'">
              <Repeat :size="12" :stroke-width="2.2" /> 列表
            </button>
            <button :class="['bgm-mode', { active: playMode === 'shuffle' }]" title="随机播放" @click="playMode = 'shuffle'">
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
            @click="playAt(i)"
          >
            <div class="bgm-pl-idx">
              <Volume2 v-if="i === plIdx" :size="12" :stroke-width="2" class="bgm-pl-anim" />
              <span v-else>{{ i + 1 }}</span>
            </div>
            <div class="bgm-pl-name">{{ item.name }}</div>
            <div class="bgm-pl-dur">{{ fmtDuration(item.durationSec) }}</div>
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
          <div class="ch-name">{{ z.name }}</div>
          <div class="ch-addr v2-inter">{{ z.id.toUpperCase() }}</div>
          <div class="fader">
            <div class="fader-track">
              <div class="fader-fill" :style="{ height: z.volume + '%' }"></div>
            </div>
            <div class="fader-thumb" :style="{ bottom: 'calc(' + z.volume + '% - 8px)' }" aria-hidden="true"></div>
            <input
              type="range"
              orient="vertical"
              :value="z.volume"
              :min="0" :max="100" :step="5"
              :disabled="z.muted"
              class="fader-input"
              @input="onVolInput(z, $event)"
              @change="onVolChange(z, $event)"
            />
          </div>
          <button class="v2-toggle" :class="{ on: !z.muted }" @click="toggleMute(z)"></button>
          <span class="vol-value v2-inter">{{ z.volume }}<span class="pct">%</span></span>
        </div>
      </div>
    </section>

    <!-- 音源矩阵 (EKX-808 8x8 路由) -->
    <section v-if="audioTab === 'matrix'" class="matrix-section">
      <header class="block-head matrix-head">
        <h2 class="block-title"><span class="accent">●</span>音源矩阵</h2>
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
            <div class="ig-val v2-inter">{{ inputGainOf(inp.channel) }}%</div>
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
  box-shadow: 0 0 0 1px rgba(6, 182, 212, 0.2);
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
  border-color: rgba(245, 158, 11, 0.3);
}
.v2-quick.danger {
  background: rgba(239, 68, 68, 0.1); color: var(--v2-danger);
  border-color: rgba(239, 68, 68, 0.3);
}
.v2-quick.active {
  background: rgba(16, 185, 129, 0.12); color: var(--v2-success);
  border-color: rgba(16, 185, 129, 0.3);
}

/* Overview (audio green) */
.v2-overview.audio {
  display: flex; align-items: center;
  padding: 8px var(--v2-sp-3);
  background: linear-gradient(135deg, rgba(52, 211, 153, 0.05), rgba(52, 211, 153, 0.01));
  border: 1px solid rgba(52, 211, 153, 0.12);
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
  border-color: rgba(168, 85, 247, 0.45);
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.07), rgba(0, 229, 255, 0.02));
  box-shadow: inset 0 1px 0 rgba(168, 85, 247, 0.35), 0 6px 24px -8px rgba(168, 85, 247, 0.35);
}
.bgm-now-row { display: flex; align-items: center; gap: var(--v2-sp-3); }
.bgm-ico-wrap {
  width: 44px; height: 44px; border-radius: var(--v2-r-md); flex-shrink: 0;
  display: grid; place-items: center;
  background: rgba(168, 85, 247, 0.14); color: #c4b5fd;
  transition: box-shadow 0.28s ease;
}
.bgm-player.playing .bgm-ico-wrap { color: #d8b4fe; box-shadow: 0 0 16px rgba(168, 85, 247, 0.45); }
.bgm-now-body { flex: 1; min-width: 0; }
.bgm-now-name { font-size: 15px; font-weight: 600; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bgm-now-meta { font-size: 11px; color: var(--v2-text-3); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bgm-prog-wrap {
  height: 3px; border-radius: 2px; background: var(--v2-surf-2); overflow: hidden;
}
.bgm-prog-fill {
  height: 100%; border-radius: 2px;
  background: linear-gradient(90deg, #a855f7, #c084fc);
  box-shadow: 0 0 8px rgba(168, 85, 247, 0.6);
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
  width: 44px; height: 44px; background: rgba(168, 85, 247, 0.18); color: #c084fc;
  border-color: rgba(168, 85, 247, 0.3);
}
.bgm-btn-main:hover:not(:disabled) { background: rgba(168, 85, 247, 0.32); color: #d8b4fe; }
.bgm-mode-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.bgm-mode {
  padding: 4px 10px; border-radius: 20px; font-size: 11px; cursor: pointer;
  background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-3); display: inline-flex; align-items: center; gap: 4px;
  transition: all 0.16s ease;
}
.bgm-mode:hover { color: var(--v2-text-2); border-color: var(--v2-border-strong); }
.bgm-mode.active {
  background: rgba(168, 85, 247, 0.18); color: #c084fc;
  border-color: rgba(168, 85, 247, 0.4);
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
.bgm-pl-row.active { background: rgba(168, 85, 247, 0.07); }
.bgm-pl-idx {
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--v2-text-3); font-weight: 500;
}
.bgm-pl-row.active .bgm-pl-idx { color: #c084fc; }
.bgm-pl-anim { color: #c084fc; }
.bgm-pl-name {
  font-size: 13px; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bgm-pl-row.active .bgm-pl-name { color: #c084fc; font-weight: 500; }
.bgm-pl-dur { font-size: 11px; color: var(--v2-text-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.bgm-pl-del {
  display: grid; place-items: center; width: 24px; height: 24px;
  border-radius: var(--v2-r-sm); background: transparent; border: none;
  color: var(--v2-text-3); cursor: pointer; opacity: 0; transition: all 0.14s ease;
}
.bgm-pl-row:hover .bgm-pl-del { opacity: 1; }
.bgm-pl-del:hover { background: rgba(239, 68, 68, 0.12); color: var(--v2-danger); }

/* 音频选择器 dialog */
.bgm-picker {
  background: var(--v2-surf-0); border: 1px solid var(--v2-border-soft);
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
.bgm-picker-ico { color: #c084fc; flex-shrink: 0; }
.bgm-picker-name { font-size: 13px; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bgm-picker-dur { font-size: 11px; color: var(--v2-text-3); white-space: nowrap; }
.bgm-picker-tag {
  font-size: 11px; padding: 2px 8px; border-radius: 10px; white-space: nowrap;
  background: var(--v2-surf-2); color: var(--v2-text-3); border: 1px solid var(--v2-border-soft);
}
.bgm-picker-row:not(.added):hover .bgm-picker-tag {
  background: rgba(168, 85, 247, 0.15); color: #c084fc; border-color: rgba(168, 85, 247, 0.3);
}
.bgm-picker-row.added .bgm-picker-tag { background: rgba(16, 185, 129, 0.1); color: var(--v2-success); border-color: rgba(16, 185, 129, 0.25); }
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
  background: rgba(52, 211, 153, 0.14); color: #34d399;
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
  box-shadow: 0 0 8px rgba(6, 182, 212, 0.7);
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
  border-color: rgba(6, 182, 212, 0.4);
  box-shadow: 0 4px 16px -4px rgba(6, 182, 212, 0.4);
}
.scene-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.scene-id { font-size: 10px; color: var(--v2-text-3); letter-spacing: 1px; }
.scene-btn.active .scene-id { color: var(--v2-primary); }
.scene-name { font-size: 14px; font-weight: 600; }
.scene-hint { font-size: 10px; color: var(--v2-text-3); letter-spacing: 0.5px; }
.scene-btn.active .scene-hint { color: rgba(6, 182, 212, 0.7); }

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
  border-color: rgba(0, 231, 138, 0.45);
}
.ch-card:hover::after { opacity: 0.85; }
.ch-card:not(.muted) {
  border-color: rgba(0, 231, 138, 0.5);
  background: linear-gradient(180deg, rgba(0, 231, 138, 0.06), rgba(16, 185, 129, 0.02));
  box-shadow: inset 0 1px 0 rgba(0, 231, 138, 0.45);
}
.ch-card:not(.muted)::after { opacity: 1; }
.ch-card.muted { opacity: 0.7; }
.ch-card.error { border-color: rgba(255, 71, 87, 0.55); }

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
  background: linear-gradient(135deg, #10B981, #00E78A);
  box-shadow:
    0 0 14px rgba(0, 231, 138, 0.6),
    0 0 28px rgba(0, 231, 138, 0.35);
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
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.fader-fill {
  position: absolute; left: 0; right: 0; bottom: 0;
  background: linear-gradient(0deg, #10B981 0%, #00E78A 55%, #6BFFB9 100%);
  box-shadow: 0 0 14px rgba(0, 231, 138, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3);
  transition: height 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.ch-card.muted .fader-fill { background: var(--v2-surf-2); box-shadow: none; }
/* 推子帽 (拖动手柄) — 跟随音量上下移动, 一看就知道能竖向拖 */
.fader-thumb {
  position: absolute; left: 50%; transform: translateX(-50%);
  width: 24px; height: 16px; border-radius: 5px;
  background: linear-gradient(180deg, #ffffff, #cdebdd);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.55), 0 0 12px rgba(0, 231, 138, 0.5);
  z-index: 2; pointer-events: none;
  transition: bottom 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.fader-thumb::after {
  content: ''; position: absolute; left: 5px; right: 5px; top: 50%;
  height: 2px; transform: translateY(-50%);
  background: rgba(0, 0, 0, 0.22); border-radius: 1px;
}
.ch-card.muted .fader-thumb { background: #8092ab; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5); }
/* 透明竖向 range 盖在整条上接收触摸拖动 (底=0 顶=100) */
.fader-input {
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; opacity: 0; cursor: pointer; touch-action: none;
  writing-mode: vertical-lr; direction: rtl;
  -webkit-appearance: slider-vertical; appearance: slider-vertical;
  z-index: 3;
}
.fader-input:disabled { cursor: not-allowed; }

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
.mx-cell:hover { border-color: rgba(0, 231, 138, 0.5); }
.mx-cell.on {
  background: linear-gradient(135deg, #10B981, #00E78A);
  border-color: transparent;
  box-shadow: 0 0 12px rgba(0, 231, 138, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.mx-dot { width: 11px; height: 11px; border-radius: 50%; background: #fff; box-shadow: 0 0 6px rgba(255, 255, 255, 0.85); }

/* 输入增益行 (音源矩阵页顶部) */
.input-gains { flex-shrink: 0; margin-bottom: 10px; }
.ig-row { display: grid; grid-template-columns: repeat(8, 1fr); gap: 10px; }
.ig-item { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.ig-name { font-size: 10px; color: var(--v2-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.ig-slider { width: 100%; accent-color: #00E78A; cursor: pointer; }
.ig-val { font-size: 11px; color: #6BFFB9; font-weight: 700; }
</style>
