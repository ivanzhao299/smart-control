<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue';
import { ElMessage } from 'element-plus';
import {
  Snowflake, Flame, Wind, Sparkles, Droplet,
  Power, PowerOff, Minus, Plus, AlertCircle, ChevronDown, ChevronRight,
} from 'lucide-vue-next';
import { hvacService, type HvacFan, type HvacMode, type HvacZone } from '@/services/hvac.service';

// 内机型号映射 (跟 seed.service.ts / HVAC_FIELD_INSTALL §3 一致)
const INDOOR_MODELS: Record<number, { model: string; kw: number }> = {
  1:  { model: 'DLR-63F',  kw: 1.8 },  2:  { model: 'DLR-63F',  kw: 1.8 },  3:  { model: 'DLR-63F',  kw: 1.8 },
  4:  { model: 'DLR-71F',  kw: 2.0 },  5:  { model: 'DLR-71F',  kw: 2.0 },  6:  { model: 'DLR-80F',  kw: 2.0 },
  7:  { model: 'DLR-90F',  kw: 2.2 },  8:  { model: 'DLR-100F', kw: 2.2 },  9:  { model: 'DLR-112F', kw: 2.2 },
  10: { model: 'DLR-125F', kw: 2.2 },
  11: { model: 'DLR-90F',  kw: 2.2 },  12: { model: 'DLR-90F',  kw: 2.2 },  13: { model: 'DLR-90F',  kw: 2.2 },
  14: { model: 'DLR-90F',  kw: 2.2 },  15: { model: 'DLR-90F',  kw: 2.2 },  16: { model: 'DLR-90F',  kw: 2.2 },
  17: { model: 'DLR-90F',  kw: 2.2 },  18: { model: 'DLR-90F',  kw: 2.2 },  19: { model: 'DLR-90F',  kw: 2.2 },
  20: { model: 'DLR-100F', kw: 2.2 },  21: { model: 'DLR-100F', kw: 2.2 },  22: { model: 'DLR-100F', kw: 2.2 },
};

interface IndoorState {
  on: boolean;
  temperature: number;
  mode: HvacMode;
  fan: HvacFan;
}
interface ZoneState extends HvacZone {
  expanded: boolean;
  busy: boolean;
  error: string | null;
  indoorStates: Map<number, IndoorState>;
}

const zones = ref<ZoneState[]>([]);
const loading = ref(false);

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

function freshIndoor(): IndoorState {
  return { on: false, temperature: 24, mode: 'auto', fan: 'auto' };
}

async function loadZones(): Promise<void> {
  loading.value = true;
  try {
    const list = await hvacService.listZones();
    zones.value = list.map(z => ({
      ...z,
      expanded: false,
      busy: false,
      error: null,
      indoorStates: new Map(z.indoors.map(idx => [idx, freshIndoor()])),
    }));
  } catch (err) {
    ElMessage.error('加载空调区域失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

onMounted(() => { void loadZones(); });

function zoneStatusLabel(z: ZoneState): { label: string; cls: string } {
  const states = Array.from(z.indoorStates.values());
  const onCount = states.filter(s => s.on).length;
  if (z.error) return { label: '故障', cls: 'is-error' };
  if (onCount === 0) return { label: '已关机', cls: 'is-off' };
  if (onCount === states.length) return { label: `运行中 (${onCount}/${states.length})`, cls: 'is-on' };
  return { label: `部分开 (${onCount}/${states.length})`, cls: 'is-warning' };
}

function avgTemp(z: ZoneState): number {
  const states = Array.from(z.indoorStates.values());
  return Math.round(states.reduce((s, x) => s + x.temperature, 0) / Math.max(1, states.length));
}

function commonMode(z: ZoneState): HvacMode | null {
  const states = Array.from(z.indoorStates.values());
  if (!states.length) return null;
  return states.every(s => s.mode === states[0].mode) ? states[0].mode : null;
}

function commonFan(z: ZoneState): HvacFan | null {
  const states = Array.from(z.indoorStates.values());
  if (!states.length) return null;
  return states.every(s => s.fan === states[0].fan) ? states[0].fan : null;
}

async function zoneCall(z: ZoneState, label: string, fn: () => Promise<{ okCount: number; failCount: number; total: number }>): Promise<boolean> {
  z.busy = true; z.error = null;
  try {
    const r = await fn();
    if (r.failCount === 0) {
      ElMessage.success(`${z.name} ${label}成功 (${r.okCount}/${r.total})`);
      return true;
    } else if (r.okCount > 0) {
      ElMessage.warning(`${z.name} ${label}部分成功 ${r.okCount}/${r.total}`);
      return true;
    } else {
      throw new Error(`全部失败`);
    }
  } catch (err) {
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} ${label}失败: ${z.error}`);
    return false;
  } finally { z.busy = false; }
}

async function zonePower(z: ZoneState, on: boolean): Promise<void> {
  const ok = await zoneCall(z, on ? '开机' : '关机', () => on ? hvacService.zoneOn(z.code) : hvacService.zoneOff(z.code));
  if (ok) z.indoorStates.forEach(s => s.on = on);
}
async function zoneAdjustTemp(z: ZoneState, delta: number): Promise<void> {
  const next = Math.max(16, Math.min(30, avgTemp(z) + delta));
  if (next === avgTemp(z)) return;
  const ok = await zoneCall(z, `温度 ${next}°C`, () => hvacService.zoneTemperature(z.code, next));
  if (ok) z.indoorStates.forEach(s => s.temperature = next);
}
async function zoneSetMode(z: ZoneState, mode: HvacMode): Promise<void> {
  const ok = await zoneCall(z, `模式 ${mode}`, () => hvacService.zoneMode(z.code, mode));
  if (ok) z.indoorStates.forEach(s => s.mode = mode);
}
async function zoneSetFan(z: ZoneState, fan: HvacFan): Promise<void> {
  const ok = await zoneCall(z, `风速 ${fan}`, () => hvacService.zoneFanSpeed(z.code, fan));
  if (ok) z.indoorStates.forEach(s => s.fan = fan);
}

// 单内机操作 (展开后)
async function indoorPower(z: ZoneState, idx: number, on: boolean): Promise<void> {
  z.busy = true;
  try {
    const r = on ? await hvacService.on(String(idx)) : await hvacService.off(String(idx));
    if (!r.ok) throw new Error(r.error || '失败');
    z.indoorStates.get(idx)!.on = on;
    ElMessage.success(`内机 #${idx} ${on ? '开机' : '关机'}成功`);
  } catch (err) {
    ElMessage.error(`内机 #${idx} 操作失败: ${(err as Error).message}`);
  } finally { z.busy = false; }
}

const floor1Zones = computed(() => zones.value.filter(z => z.floor === '1F'));
const floor2Zones = computed(() => zones.value.filter(z => z.floor === '2F'));
const totalIndoors = computed(() => zones.value.reduce((s, z) => s + z.indoors.length, 0));
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="sc-head-ico"><Snowflake :size="22" :stroke-width="1.75" /></div>
      <div>
        <h2 class="sc-title">中央空调控制</h2>
        <div class="sc-subtle">奥克斯 ARV-X9 · 2 外机 · CCM-270B 网关 · {{ zones.length }} 个功能区 · {{ totalIndoors }} 台内机</div>
      </div>
    </header>

    <div v-if="loading" class="sc-panel" style="text-align: center; padding: 40px;">
      加载空调区域中...
    </div>

    <template v-else>
      <div v-if="floor1Zones.length" class="floor-section">
        <div class="floor-label">一层 1F · {{ floor1Zones.length }} 个功能区</div>
        <div class="grid">
          <div v-for="z in floor1Zones" :key="z.code" class="sc-panel zone-card" :class="zoneStatusLabel(z).cls">
            <!-- 区头部 -->
            <div class="zone-head">
              <div>
                <div class="zone-name">{{ z.name }}</div>
                <div class="zone-meta">{{ z.indoors.length }} 台内机 · {{ z.desc }}</div>
              </div>
              <span class="sc-status" :class="zoneStatusLabel(z).cls">
                <span class="sc-status-dot" /> {{ zoneStatusLabel(z).label }}
              </span>
            </div>

            <!-- 温度大显示 + 加减 -->
            <div class="big-temp">
              <button class="step" :disabled="z.busy" @click="zoneAdjustTemp(z, -1)">
                <Minus :size="22" :stroke-width="2.5" />
              </button>
              <div class="temp-display">
                <div class="num">{{ avgTemp(z) }}</div>
                <div class="unit">°C</div>
              </div>
              <button class="step" :disabled="z.busy" @click="zoneAdjustTemp(z, 1)">
                <Plus :size="22" :stroke-width="2.5" />
              </button>
            </div>

            <!-- 区级模式 -->
            <div class="row-label">模式</div>
            <div class="mode-row">
              <button v-for="m in modes" :key="m.value"
                class="sc-touch sc-toggle mode-btn"
                :class="{ 'is-active': commonMode(z) === m.value }"
                :disabled="z.busy"
                @click="zoneSetMode(z, m.value)"
              >
                <component :is="m.icon" :size="18" :stroke-width="1.75" />
                <span>{{ m.label }}</span>
              </button>
            </div>

            <!-- 区级风速 -->
            <div class="row-label">风速</div>
            <div class="fan-row">
              <button v-for="f in fans" :key="f.value"
                class="sc-touch sc-toggle"
                :class="{ 'is-active': commonFan(z) === f.value }"
                :disabled="z.busy"
                @click="zoneSetFan(z, f.value)"
              >{{ f.label }}</button>
            </div>

            <!-- 区级开关 -->
            <div class="power-row">
              <button class="sc-touch sc-act sc-act-success" :disabled="z.busy" @click="zonePower(z, true)">
                <Power :size="18" :stroke-width="2" /> 整区开机
              </button>
              <button class="sc-touch sc-act sc-act-danger" :disabled="z.busy" @click="zonePower(z, false)">
                <PowerOff :size="18" :stroke-width="2" /> 整区关机
              </button>
            </div>

            <!-- 展开/收起 内机明细 -->
            <button v-if="z.indoors.length > 1" class="expand-btn" @click="z.expanded = !z.expanded">
              <component :is="z.expanded ? ChevronDown : ChevronRight" :size="16" />
              {{ z.expanded ? '收起内机明细' : `查看 ${z.indoors.length} 台内机明细` }}
            </button>

            <div v-if="z.expanded || z.indoors.length === 1" class="indoor-list">
              <div v-for="idx in z.indoors" :key="idx" class="indoor-item">
                <div class="indoor-info">
                  <span class="indoor-no">#{{ idx }}</span>
                  <span class="indoor-model">{{ INDOOR_MODELS[idx]?.model || '-' }} · {{ INDOOR_MODELS[idx]?.kw }}kW</span>
                </div>
                <div class="indoor-actions">
                  <span class="sc-status sm" :class="z.indoorStates.get(idx)?.on ? 'is-on' : 'is-off'">
                    <span class="sc-status-dot" /> {{ z.indoorStates.get(idx)?.on ? '运行' : '关机' }}
                  </span>
                  <button class="sc-touch indoor-btn" :disabled="z.busy" @click="indoorPower(z, idx, !z.indoorStates.get(idx)?.on)">
                    {{ z.indoorStates.get(idx)?.on ? '关' : '开' }}
                  </button>
                </div>
              </div>
            </div>

            <div v-if="z.error" class="sc-err">
              <AlertCircle :size="16" :stroke-width="2" /> {{ z.error }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="floor2Zones.length" class="floor-section">
        <div class="floor-label">二层 2F · {{ floor2Zones.length }} 个功能区</div>
        <div class="grid">
          <div v-for="z in floor2Zones" :key="z.code" class="sc-panel zone-card" :class="zoneStatusLabel(z).cls">
            <div class="zone-head">
              <div>
                <div class="zone-name">{{ z.name }}</div>
                <div class="zone-meta">{{ z.indoors.length }} 台内机 · {{ z.desc }}</div>
              </div>
              <span class="sc-status" :class="zoneStatusLabel(z).cls">
                <span class="sc-status-dot" /> {{ zoneStatusLabel(z).label }}
              </span>
            </div>
            <div class="big-temp">
              <button class="step" :disabled="z.busy" @click="zoneAdjustTemp(z, -1)">
                <Minus :size="22" :stroke-width="2.5" />
              </button>
              <div class="temp-display">
                <div class="num">{{ avgTemp(z) }}</div>
                <div class="unit">°C</div>
              </div>
              <button class="step" :disabled="z.busy" @click="zoneAdjustTemp(z, 1)">
                <Plus :size="22" :stroke-width="2.5" />
              </button>
            </div>
            <div class="row-label">模式</div>
            <div class="mode-row">
              <button v-for="m in modes" :key="m.value"
                class="sc-touch sc-toggle mode-btn"
                :class="{ 'is-active': commonMode(z) === m.value }"
                :disabled="z.busy"
                @click="zoneSetMode(z, m.value)"
              >
                <component :is="m.icon" :size="18" :stroke-width="1.75" />
                <span>{{ m.label }}</span>
              </button>
            </div>
            <div class="row-label">风速</div>
            <div class="fan-row">
              <button v-for="f in fans" :key="f.value"
                class="sc-touch sc-toggle"
                :class="{ 'is-active': commonFan(z) === f.value }"
                :disabled="z.busy"
                @click="zoneSetFan(z, f.value)"
              >{{ f.label }}</button>
            </div>
            <div class="power-row">
              <button class="sc-touch sc-act sc-act-success" :disabled="z.busy" @click="zonePower(z, true)">
                <Power :size="18" :stroke-width="2" /> 整区开机
              </button>
              <button class="sc-touch sc-act sc-act-danger" :disabled="z.busy" @click="zonePower(z, false)">
                <PowerOff :size="18" :stroke-width="2" /> 整区关机
              </button>
            </div>
            <button v-if="z.indoors.length > 1" class="expand-btn" @click="z.expanded = !z.expanded">
              <component :is="z.expanded ? ChevronDown : ChevronRight" :size="16" />
              {{ z.expanded ? '收起内机明细' : `查看 ${z.indoors.length} 台内机明细` }}
            </button>
            <div v-if="z.expanded || z.indoors.length === 1" class="indoor-list">
              <div v-for="idx in z.indoors" :key="idx" class="indoor-item">
                <div class="indoor-info">
                  <span class="indoor-no">#{{ idx }}</span>
                  <span class="indoor-model">{{ INDOOR_MODELS[idx]?.model || '-' }} · {{ INDOOR_MODELS[idx]?.kw }}kW</span>
                </div>
                <div class="indoor-actions">
                  <span class="sc-status sm" :class="z.indoorStates.get(idx)?.on ? 'is-on' : 'is-off'">
                    <span class="sc-status-dot" /> {{ z.indoorStates.get(idx)?.on ? '运行' : '关机' }}
                  </span>
                  <button class="sc-touch indoor-btn" :disabled="z.busy" @click="indoorPower(z, idx, !z.indoorStates.get(idx)?.on)">
                    {{ z.indoorStates.get(idx)?.on ? '关' : '开' }}
                  </button>
                </div>
              </div>
            </div>
            <div v-if="z.error" class="sc-err">
              <AlertCircle :size="16" :stroke-width="2" /> {{ z.error }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 24px; }
.page-head { display: flex; align-items: center; gap: 14px; }
.floor-section { display: flex; flex-direction: column; gap: 12px; }
.floor-label {
  font-size: 13px; letter-spacing: 2px; text-transform: uppercase;
  color: var(--text-secondary); font-weight: 600;
  padding-left: 4px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
@media (max-width: 1400px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 900px)  { .grid { grid-template-columns: 1fr; } }

.zone-card {
  display: flex; flex-direction: column; gap: 10px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.zone-card.is-on {
  border-color: rgba(59, 130, 246, 0.55);
  box-shadow: 0 12px 32px -10px rgba(59, 130, 246, 0.3);
}
.zone-card.is-warning { border-color: rgba(245, 158, 11, 0.5); }
.zone-card.is-error { border-color: rgba(239, 68, 68, 0.55); }

.zone-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.zone-name { font-size: 17px; font-weight: 600; }
.zone-meta {
  font-size: 11px; color: var(--text-secondary); margin-top: 3px;
}
.sc-status.sm { font-size: 10px; padding: 2px 6px; }

.big-temp {
  display: flex; align-items: center; justify-content: space-between;
  background:
    linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(124, 58, 237, 0.12) 100%),
    var(--bg-elevated);
  border-radius: 12px;
  border: 1px solid rgba(99, 102, 241, 0.18);
  padding: 12px 18px;
}
.step {
  width: 42px; height: 42px; border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; cursor: pointer;
  box-shadow: 0 4px 14px -3px rgba(59, 130, 246, 0.5);
}
.step:hover:not(:disabled) { filter: brightness(1.1); }
.step:active:not(:disabled) { transform: scale(0.95); }
.step:disabled { opacity: 0.3; cursor: not-allowed; }
.temp-display { display: flex; align-items: baseline; gap: 4px; }
.num {
  font-size: 44px; font-weight: 700;
  background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.unit { font-size: 18px; color: var(--text-secondary); }

.row-label {
  font-size: 11px; color: var(--text-secondary);
  letter-spacing: 1.5px; text-transform: uppercase;
  margin-top: 2px;
}
.mode-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.mode-btn {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  min-height: 56px; font-size: 11px;
  padding: 6px 4px;
}
.fan-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.power-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

.expand-btn {
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--text-secondary);
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  display: flex; align-items: center; justify-content: center; gap: 4px;
}
.expand-btn:hover { background: var(--bg-elevated); color: var(--text); }

.indoor-list {
  display: flex; flex-direction: column; gap: 6px;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
.indoor-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 8px;
  background: var(--bg-elevated);
  border-radius: 6px;
  font-size: 12px;
}
.indoor-info { display: flex; align-items: center; gap: 8px; }
.indoor-no {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: var(--text-secondary);
  font-size: 11px;
}
.indoor-model { color: var(--text); }
.indoor-actions { display: flex; align-items: center; gap: 8px; }
.indoor-btn {
  padding: 4px 12px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #fff;
  border: none; border-radius: 4px;
  font-size: 11px; cursor: pointer;
}
.indoor-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
