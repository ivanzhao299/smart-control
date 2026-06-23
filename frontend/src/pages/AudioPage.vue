<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, Speaker, Volume2, VolumeX, Play, Sparkles, Music, Square, FolderOpen,
} from 'lucide-vue-next';
import { audioService } from '@/services/audio.service';
import { audioConfigService } from '@/services/audio-config.service';
import { usePlaybackStore } from '@/stores/playback';

const router = useRouter();
const playbackStore = usePlaybackStore();

// ============ 背景音乐 (slot 3 → GK9000 声卡 → EKX) ============
const bgmChannel = computed(() => playbackStore.slotAudio);
function gotoMusicLibrary(): void {
  router.push({ name: 'media', query: { pick_for_slot: '3' } });
}
async function stopBgm(): Promise<void> {
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
onUnmounted(() => { if (holdRaf) cancelAnimationFrame(holdRaf); });
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
async function muteAll(): Promise<void> {
  for (const z of channels.value) { if (!z.muted) await toggleMute(z); }
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
        <button class="v2-quick danger" @click="muteAll">
          <VolumeX :size="14" :stroke-width="2" /> 全部静音
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
    <section v-if="audioTab === 'bgm'">
      <header class="block-head">
        <h2 class="block-title"><span class="accent">●</span>背景音乐</h2>
        <div class="block-sub">GK9000 播放音频 → 声卡 → EKX 输入 · 从媒体库选音乐</div>
      </header>
      <div class="bgm-card" :class="{ playing: bgmChannel?.currentMediaId }">
        <div class="bgm-icon"><Music :size="28" :stroke-width="1.8" /></div>
        <div class="bgm-body">
          <div class="bgm-now">
            {{ bgmChannel?.currentMediaName || '未播放' }}
          </div>
          <div class="bgm-sub">
            <template v-if="bgmChannel?.currentMediaId">
              {{ bgmChannel.loopMode === 'loop' ? '循环播放中' : '单曲播放中' }}
              · {{ bgmChannel.alive ? '播放器在线' : '⚠ 播放器离线 (检查 GK9000 音频 kiosk)' }}
            </template>
            <template v-else>从媒体库选一首音乐开始播放</template>
          </div>
        </div>
        <div class="bgm-actions">
          <button class="v2-quick primary" @click="gotoMusicLibrary">
            <FolderOpen :size="14" :stroke-width="2" /> 选音乐
          </button>
          <button v-if="bgmChannel?.currentMediaId" class="v2-quick danger" @click="stopBgm">
            <Square :size="14" :stroke-width="2" /> 停止
          </button>
        </div>
      </div>
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
      <header class="block-head">
        <h2 class="block-title"><span class="accent">●</span>音源矩阵</h2>
        <div class="block-sub">点亮交叉点 = 该输出接收该输入音源 · 一路输出可接多个输入(混音) · 点一下实时下发到 808</div>
      </header>
      <div class="matrix-wrap">
        <div class="matrix-grid" :style="{ gridTemplateColumns: `112px repeat(${inputs.length || 8}, minmax(0, 1fr))` }">
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

/* 背景音乐卡 */
.bgm-card {
  display: flex; align-items: center; gap: var(--v2-sp-4);
  padding: var(--v2-sp-4);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  transition: all 0.28s ease;
}
.bgm-card.playing {
  border-color: rgba(168, 85, 247, 0.5);
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(0, 229, 255, 0.03));
  box-shadow: inset 0 1px 0 rgba(168, 85, 247, 0.4), 0 8px 28px -10px rgba(168, 85, 247, 0.4);
}
.bgm-icon {
  width: 52px; height: 52px; border-radius: var(--v2-r-md); flex-shrink: 0;
  display: grid; place-items: center;
  background: rgba(168, 85, 247, 0.15); color: #c4b5fd;
}
.bgm-card.playing .bgm-icon { color: #d8b4fe; box-shadow: 0 0 18px rgba(168, 85, 247, 0.5); }
.bgm-body { flex: 1; min-width: 0; }
.bgm-now { font-size: 16px; font-weight: 600; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bgm-sub { font-size: 12px; color: var(--v2-text-3); margin-top: 4px; }
.bgm-actions { display: flex; gap: var(--v2-sp-2); flex-shrink: 0; }
@media (max-width: 600px) {
  .bgm-card { flex-wrap: wrap; }
  .bgm-actions { width: 100%; }
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
.matrix-section .block-head { flex-shrink: 0; }
.matrix-wrap { flex: 1; min-height: 0; overflow: auto; }
.matrix-grid { display: grid; gap: 5px; align-content: start; }
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
  min-height: 38px; border-radius: 8px;
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
</style>
