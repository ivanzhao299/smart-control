<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
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
      <h2 class="sc-title">🖥 LED 大屏控制</h2>
      <div class="sc-subtle">诺瓦 VX1000 + NUC 播控 · 开关 / 输入 / 播放</div>
    </header>

    <div class="grid">
      <div v-for="z in screens" :key="z.id" class="sc-panel led-card" :class="{ 'is-on': z.power, 'is-error': !!z.error }">
        <div class="head">
          <div>
            <div class="name">{{ z.name }}</div>
            <div class="meta">{{ z.id }} · {{ z.floor }}</div>
          </div>
          <span class="sc-pill" :class="z.error ? 'is-error' : z.power ? 'is-success' : 'is-default'">
            {{ z.error ? '故障' : z.power ? '开屏' : '关屏' }}
          </span>
        </div>

        <div class="screen-display" :class="{ 'is-on': z.power }">
          <div v-if="!z.power" class="off-mask">屏幕已关闭</div>
          <div v-else class="on-content">
            <div class="screen-input">{{ z.input }}</div>
            <div v-if="z.media" class="screen-media">▶ {{ z.media }}</div>
          </div>
        </div>

        <div class="power-row">
          <button class="sc-touch act on" :disabled="z.busy" @click="power(z, true)">开屏</button>
          <button class="sc-touch act off" :disabled="z.busy" @click="power(z, false)">关屏</button>
          <button class="sc-touch act welcome" :disabled="z.busy" @click="welcome(z)">欢迎页</button>
        </div>

        <div class="section-label">输入源</div>
        <div class="input-row">
          <button
            v-for="i in inputs"
            :key="i"
            class="sc-touch input-btn"
            :class="{ 'is-active': z.input === i }"
            :disabled="z.busy"
            @click="changeInput(z, i)"
          >{{ i }}</button>
        </div>

        <div class="section-label">播放视频</div>
        <div class="play-row">
          <el-input v-model="z.media" placeholder="文件名 / 频道 (如 welcome.mp4)" size="large" />
          <button class="sc-touch act play" :disabled="z.busy" @click="play(z)">播放</button>
        </div>

        <div v-if="z.error" class="err-msg">{{ z.error }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 18px; }
.page-head { display: flex; align-items: baseline; gap: 14px; }
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.led-card { display: flex; flex-direction: column; gap: 14px; }
.led-card.is-on { border-color: var(--color-primary); }
.led-card.is-error { border-color: var(--color-error); }
.head { display: flex; justify-content: space-between; }
.name { font-size: 20px; font-weight: 600; }
.meta { font-size: 12px; color: var(--text-secondary); margin-top: 4px; letter-spacing: 1px; }

.screen-display {
  height: 130px;
  background: #0a1020;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  position: relative;
}
.off-mask { color: var(--text-secondary); font-size: 16px; }
.on-content {
  background: radial-gradient(circle at 30% 30%, rgba(37,99,235,0.45) 0%, transparent 70%);
  width: 100%; height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px;
}
.screen-input {
  font-size: 28px; font-weight: 700; color: #fff;
  letter-spacing: 4px;
}
.screen-media { color: var(--text-secondary); font-size: 14px; }

.power-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.section-label { font-size: 12px; color: var(--text-secondary); letter-spacing: 1px; margin-top: 4px; }
.input-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.input-btn {
  background: var(--bg-elevated);
  color: var(--text-primary);
  min-height: 56px;
  font-size: 15px;
}
.input-btn.is-active { background: var(--color-primary); color: #fff; box-shadow: var(--shadow-button); }
.input-btn:disabled { opacity: 0.55; }

.act { color: #fff; }
.act.on { background: var(--color-success); }
.act.off { background: var(--color-error); }
.act.welcome { background: var(--color-warning); color: #1f2937; }
.act.play { background: var(--color-primary); }
.act:disabled { opacity: 0.55; cursor: not-allowed; }

.play-row { display: grid; grid-template-columns: 1fr 130px; gap: 10px; }
.err-msg { font-size: 13px; color: var(--color-error); background: rgba(239,68,68,0.08); padding: 6px 10px; border-radius: 8px; }

@media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
</style>
