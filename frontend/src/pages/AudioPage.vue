<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Volume2, VolumeX, Mic, MicOff, Play, Square, AlertCircle } from 'lucide-vue-next';
import { audioService } from '@/services/audio.service';

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
        <div class="sc-subtle">DSPPA/ITC DSP · 分区音量 / 背景音 / 麦克风</div>
      </div>
    </header>

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

@media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
</style>
