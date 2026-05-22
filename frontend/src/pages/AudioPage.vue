<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Volume2, VolumeX, Mic, MicOff, Play, Square, AlertCircle, Zap } from 'lucide-vue-next';
import { audioService } from '@/services/audio.service';

// ============ EKX-808 一键场景 (12 个用户预设, 由厂家工程师录入 U01-U12) ============
interface Scene {
  id: number;
  name: string;
  hint: string;
}
const SCENES: Scene[] = [
  { id: 1,  name: '早班接待',       hint: '8-10 点全场低音量 BGM' },
  { id: 2,  name: '日常运营',       hint: '10-17 点标准音量 + 讲解' },
  { id: 3,  name: '路演演讲',       hint: 'LED 大屏区主声道' },
  { id: 4,  name: '大型发布会',     hint: '全场开 + 大屏突出' },
  { id: 5,  name: '会议室独立',     hint: 'ZONE 8 独立 + AEC' },
  { id: 6,  name: '跟随讲解',       hint: 'WTG-800 RSSI 自动激活' },
  { id: 7,  name: '政府接待 VIP',   hint: '高规格全场 +0dB' },
  { id: 8,  name: '夜间静音',       hint: '18-8 点全场静音' },
  { id: 9,  name: '应急广播',       hint: '消防/疏散最大声强插' },
  { id: 10, name: '大屏视频',       hint: 'ZONE 1 全频 + SUB12' },
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
  } finally {
    sceneBusy.value = false;
  }
}

async function refreshCurrentScene(): Promise<void> {
  try {
    const wrapped = await audioService.currentScene();
    const preset = wrapped?.data?.data?.preset;
    if (typeof preset === 'number' && preset >= 1 && preset <= 12) {
      currentScene.value = preset;
    }
  } catch { /* 静默 */ }
}
onMounted(() => { refreshCurrentScene(); });

interface AudioRow {
  id: string;
  name: string;
  zone: string;
  volume: number;
  muted: boolean;
  bgm: string;
  bgmPlaying: boolean;
  mic: boolean;
  busy: boolean;
  error: string | null;
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
    ElMessage.success(`${z.name} ${label}成功`);
    return true;
  } catch (err) {
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} ${label}失败: ${z.error}`);
    return false;
  } finally { z.busy = false; }
}

async function applyVolume(z: AudioRow): Promise<void> {
  await call(z, `音量 ${z.volume}`, () => audioService.setVolume(z.id, z.volume, z.zone));
}

async function toggleMute(z: AudioRow): Promise<void> {
  const next = !z.muted;
  const ok = await call(z, next ? '静音' : '取消静音',
    () => (next ? audioService.mute(z.id, z.zone) : audioService.unmute(z.id, z.zone)));
  if (ok) z.muted = next;
}

async function playBgm(z: AudioRow): Promise<void> {
  const ok = await call(z, '播放背景音乐', () => audioService.playBgm(z.id, z.bgm || undefined, z.zone));
  if (ok) z.bgmPlaying = true;
}

async function stopBgm(z: AudioRow): Promise<void> {
  const ok = await call(z, '停止背景音乐', () => audioService.stopBgm(z.id, z.zone));
  if (ok) z.bgmPlaying = false;
}

async function toggleMic(z: AudioRow): Promise<void> {
  const next = !z.mic;
  const ok = await call(z, next ? '开启麦克风' : '关闭麦克风',
    () => audioService.mic(z.id, next, z.zone));
  if (ok) z.mic = next;
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="sc-head-ico"><Volume2 :size="22" :stroke-width="1.75" /></div>
      <div>
        <h2 class="sc-title">音响控制</h2>
        <div class="sc-subtle">得胜 EKX-808 8×8 矩阵 + WTG-800 跟随讲解 · 分区音量 / 麦克风 / 场景预设</div>
      </div>
    </header>

    <!-- ============ EKX-808 一键场景 ============ -->
    <section class="sc-panel scene-section">
      <div class="scene-head">
        <div class="scene-title">
          <Zap :size="20" :stroke-width="2" />
          <span>一键场景预设</span>
          <span class="scene-tag">U01-U12 由厂家工程师在 PC 软件预先录入, 切换 1 条命令搞定全部 8 路</span>
        </div>
        <div v-if="currentScene" class="scene-current">
          当前: <strong>{{ SCENES[currentScene-1]?.name }}</strong>
          <code>U{{ String(currentScene).padStart(2,'0') }}</code>
        </div>
      </div>
      <div class="scene-grid">
        <button
          v-for="s in SCENES"
          :key="s.id"
          class="scene-btn"
          :class="{ active: currentScene === s.id }"
          :disabled="sceneBusy"
          @click="recallScene(s)"
        >
          <div class="scene-id">U{{ String(s.id).padStart(2,'0') }}</div>
          <div class="scene-name">{{ s.name }}</div>
          <div class="scene-hint">{{ s.hint }}</div>
        </button>
      </div>
    </section>

    <div class="grid">
      <div v-for="z in channels" :key="z.id" class="sc-panel ch-card" :class="{ 'is-error': !!z.error, 'is-muted': z.muted }">
        <div class="head">
          <div>
            <div class="name">{{ z.name }}</div>
            <div class="meta">{{ z.id }} · 分区 {{ z.zone }}</div>
          </div>
          <span class="sc-status" :class="z.error ? 'is-error' : z.muted ? 'is-warning' : 'is-on'">
            <span class="sc-status-dot" />
            {{ z.error ? '故障' : z.muted ? '静音' : '工作中' }}
          </span>
        </div>

        <div class="vol">
          <div class="vol-num">{{ z.volume }}</div>
          <div class="vol-bar"><div class="vol-fill" :class="{ muted: z.muted }" :style="{ width: z.volume + '%' }"></div></div>
        </div>

        <el-slider v-model="z.volume" :min="0" :max="100" :step="5" :disabled="z.busy" @change="applyVolume(z)" />

        <div class="rows">
          <button
            class="sc-touch sc-act"
            :class="z.muted ? 'sc-act-warning' : 'sc-act-neutral'"
            :disabled="z.busy"
            @click="toggleMute(z)"
          >
            <component :is="z.muted ? VolumeX : Volume2" :size="20" :stroke-width="2" />
            {{ z.muted ? '取消静音' : '静音' }}
          </button>
          <button
            class="sc-touch sc-act"
            :class="z.mic ? 'sc-act-purple' : 'sc-act-neutral'"
            :disabled="z.busy"
            @click="toggleMic(z)"
          >
            <component :is="z.mic ? Mic : MicOff" :size="20" :stroke-width="2" />
            {{ z.mic ? '麦克风开' : '麦克风关' }}
          </button>
        </div>

        <div class="section-label">背景音乐</div>
        <div class="bgm">
          <el-input v-model="z.bgm" placeholder="曲目名 (如 welcome)" size="large" />
          <button class="sc-touch sc-act sc-act-primary" :disabled="z.busy" @click="playBgm(z)">
            <Play :size="20" :stroke-width="2" /> 播放
          </button>
          <button class="sc-touch sc-act sc-act-danger" :disabled="z.busy" @click="stopBgm(z)">
            <Square :size="20" :stroke-width="2" /> 停止
          </button>
        </div>

        <div v-if="z.error" class="sc-err">
          <AlertCircle :size="16" :stroke-width="2" /> {{ z.error }}
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 18px; }
.page-head { display: flex; align-items: center; gap: 14px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.ch-card {
  display: flex; flex-direction: column; gap: 14px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.ch-card.is-muted {
  border-color: rgba(245, 158, 11, 0.55);
  box-shadow: 0 12px 32px -10px rgba(245, 158, 11, 0.28);
}
.ch-card.is-error { border-color: rgba(239, 68, 68, 0.55); }

.head { display: flex; justify-content: space-between; align-items: flex-start; }
.name { font-size: 20px; font-weight: 600; }
.meta {
  font-size: 12px; color: var(--text-secondary); margin-top: 4px;
  letter-spacing: 1px; font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.vol { display: flex; align-items: center; gap: 14px; }
.vol-num {
  font-size: 40px; font-weight: 700; min-width: 80px;
  background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-variant-numeric: tabular-nums;
}
.vol-bar { flex: 1; height: 8px; background: var(--bg-elevated); border-radius: 4px; overflow: hidden; }
.vol-fill {
  height: 100%;
  background: linear-gradient(90deg, #10b981 0%, #3b82f6 100%);
  transition: width 0.18s;
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.5);
}
.vol-fill.muted {
  background: linear-gradient(90deg, #f59e0b 0%, #d97706 100%);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.5);
}

.rows { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.section-label {
  font-size: 12px; color: var(--text-secondary);
  letter-spacing: 1.5px; text-transform: uppercase;
}
.bgm { display: grid; grid-template-columns: 1fr 110px 110px; gap: 10px; }

/* ============ 场景预设 ============ */
.scene-section { display: flex; flex-direction: column; gap: 14px; padding: 18px; }
.scene-head { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 10px; }
.scene-title {
  display: flex; align-items: center; gap: 10px;
  font-size: 16px; font-weight: 600;
}
.scene-tag {
  font-size: 11px; color: var(--text-secondary); font-weight: 400;
  margin-left: 4px;
}
.scene-current {
  font-size: 13px; color: var(--text-secondary);
  display: flex; align-items: center; gap: 8px;
}
.scene-current code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  background: var(--bg-elevated); padding: 2px 8px; border-radius: 4px;
  letter-spacing: 1px;
}
.scene-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.scene-btn {
  display: flex; flex-direction: column; gap: 4px;
  padding: 14px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
  color: var(--text-primary);
}
.scene-btn:hover:not(:disabled) {
  border-color: #3b82f6;
  transform: translateY(-1px);
  box-shadow: 0 6px 18px -8px rgba(59, 130, 246, 0.45);
}
.scene-btn.active {
  border-color: #10b981;
  background: linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(59,130,246,0.08) 100%);
  box-shadow: 0 6px 18px -8px rgba(16, 185, 129, 0.4);
}
.scene-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.scene-id {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: var(--text-secondary);
  letter-spacing: 1px;
}
.scene-name { font-size: 15px; font-weight: 600; }
.scene-hint { font-size: 11px; color: var(--text-secondary); }

@media (max-width: 1100px) {
  .grid { grid-template-columns: 1fr; }
  .scene-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .scene-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
