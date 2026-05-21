<script setup lang="ts">
import { ref, type Component } from 'vue';
import { ElMessage } from 'element-plus';
import {
  Snowflake, Flame, Wind, Sparkles, Droplet,
  Power, PowerOff, Minus, Plus, AlertCircle,
} from 'lucide-vue-next';
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

// id = CCM-270B 网关的内机序号 (1-22), 对应寄存器基地址 (id-1)×16
// 物理映射: 奥克斯商用 VRF ARV-X9 系列, 2 台外机 (DLR-785W5 一层 + DLR-1015W5 二层) + 22 台内机
// 数据来源: 《F1楼-一层二层空调位置明细》2026-05-21
const units = ref<HvacRow[]>([
  // ==================== 1F (内机 1-10, 外机 DLR-785W5 35.5kW) ====================
  { id: '1',  name: '一层企业展位 #1 (DLR-63F)',          floor: '1F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '2',  name: '一层企业展位 #2 (DLR-63F)',          floor: '1F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '3',  name: '一层企业展位 #3 (DLR-63F)',          floor: '1F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '4',  name: '一层直播间 (DLR-71F)',               floor: '1F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '5',  name: '一层外贸交易展示区 #1 (DLR-71F)',    floor: '1F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '6',  name: '一层外贸交易展示区 #2 (DLR-80F)',    floor: '1F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '7',  name: '一层园区展示 (DLR-90F)',             floor: '1F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '8',  name: '一层路演发布洽谈区 #1 (DLR-100F)',   floor: '1F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '9',  name: '一层路演发布洽谈区 #2 (DLR-112F)',   floor: '1F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '10', name: '一层企业综合展销区 (DLR-125F)',      floor: '1F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  // ==================== 2F (内机 11-22, 外机 DLR-1015W5 40.8kW) ====================
  { id: '11', name: '二层集团产业管理中心 (DLR-90F)',     floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '12', name: '二层投资决策中心 (DLR-90F)',         floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '13', name: '二层会议室 (DLR-90F)',               floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '14', name: '二层共享办公 #1 (DLR-90F)',          floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '15', name: '二层共享办公 #2 (DLR-90F)',          floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '16', name: '二层企业服务中心 #1 (DLR-90F)',      floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '17', name: '二层企业服务中心 #2 (DLR-90F)',      floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '18', name: '二层运营指挥中心 #1 (DLR-90F)',      floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '19', name: '二层运营指挥中心 #2 (DLR-90F)',      floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '20', name: '二层前厅 #1 (DLR-100F)',             floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '21', name: '二层前厅 #2 (DLR-100F)',             floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
  { id: '22', name: '二层产业研究中心 (DLR-100F)',        floor: '2F', on: false, temperature: 24, mode: 'auto', fan: 'auto', busy: false, error: null },
]);

const modes: Array<{ value: HvacMode; label: string; icon: Component }> = [
  { value: 'cool', label: '制冷', icon: Snowflake },
  { value: 'heat', label: '制热', icon: Flame },
  { value: 'fan', label: '送风', icon: Wind },
  { value: 'auto', label: '自动', icon: Sparkles },
  { value: 'dry', label: '除湿', icon: Droplet },
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
      <div class="sc-head-ico"><Snowflake :size="22" :stroke-width="1.75" /></div>
      <div>
        <h2 class="sc-title">中央空调控制</h2>
        <div class="sc-subtle">奥克斯商用 VRF ARV-X9 · 2 台外机 · CCM-270B 网关 · {{ units.length }} 台内机</div>
      </div>
    </header>

    <div class="grid">
      <div v-for="z in units" :key="z.id" class="sc-panel hvac-card" :class="{ 'is-on': z.on, 'is-error': !!z.error }">
        <div class="head">
          <div>
            <div class="name">{{ z.name }}</div>
            <div class="meta">内机 #{{ z.id }} · {{ z.floor }}</div>
          </div>
          <span class="sc-status" :class="z.error ? 'is-error' : z.on ? 'is-on' : 'is-off'">
            <span class="sc-status-dot" />
            {{ z.error ? '故障' : z.on ? '运行中' : '已关机' }}
          </span>
        </div>

        <div class="big-temp">
          <button class="step" :disabled="z.busy || !z.on" @click="adjust(z, -1)">
            <Minus :size="28" :stroke-width="2.5" />
          </button>
          <div class="temp-display">
            <div class="num">{{ z.temperature }}</div>
            <div class="unit">°C</div>
          </div>
          <button class="step" :disabled="z.busy || !z.on" @click="adjust(z, 1)">
            <Plus :size="28" :stroke-width="2.5" />
          </button>
        </div>

        <el-slider v-model="z.temperature" :min="16" :max="30" :step="1" :disabled="z.busy || !z.on" @change="applyTemp(z)" />

        <div class="section-label">运行模式</div>
        <div class="mode-row">
          <button
            v-for="m in modes"
            :key="m.value"
            class="sc-touch sc-toggle mode-btn"
            :class="{ 'is-active': z.mode === m.value }"
            :disabled="z.busy"
            @click="setMode(z, m.value)"
          >
            <component :is="m.icon" :size="22" :stroke-width="1.75" />
            <span>{{ m.label }}</span>
          </button>
        </div>

        <div class="section-label">风速</div>
        <div class="fan-row">
          <button
            v-for="f in fans"
            :key="f.value"
            class="sc-touch sc-toggle"
            :class="{ 'is-active': z.fan === f.value }"
            :disabled="z.busy"
            style="min-height: 54px;"
            @click="setFan(z, f.value)"
          >{{ f.label }}</button>
        </div>

        <div class="power-row">
          <button class="sc-touch sc-act sc-act-success" :disabled="z.busy || z.on" @click="power(z, true)">
            <Power :size="20" :stroke-width="2" /> 开机
          </button>
          <button class="sc-touch sc-act sc-act-danger" :disabled="z.busy || !z.on" @click="power(z, false)">
            <PowerOff :size="20" :stroke-width="2" /> 关机
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
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
@media (max-width: 1400px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.hvac-card {
  display: flex; flex-direction: column; gap: 14px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.hvac-card.is-on {
  border-color: rgba(59, 130, 246, 0.55);
  box-shadow: 0 12px 32px -10px rgba(59, 130, 246, 0.3);
}
.hvac-card.is-error { border-color: rgba(239, 68, 68, 0.55); }
.head { display: flex; justify-content: space-between; align-items: flex-start; }
.name { font-size: 20px; font-weight: 600; }
.meta {
  font-size: 12px; color: var(--text-secondary); margin-top: 4px;
  letter-spacing: 1px; font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.big-temp {
  display: flex; align-items: center; justify-content: space-between;
  background:
    linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(124, 58, 237, 0.12) 100%),
    var(--bg-elevated);
  border-radius: 16px;
  border: 1px solid rgba(99, 102, 241, 0.18);
  padding: 18px 26px;
}
.step {
  width: 56px; height: 56px; border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; cursor: pointer;
  box-shadow: 0 6px 18px -4px rgba(59, 130, 246, 0.5);
  transition: filter 0.15s ease, transform 0.12s ease;
}
.step:hover:not(:disabled) { filter: brightness(1.1); }
.step:active:not(:disabled) { transform: scale(0.95); }
.step:disabled { opacity: 0.3; cursor: not-allowed; filter: grayscale(0.5); }
.temp-display { display: flex; align-items: baseline; gap: 6px; }
.num {
  font-size: 64px; font-weight: 700;
  background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-variant-numeric: tabular-nums;
  letter-spacing: -1px;
}
.unit { font-size: 24px; color: var(--text-secondary); }

.section-label {
  font-size: 12px; color: var(--text-secondary);
  letter-spacing: 1.5px; text-transform: uppercase;
}
.mode-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.mode-btn {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  min-height: 76px; font-size: 13px;
  padding: 8px;
}

.fan-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }

.power-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
