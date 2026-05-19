<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  MonitorPlay,
  Power,
  PowerOff,
  Sparkles,
  Play,
  Tv2,
  AlertCircle,
} from 'lucide-vue-next';
import { ledService, type LedInput } from '@/services/led.service';

interface LedRow {
  id: string;
  name: string;
  floor: string;
  power: boolean;
  input: LedInput;
  media: string;
  busy: boolean;
  error: string | null;
}

const screens = ref<LedRow[]>([
  { id: 'led_1f_main', name: '一层主 LED', floor: '1F', power: false, input: 'HDMI1', media: '', busy: false, error: null },
  { id: 'led_2f_main', name: '二层主 LED', floor: '2F', power: false, input: 'HDMI1', media: '', busy: false, error: null },
]);

const inputs: LedInput[] = ['HDMI1', 'HDMI2', 'welcome', 'video'];

async function call(z: LedRow, label: string, fn: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
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

async function power(z: LedRow, on: boolean): Promise<void> {
  const ok = await call(z, on ? '开屏' : '关屏', () => (on ? ledService.on(z.id) : ledService.off(z.id)));
  if (ok) z.power = on;
}

async function changeInput(z: LedRow, input: LedInput): Promise<void> {
  const ok = await call(z, `切换 ${input}`, () => ledService.switchInput(z.id, input));
  if (ok) { z.input = input; z.power = true; }
}

async function play(z: LedRow): Promise<void> {
  const ok = await call(z, '播放', () => ledService.play(z.id, z.media || undefined));
  if (ok) z.power = true;
}

async function welcome(z: LedRow): Promise<void> {
  const ok = await call(z, '欢迎页', () => ledService.welcome(z.id));
  if (ok) { z.power = true; z.input = 'welcome'; }
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="sc-head-ico"><MonitorPlay :size="22" :stroke-width="1.75" /></div>
      <div>
        <h2 class="sc-title">LED 大屏控制</h2>
        <div class="sc-subtle">诺瓦 VX1000 + NUC 播控 · 开关 / 输入 / 播放</div>
      </div>
    </header>

    <div class="grid">
      <div v-for="z in screens" :key="z.id" class="sc-panel led-card" :class="{ 'is-on': z.power, 'is-error': !!z.error }">
        <div class="head">
          <div>
            <div class="name">{{ z.name }}</div>
            <div class="meta">{{ z.id }} · {{ z.floor }}</div>
          </div>
          <span class="sc-status" :class="z.error ? 'is-error' : z.power ? 'is-on' : 'is-off'">
            <span class="sc-status-dot" />
            {{ z.error ? '故障' : z.power ? '运行中' : '已关闭' }}
          </span>
        </div>

        <div class="screen-display" :class="{ 'is-on': z.power }">
          <template v-if="!z.power">
            <Tv2 class="screen-icon" :size="44" :stroke-width="1.5" />
            <div class="off-mask">屏幕已关闭</div>
          </template>
          <div v-else class="on-content">
            <div class="screen-input">{{ z.input }}</div>
            <div v-if="z.media" class="screen-media">
              <Play :size="14" :stroke-width="2.5" /> {{ z.media }}
            </div>
          </div>
        </div>

        <div class="power-row">
          <button class="sc-touch sc-act sc-act-success" :disabled="z.busy || z.power" @click="power(z, true)">
            <Power :size="20" :stroke-width="2" /> 开屏
          </button>
          <button class="sc-touch sc-act sc-act-danger" :disabled="z.busy || !z.power" @click="power(z, false)">
            <PowerOff :size="20" :stroke-width="2" /> 关屏
          </button>
          <button class="sc-touch sc-act sc-act-warning" :disabled="z.busy" @click="welcome(z)">
            <Sparkles :size="20" :stroke-width="2" /> 欢迎页
          </button>
        </div>

        <div class="section-label">输入源</div>
        <div class="input-row">
          <button
            v-for="i in inputs"
            :key="i"
            class="sc-touch sc-toggle"
            :class="{ 'is-active': z.input === i }"
            :disabled="z.busy"
            style="min-height: 54px; font-size: 15px;"
            @click="changeInput(z, i)"
          >{{ i }}</button>
        </div>

        <div class="section-label">播放视频</div>
        <div class="play-row">
          <el-input v-model="z.media" placeholder="文件名 / 频道 (如 welcome.mp4)" size="large" />
          <button class="sc-touch sc-act sc-act-primary" :disabled="z.busy" @click="play(z)">
            <Play :size="20" :stroke-width="2" /> 播放
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
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.led-card { display: flex; flex-direction: column; gap: 14px; }
.led-card.is-on {
  border-color: rgba(59, 130, 246, 0.55);
  box-shadow: 0 12px 32px -10px rgba(59, 130, 246, 0.3);
}
.led-card.is-error { border-color: rgba(239, 68, 68, 0.55); }
.head { display: flex; justify-content: space-between; align-items: flex-start; }
.name { font-size: 20px; font-weight: 600; }
.meta {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  letter-spacing: 1px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

/* 屏幕预览区 */
.screen-display {
  height: 140px;
  background:
    radial-gradient(circle at center, rgba(15, 23, 42, 0.4) 0%, rgba(2, 6, 23, 0.95) 100%);
  border-radius: 14px;
  border: 1px solid var(--border-soft);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  overflow: hidden;
  position: relative;
  gap: 10px;
}
.screen-display.is-on {
  background:
    radial-gradient(circle at 30% 30%, rgba(37, 99, 235, 0.35) 0%, transparent 65%),
    radial-gradient(circle at 70% 70%, rgba(124, 58, 237, 0.25) 0%, transparent 65%),
    #020617;
  border-color: rgba(59, 130, 246, 0.5);
}
.screen-icon { color: rgba(148, 163, 184, 0.5); }
.off-mask { color: var(--text-secondary); font-size: 14px; letter-spacing: 2px; }
.on-content {
  width: 100%; height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px;
}
.screen-input {
  font-size: 30px; font-weight: 700; color: #fff;
  letter-spacing: 5px;
  text-shadow: 0 2px 12px rgba(59, 130, 246, 0.4);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.screen-media {
  display: inline-flex; align-items: center; gap: 6px;
  color: #cbd5e1; font-size: 13px;
}

.power-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.section-label { font-size: 12px; color: var(--text-secondary); letter-spacing: 1.5px; margin-top: 4px; text-transform: uppercase; }
.input-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.play-row { display: grid; grid-template-columns: 1fr 140px; gap: 10px; }

@media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
</style>
