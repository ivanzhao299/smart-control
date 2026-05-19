<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { hvacService, type HvacFan, type HvacMode } from '@/services/hvac.service';

interface HvacRow {
  id: string;
  name: string;
  floor: string;
  on: boolean;
  temperature: number;
  mode: HvacMode;
  fan: HvacFan;
  busy: boolean;
  error: string | null;
}

const units = ref<HvacRow[]>([
  { id: 'hvac_1f', name: '一层中央空调', floor: '1F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: 'hvac_2f', name: '二层中央空调', floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
]);

const modes: Array<{ value: HvacMode; label: string; icon: string }> = [
  { value: 'cool', label: '制冷', icon: '❄️' },
  { value: 'heat', label: '制热', icon: '🔥' },
  { value: 'fan', label: '送风', icon: '🌬' },
  { value: 'auto', label: '自动', icon: '✨' },
  { value: 'dry', label: '除湿', icon: '💧' },
];
const fans: Array<{ value: HvacFan; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '低' },
  { value: 'mid', label: '中' },
  { value: 'high', label: '高' },
];

async function call(z: HvacRow, label: string, fn: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
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

async function power(z: HvacRow, on: boolean): Promise<void> {
  const ok = await call(z, on ? '开机' : '关机', () => (on ? hvacService.on(z.id) : hvacService.off(z.id)));
  if (ok) z.on = on;
}

function adjust(z: HvacRow, delta: number): void {
  const next = Math.max(16, Math.min(30, z.temperature + delta));
  if (next === z.temperature) return;
  z.temperature = next;
  void call(z, `温度 ${next}°C`, () => hvacService.setTemperature(z.id, next));
}

async function applyTemp(z: HvacRow): Promise<void> {
  await call(z, `温度 ${z.temperature}°C`, () => hvacService.setTemperature(z.id, z.temperature));
}

async function setMode(z: HvacRow, mode: HvacMode): Promise<void> {
  const ok = await call(z, `模式 ${mode}`, () => hvacService.setMode(z.id, mode));
  if (ok) z.mode = mode;
}

async function setFan(z: HvacRow, fan: HvacFan): Promise<void> {
  const ok = await call(z, `风速 ${fan}`, () => hvacService.setFanSpeed(z.id, fan));
  if (ok) z.fan = fan;
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <h2 class="sc-title">❄️ 中央空调控制</h2>
      <div class="sc-subtle">Modbus TCP · 温度 16-30°C · 5 种运行模式</div>
    </header>

    <div class="grid">
      <div v-for="z in units" :key="z.id" class="sc-panel hvac-card" :class="{ 'is-on': z.on, 'is-error': !!z.error }">
        <div class="head">
          <div>
            <div class="name">{{ z.name }}</div>
            <div class="meta">{{ z.id }} · {{ z.floor }}</div>
          </div>
          <span class="sc-pill" :class="z.error ? 'is-error' : z.on ? 'is-success' : 'is-default'">
            {{ z.error ? '故障' : z.on ? '运行中' : '关机' }}
          </span>
        </div>

        <div class="big-temp">
          <button class="step" :disabled="z.busy || !z.on" @click="adjust(z, -1)">−</button>
          <div class="temp-display">
            <div class="num">{{ z.temperature }}</div>
            <div class="unit">°C</div>
          </div>
          <button class="step" :disabled="z.busy || !z.on" @click="adjust(z, 1)">＋</button>
        </div>

        <el-slider v-model="z.temperature" :min="16" :max="30" :step="1" :disabled="z.busy || !z.on" @change="applyTemp(z)" />

        <div class="section-label">运行模式</div>
        <div class="mode-row">
          <button
            v-for="m in modes"
            :key="m.value"
            class="sc-touch mode-btn"
            :class="{ 'is-active': z.mode === m.value }"
            :disabled="z.busy"
            @click="setMode(z, m.value)"
          >
            <span class="mode-ico">{{ m.icon }}</span>
            <span>{{ m.label }}</span>
          </button>
        </div>

        <div class="section-label">风速</div>
        <div class="fan-row">
          <button
            v-for="f in fans"
            :key="f.value"
            class="sc-touch fan-btn"
            :class="{ 'is-active': z.fan === f.value }"
            :disabled="z.busy"
            @click="setFan(z, f.value)"
          >{{ f.label }}</button>
        </div>

        <div class="power-row">
          <button class="sc-touch act on" :disabled="z.busy" @click="power(z, true)">开机</button>
          <button class="sc-touch act off" :disabled="z.busy" @click="power(z, false)">关机</button>
        </div>

        <div v-if="z.error" class="err-msg">{{ z.error }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 18px; }
.page-head { display: flex; align-items: baseline; gap: 14px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.hvac-card { display: flex; flex-direction: column; gap: 12px; }
.hvac-card.is-on { border-color: var(--color-primary); }
.hvac-card.is-error { border-color: var(--color-error); }
.head { display: flex; justify-content: space-between; }
.name { font-size: 20px; font-weight: 600; }
.meta { font-size: 12px; color: var(--text-secondary); margin-top: 4px; letter-spacing: 1px; }

.big-temp {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  padding: 16px 24px;
}
.step {
  width: 56px; height: 56px; border-radius: 50%;
  background: var(--color-primary); color: #fff;
  font-size: 30px; font-weight: 600; border: none; cursor: pointer;
}
.step:disabled { opacity: 0.4; cursor: not-allowed; }
.temp-display { display: flex; align-items: baseline; gap: 6px; }
.num { font-size: 64px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.unit { font-size: 24px; color: var(--text-secondary); }

.section-label { font-size: 12px; color: var(--text-secondary); letter-spacing: 1px; }
.mode-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.mode-btn {
  background: var(--bg-elevated);
  color: var(--text-primary);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  min-height: 70px; font-size: 13px;
}
.mode-btn .mode-ico { font-size: 22px; }
.mode-btn.is-active { background: var(--color-primary); color: #fff; }
.mode-btn:disabled { opacity: 0.55; }

.fan-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.fan-btn {
  background: var(--bg-elevated);
  color: var(--text-primary);
  min-height: 52px; font-size: 15px;
}
.fan-btn.is-active { background: var(--color-info); color: #1f2937; }
.fan-btn:disabled { opacity: 0.55; }

.power-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.act { color: #fff; }
.act.on { background: var(--color-success); }
.act.off { background: var(--color-error); }
.act:disabled { opacity: 0.55; cursor: not-allowed; }

.err-msg { font-size: 13px; color: var(--color-error); background: rgba(239,68,68,0.08); padding: 6px 10px; border-radius: 8px; }

@media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
</style>
