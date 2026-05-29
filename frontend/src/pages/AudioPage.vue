<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, Speaker, Volume2, VolumeX, Mic, MicOff, Play, Square, Sparkles,
} from 'lucide-vue-next';
import { audioService } from '@/services/audio.service';

// ============ EKX-808 一键场景 ============
interface Scene { id: number; name: string; hint: string; }
const SCENES: Scene[] = [
  { id: 1,  name: '早班接待',       hint: '8-10 点全场低音量 BGM' },
  { id: 2,  name: '日常运营',       hint: '10-17 点标准音量' },
  { id: 3,  name: '路演演讲',       hint: 'LED 区主声道' },
  { id: 4,  name: '大型发布会',     hint: '全场开 + 突出' },
  { id: 5,  name: '会议室独立',     hint: 'ZONE 8 独立 + AEC' },
  { id: 6,  name: '跟随讲解',       hint: 'WTG-800 自动激活' },
  { id: 7,  name: '政府接待 VIP',   hint: '全场 +0dB' },
  { id: 8,  name: '夜间静音',       hint: '18-8 点全静音' },
  { id: 9,  name: '应急广播',       hint: '消防/疏散最大声' },
  { id: 10, name: '大屏视频',       hint: 'ZONE 1 + SUB12' },
  { id: 11, name: '自定义 1',       hint: '备用' },
  { id: 12, name: '自定义 2',       hint: '备用' },
];
const currentScene = ref<number | null>(null);
const sceneBusy = ref(false);

async function recallScene(s: Scene): Promise<void> {
  sceneBusy.value = true;
  try {
    const res = await audioService.recallScene(s.id);
    if (!res.ok) throw new Error(res.error || '场景切换失败');
    currentScene.value = s.id;
    ElMessage.success(`场景已切换: ${s.name} (U${String(s.id).padStart(2,'0')})`);
  } catch (err) {
    ElMessage.error(`切换 ${s.name} 失败: ${(err as Error).message}`);
  } finally { sceneBusy.value = false; }
}
async function refreshCurrentScene(): Promise<void> {
  try {
    const wrapped = await audioService.currentScene();
    const preset = wrapped?.data?.data?.preset;
    if (typeof preset === 'number' && preset >= 1 && preset <= 12) currentScene.value = preset;
  } catch { /* 静默 */ }
}
onMounted(() => { void refreshCurrentScene(); });

// ============ 分区 ============
interface AudioRow {
  id: string; name: string; zone: string;
  volume: number; muted: boolean; bgm: string;
  bgmPlaying: boolean; mic: boolean;
  busy: boolean; error: string | null;
}

const channels = ref<AudioRow[]>([
  { id: 'audio_1f', name: '一层背景音', zone: '1f_bg', volume: 30, muted: false, bgm: 'welcome', bgmPlaying: false, mic: false, busy: false, error: null },
  { id: 'audio_2f', name: '二层背景音', zone: '2f_bg', volume: 30, muted: false, bgm: 'welcome', bgmPlaying: false, mic: false, busy: false, error: null },
  { id: 'audio_meeting', name: '会议区', zone: 'meeting', volume: 40, muted: false, bgm: '', bgmPlaying: false, mic: false, busy: false, error: null },
  { id: 'audio_roadshow', name: '路演区', zone: 'roadshow', volume: 50, muted: false, bgm: '', bgmPlaying: false, mic: false, busy: false, error: null },
]);

async function call(z: AudioRow, label: string, fn: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
  z.busy = true; z.error = null;
  try {
    const res = await fn();
    if (!res.ok) throw new Error(res.error || '执行失败');
    return true;
  } catch (err) {
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} ${label}失败: ${z.error}`);
    return false;
  } finally { z.busy = false; }
}

async function applyVolume(z: AudioRow, value: number): Promise<void> {
  z.volume = value;
  await call(z, `音量 ${value}`, () => audioService.setVolume(z.id, value, z.zone));
}
function onVolInput(z: AudioRow, ev: Event): void {
  z.volume = Number((ev.target as HTMLInputElement).value);
}
function onVolChange(z: AudioRow, ev: Event): void {
  void applyVolume(z, Number((ev.target as HTMLInputElement).value));
}

async function toggleMute(z: AudioRow): Promise<void> {
  const next = !z.muted;
  const ok = await call(z, next ? '静音' : '取消静音',
    () => (next ? audioService.mute(z.id, z.zone) : audioService.unmute(z.id, z.zone)));
  if (ok) z.muted = next;
}

async function toggleBgm(z: AudioRow): Promise<void> {
  if (z.bgmPlaying) {
    const ok = await call(z, '停止 BGM', () => audioService.stopBgm(z.id, z.zone));
    if (ok) z.bgmPlaying = false;
  } else {
    const ok = await call(z, '播放 BGM', () => audioService.playBgm(z.id, z.bgm || undefined, z.zone));
    if (ok) z.bgmPlaying = true;
  }
}

async function toggleMic(z: AudioRow): Promise<void> {
  const next = !z.mic;
  const ok = await call(z, next ? '开麦克风' : '关麦克风', () => audioService.mic(z.id, next, z.zone));
  if (ok) z.mic = next;
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

const router = useRouter();
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
          <div class="sub">得胜 EKX-808 8×8 矩阵 + WTG-800 跟随讲解</div>
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
    <section class="scene-section">
      <header class="block-head">
        <h2 class="block-title"><span class="accent">●</span>一键场景预设</h2>
        <div class="block-sub">U01-U12 由厂家工程师 PC 软件预录入 · 一条命令切全部 8 路</div>
      </header>
      <div class="scene-grid">
        <button
          v-for="s in SCENES"
          :key="s.id"
          class="scene-btn"
          :class="{ active: currentScene === s.id }"
          :disabled="sceneBusy"
          @click="recallScene(s)"
        >
          <div class="scene-id v2-inter">U{{ String(s.id).padStart(2,'0') }}</div>
          <div class="scene-name">{{ s.name }}</div>
          <div class="scene-hint">{{ s.hint }}</div>
        </button>
      </div>
    </section>

    <!-- 分区控制 -->
    <section>
      <header class="block-head">
        <h2 class="block-title"><span class="accent">●</span>分区控制</h2>
        <div class="block-sub">{{ overview.total }} 个分区 · 音量 / 静音 / BGM / 麦克风</div>
      </header>
      <div class="ch-grid">
        <div
          v-for="z in channels"
          :key="z.id"
          class="ch-card"
          :class="{ muted: z.muted, error: !!z.error }"
        >
          <div class="ch-top">
            <div class="ch-meta">
              <div class="ch-name">{{ z.name }}</div>
              <div class="ch-addr v2-inter">{{ z.id.toUpperCase() }}</div>
            </div>
            <button class="v2-toggle" :class="{ on: !z.muted }" :disabled="z.busy" @click="toggleMute(z)"></button>
          </div>

          <div class="volume">
            <div class="vol-label">
              <span class="vol-name">音量</span>
              <span class="vol-value v2-inter">{{ z.volume }}<span class="pct">%</span></span>
            </div>
            <div class="slider-wrap">
              <div class="slider">
                <div class="slider-fill" :style="{ width: z.volume + '%' }"></div>
              </div>
              <input
                type="range"
                :value="z.volume"
                :min="0" :max="100" :step="5"
                :disabled="z.busy || z.muted"
                class="slider-input"
                @input="onVolInput(z, $event)"
                @change="onVolChange(z, $event)"
              />
            </div>
          </div>

          <div class="ch-actions">
            <button class="v2-quick" :class="{ active: z.bgmPlaying }" :disabled="z.busy" @click="toggleBgm(z)">
              <Square v-if="z.bgmPlaying" :size="14" :stroke-width="2" />
              <Play v-else :size="14" :stroke-width="2" />
              {{ z.bgmPlaying ? '停止 BGM' : '播放 BGM' }}
            </button>
            <button class="v2-quick" :class="{ primary: z.mic }" :disabled="z.busy" @click="toggleMic(z)">
              <Mic v-if="z.mic" :size="14" :stroke-width="2" />
              <MicOff v-else :size="14" :stroke-width="2" />
              {{ z.mic ? '麦克风开' : '麦克风关' }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.v2-page { padding: var(--v2-sp-5); display: flex; flex-direction: column; gap: var(--v2-sp-4); }

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
  display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--v2-sp-3);
  padding: var(--v2-sp-4);
  background: linear-gradient(135deg, rgba(52, 211, 153, 0.05), rgba(52, 211, 153, 0.01));
  border: 1px solid rgba(52, 211, 153, 0.12);
  border-radius: var(--v2-r-lg);
}
.ov-item { display: flex; align-items: center; gap: var(--v2-sp-3); }
.ov-ico {
  width: 40px; height: 40px; border-radius: var(--v2-r-sm);
  background: rgba(52, 211, 153, 0.14); color: #34d399;
  display: grid; place-items: center; flex-shrink: 0;
}
.ov-body { display: flex; flex-direction: column; min-width: 0; }
.ov-label { font-size: var(--v2-fs-xs); color: var(--v2-text-3); letter-spacing: 1px; }
.ov-value { font-size: 20px; font-weight: 600; line-height: 1.1; margin-top: 2px; color: var(--v2-text-1); }
.ov-value .unit { font-size: 12px; color: var(--v2-text-3); margin-left: 2px; font-weight: 400; }

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
  padding: var(--v2-sp-3);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  cursor: pointer;
  text-align: left;
  color: var(--v2-text-1);
  transition: all 0.18s ease;
  min-height: 80px;
  display: flex; flex-direction: column; gap: 2px;
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

/* Channel grid */
.ch-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--v2-sp-3);
}
@media (max-width: 900px) { .ch-grid { grid-template-columns: 1fr; } }

.ch-card {
  padding: var(--v2-sp-4);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  display: flex; flex-direction: column; gap: var(--v2-sp-3);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  transition: all 0.22s ease;
}
.ch-card:not(.muted) {
  border-color: rgba(52, 211, 153, 0.22);
}
.ch-card.muted { opacity: 0.7; }
.ch-card.error { border-color: rgba(239, 68, 68, 0.4); }

.ch-top { display: flex; align-items: center; justify-content: space-between; }
.ch-meta { display: flex; flex-direction: column; gap: 2px; }
.ch-name { font-size: 17px; font-weight: 600; color: var(--v2-text-1); }
.ch-addr { font-size: 10px; color: var(--v2-text-3); letter-spacing: 1px; }

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
  background: linear-gradient(135deg, #10b981, #34d399);
  box-shadow: 0 0 10px rgba(52, 211, 153, 0.45);
}
.v2-toggle.on::after { transform: translateX(18px); }

.volume { display: flex; flex-direction: column; gap: var(--v2-sp-2); }
.vol-label { display: flex; align-items: baseline; justify-content: space-between; }
.vol-name { font-size: var(--v2-fs-xs); color: var(--v2-text-3); letter-spacing: 0.5px; }
.vol-value { font-size: 22px; font-weight: 600; color: var(--v2-text-1); }
.vol-value .pct { font-size: 12px; color: var(--v2-text-3); margin-left: 2px; font-weight: 400; }
.ch-card.muted .vol-value { color: var(--v2-text-3); }

.slider-wrap { position: relative; }
.slider {
  position: relative; height: 12px;
  background: var(--v2-surf-2); border-radius: 6px; overflow: hidden;
}
.slider-fill {
  height: 100%;
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.5), rgba(52, 211, 153, 0.9));
  border-radius: 6px;
  box-shadow: 0 0 12px rgba(52, 211, 153, 0.35);
  transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.ch-card.muted .slider-fill { background: var(--v2-surf-2); box-shadow: none; }
.slider-input {
  position: absolute; inset: 0; width: 100%; height: 100%;
  opacity: 0; cursor: pointer;
}
.slider-input:disabled { cursor: not-allowed; }

.ch-actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--v2-sp-2); }
</style>
