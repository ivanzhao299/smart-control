<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, Snowflake, Flame, Wind, Sparkles, Droplet,
  Power, X, Minus, Plus, Thermometer,
} from 'lucide-vue-next';
import { hvacService, type HvacFan, type HvacMode, type HvacZone } from '@/services/hvac.service';

interface IndoorState {
  on: boolean;
  temperature: number;
  mode: HvacMode;
  fan: HvacFan;
}
interface ZoneState extends HvacZone {
  busy: boolean;
  error: string | null;
  indoorStates: Map<number, IndoorState>;
}

const zones = ref<ZoneState[]>([]);
const loading = ref(false);

const modes: Array<{ value: HvacMode; label: string; icon: Component }> = [
  { value: 'cool', label: '制冷', icon: Snowflake },
  { value: 'heat', label: '制热', icon: Flame },
  { value: 'fan',  label: '送风', icon: Wind },
  { value: 'auto', label: '自动', icon: Sparkles },
  { value: 'dry',  label: '除湿', icon: Droplet },
];
const fans: Array<{ value: HvacFan; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'low',  label: '低' },
  { value: 'mid',  label: '中' },
  { value: 'high', label: '高' },
];

function freshIndoor(): IndoorState {
  return { on: false, temperature: 24, mode: 'auto', fan: 'auto' };
}

async function loadZones(): Promise<void> {
  loading.value = true;
  try {
    const list = await hvacService.listZones();
    zones.value = list.map((z) => ({
      ...z,
      busy: false,
      error: null,
      indoorStates: new Map(z.indoors.map((idx) => [idx, freshIndoor()])),
    }));
  } catch (err) {
    ElMessage.error('加载空调区域失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(() => { void loadZones(); });

function avgTemp(z: ZoneState): number {
  const states = Array.from(z.indoorStates.values());
  if (!states.length) return 24;
  return Math.round(states.reduce((s, x) => s + x.temperature, 0) / states.length);
}
function commonMode(z: ZoneState): HvacMode | null {
  const states = Array.from(z.indoorStates.values());
  if (!states.length) return null;
  return states.every((s) => s.mode === states[0].mode) ? states[0].mode : null;
}
function commonFan(z: ZoneState): HvacFan | null {
  const states = Array.from(z.indoorStates.values());
  if (!states.length) return null;
  return states.every((s) => s.fan === states[0].fan) ? states[0].fan : null;
}
function zoneOnCount(z: ZoneState): number {
  return Array.from(z.indoorStates.values()).filter((s) => s.on).length;
}

// 乐观更新: 点击瞬间整区 UI 立即变, 后台异步下发, 全失败才回滚 (备份各室内机原值)
async function zoneToggle(z: ZoneState): Promise<void> {
  const want = zoneOnCount(z) === 0;
  const saved = new Map([...z.indoorStates].map(([k, s]) => [k, s.on]));
  z.indoorStates.forEach((s) => (s.on = want));
  z.error = null;
  try {
    const r = await (want ? hvacService.zoneOn(z.code) : hvacService.zoneOff(z.code));
    if (r.okCount === 0 && r.failCount > 0) throw new Error('全部失败');
  } catch (err) {
    z.indoorStates.forEach((s, k) => (s.on = saved.get(k) ?? s.on));
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} ${want ? '开机' : '关机'} 失败: ${z.error}`);
  }
}
async function zoneAdjustTemp(z: ZoneState, delta: number): Promise<void> {
  const cur = avgTemp(z);
  const next = Math.max(16, Math.min(30, cur + delta));
  if (next === cur) return;
  const saved = new Map([...z.indoorStates].map(([k, s]) => [k, s.temperature]));
  z.indoorStates.forEach((s) => (s.temperature = next));
  z.error = null;
  try {
    const r = await hvacService.zoneTemperature(z.code, next);
    if (r.okCount === 0 && r.failCount > 0) throw new Error('全部失败');
  } catch (err) {
    z.indoorStates.forEach((s, k) => (s.temperature = saved.get(k) ?? s.temperature));
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} 温度 失败: ${z.error}`);
  }
}
async function zoneSetMode(z: ZoneState, mode: HvacMode): Promise<void> {
  const saved = new Map([...z.indoorStates].map(([k, s]) => [k, s.mode]));
  z.indoorStates.forEach((s) => (s.mode = mode));
  z.error = null;
  try {
    const r = await hvacService.zoneMode(z.code, mode);
    if (r.okCount === 0 && r.failCount > 0) throw new Error('全部失败');
  } catch (err) {
    z.indoorStates.forEach((s, k) => (s.mode = saved.get(k) ?? s.mode));
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} 模式 失败: ${z.error}`);
  }
}
async function zoneSetFan(z: ZoneState, fan: HvacFan): Promise<void> {
  const saved = new Map([...z.indoorStates].map(([k, s]) => [k, s.fan]));
  z.indoorStates.forEach((s) => (s.fan = fan));
  z.error = null;
  try {
    const r = await hvacService.zoneFanSpeed(z.code, fan);
    if (r.okCount === 0 && r.failCount > 0) throw new Error('全部失败');
  } catch (err) {
    z.indoorStates.forEach((s, k) => (s.fan = saved.get(k) ?? s.fan));
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} 风速 失败: ${z.error}`);
  }
}

// ============ 楼层 Tab + 总览 ============
type FloorTab = '1F' | '2F' | 'all';
const floorTab = ref<FloorTab>('1F');
const filteredZones = computed(() => {
  if (floorTab.value === 'all') return zones.value;
  return zones.value.filter((z) => z.floor === floorTab.value);
});

const overview = computed(() => {
  const total = zones.value.length;
  const onCount = zones.value.filter((z) => zoneOnCount(z) > 0).length;
  const totalIndoor = zones.value.reduce((s, z) => s + z.indoors.length, 0);
  const onlineIndoor = zones.value.reduce((s, z) => s + zoneOnCount(z), 0);
  const allTemps = zones.value.flatMap((z) => Array.from(z.indoorStates.values()).map((s) => s.temperature));
  const avgT = allTemps.length === 0 ? 24 : Math.round(allTemps.reduce((s, t) => s + t, 0) / allTemps.length);
  return { total, onCount, totalIndoor, onlineIndoor, avgT };
});

const router = useRouter();
function goBack(): void { router.push({ name: 'dashboard' }); }

async function allOn(): Promise<void> {
  for (const z of filteredZones.value) { if (zoneOnCount(z) === 0) await zoneToggle(z); }
}
async function allOff(): Promise<void> {
  for (const z of filteredZones.value) { if (zoneOnCount(z) > 0) await zoneToggle(z); }
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
          <div class="title"><Snowflake :size="18" :stroke-width="1.8" /> 中央空调</div>
          <div class="sub">中弘 B 集控网关 · 2 楼层 · {{ zones.length }} 个功能区 · {{ overview.totalIndoor }} 台内机</div>
        </div>
        <div class="v2-tabs">
          <button class="v2-tab" :class="{ active: floorTab === '1F' }" @click="floorTab = '1F'">一楼</button>
          <button class="v2-tab" :class="{ active: floorTab === '2F' }" @click="floorTab = '2F'">二楼</button>
          <button class="v2-tab" :class="{ active: floorTab === 'all' }" @click="floorTab = 'all'">全部</button>
        </div>
      </div>
      <div class="quick-actions">
        <button class="v2-quick primary" @click="allOn">
          <Power :size="14" :stroke-width="2" /> 全部开
        </button>
        <button class="v2-quick danger" @click="allOff">
          <X :size="14" :stroke-width="2" /> 全部关
        </button>
      </div>
    </header>

    <!-- 总览 -->
    <div class="v2-overview hvac">
      <div class="ov-item">
        <div class="ov-ico"><Snowflake :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">运行分区</div>
          <div class="ov-value v2-inter">{{ overview.onCount }}<span class="unit">/ {{ overview.total }}</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Power :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">在线内机</div>
          <div class="ov-value v2-inter">{{ overview.onlineIndoor }}<span class="unit">/ {{ overview.totalIndoor }}</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Thermometer :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">平均温度</div>
          <div class="ov-value v2-inter">{{ overview.avgT }}<span class="unit">°C</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Wind :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">网关</div>
          <div class="ov-value v2-inter" style="font-size: 16px;">中弘 ZHONGHONG</div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading-tip">加载空调区域中...</div>

    <div v-else class="v2-zone-grid">
      <div
        v-for="z in filteredZones"
        :key="z.code"
        class="v2-hvac-zone"
        :class="{ on: zoneOnCount(z) > 0, offline: !!z.error }"
      >
        <div class="zone-top">
          <div class="zone-meta">
            <div class="zone-name">{{ z.name }}</div>
            <div class="zone-addr v2-inter">{{ z.indoors.length }} 内机 · {{ z.floor }}</div>
          </div>
          <button
            class="v2-toggle"
            :class="{ on: zoneOnCount(z) > 0 }"
            :disabled="z.busy"
            @click="zoneToggle(z)"
          ></button>
        </div>

        <!-- 温度大显示 + 加减 -->
        <div class="temp-block">
          <button class="step" :disabled="z.busy || zoneOnCount(z) === 0" @click="zoneAdjustTemp(z, -1)">
            <Minus :size="22" :stroke-width="2.5" />
          </button>
          <div class="temp-display">
            <div class="temp-num v2-inter">{{ avgTemp(z) }}</div>
            <div class="temp-unit">°C</div>
          </div>
          <button class="step" :disabled="z.busy || zoneOnCount(z) === 0" @click="zoneAdjustTemp(z, 1)">
            <Plus :size="22" :stroke-width="2.5" />
          </button>
        </div>

        <!-- 模式 -->
        <div class="row-block">
          <div class="row-name">模式</div>
          <div class="mode-row">
            <button
              v-for="m in modes"
              :key="m.value"
              class="mode-btn"
              :class="{ active: commonMode(z) === m.value }"
              :disabled="z.busy"
              @click="zoneSetMode(z, m.value)"
            >
              <component :is="m.icon" :size="16" :stroke-width="1.8" />
              <span>{{ m.label }}</span>
            </button>
          </div>
        </div>

        <!-- 风速 -->
        <div class="row-block">
          <div class="row-name">风速</div>
          <div class="fan-row">
            <button
              v-for="f in fans"
              :key="f.value"
              class="fan-btn"
              :class="{ active: commonFan(z) === f.value }"
              :disabled="z.busy"
              @click="zoneSetFan(z, f.value)"
            >{{ f.label }}</button>
          </div>
        </div>
      </div>
    </div>
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
.title {
  font-size: 15px; font-weight: 600; color: var(--v2-text-1);
  display: inline-flex; align-items: center; gap: var(--v2-sp-2);
}
.sub { font-size: var(--v2-fs-xs); color: var(--v2-text-3); margin-top: 2px; }

.v2-tabs {
  display: inline-flex;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-sm); padding: 3px;
  margin-left: var(--v2-sp-3);
}
.v2-tab {
  padding: 5px 14px; border-radius: 6px;
  font-size: var(--v2-fs-sm); color: var(--v2-text-2);
  cursor: pointer; background: transparent; border: none;
  transition: all 0.18s ease;
}
.v2-tab.active {
  background: rgba(96, 165, 250, 0.16); color: #60a5fa;
  box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.2);
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
  background: rgba(96, 165, 250, 0.14); color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.3);
}
.v2-quick.danger {
  background: rgba(239, 68, 68, 0.1); color: var(--v2-danger);
  border-color: rgba(239, 68, 68, 0.3);
}

/* Overview (HVAC blue) */
.v2-overview.hvac {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--v2-sp-3);
  padding: var(--v2-sp-4);
  background: linear-gradient(135deg, rgba(96, 165, 250, 0.05), rgba(96, 165, 250, 0.01));
  border: 1px solid rgba(96, 165, 250, 0.12);
  border-radius: var(--v2-r-lg);
}
.ov-item { display: flex; align-items: center; gap: var(--v2-sp-3); }
.ov-ico {
  width: 40px; height: 40px; border-radius: var(--v2-r-sm);
  background: rgba(96, 165, 250, 0.14); color: #60a5fa;
  display: grid; place-items: center; flex-shrink: 0;
}
.ov-body { display: flex; flex-direction: column; min-width: 0; }
.ov-label { font-size: var(--v2-fs-xs); color: var(--v2-text-3); letter-spacing: 1px; }
.ov-value { font-size: 20px; font-weight: 600; line-height: 1.1; margin-top: 2px; color: var(--v2-text-1); }
.ov-value .unit { font-size: 12px; color: var(--v2-text-3); margin-left: 2px; font-weight: 400; }

.loading-tip {
  padding: 40px;
  text-align: center;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  color: var(--v2-text-3);
}

/* Zone grid */
.v2-zone-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--v2-sp-3);
}
@media (max-width: 1280px) { .v2-zone-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 720px)  { .v2-zone-grid { grid-template-columns: 1fr; } }
@media (max-width: 600px)  {
  .v2-hvac-zone { padding: var(--v2-sp-3); gap: var(--v2-sp-3); }
  .zone-name { font-size: 14px; }
  .temp-num { font-size: 32px; }
  .step { width: 40px; height: 40px; }
  .v2-toggle { width: 48px; height: 28px; }
  .v2-toggle::after { width: 24px; height: 24px; }
  .v2-toggle.on::after { transform: translateX(20px); }
}

.v2-hvac-zone {
  position: relative;
  padding: var(--v2-sp-4);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  display: flex; flex-direction: column; gap: var(--v2-sp-3);
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
/* 顶部 1px 深空蓝光带 — HVAC 主色 */
.v2-hvac-zone::after {
  content: '';
  position: absolute;
  top: 0; left: 12%; right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--v2-info) 50%, transparent);
  box-shadow: 0 0 8px var(--v2-info);
  opacity: 0.35;
  pointer-events: none;
  transition: opacity 0.28s ease;
}
.v2-hvac-zone:hover {
  transform: translateY(-3px);
  border-color: rgba(91, 143, 255, 0.45);
  box-shadow:
    inset 0 1px 0 rgba(91, 143, 255, 0.55),
    0 0 0 1px rgba(91, 143, 255, 0.15),
    0 14px 32px -10px rgba(91, 143, 255, 0.3);
}
.v2-hvac-zone:hover::after { opacity: 0.85; }
.v2-hvac-zone.on {
  border-color: rgba(91, 143, 255, 0.55);
  background: linear-gradient(135deg, rgba(91, 143, 255, 0.10), rgba(67, 56, 202, 0.04));
  box-shadow:
    inset 0 1px 0 rgba(91, 143, 255, 0.65),
    0 8px 32px -8px rgba(91, 143, 255, 0.45),
    0 0 40px -10px rgba(91, 143, 255, 0.30) !important;
}
.v2-hvac-zone.on::after { opacity: 1; }
.v2-hvac-zone.offline { opacity: 0.5; border-color: rgba(255, 71, 87, 0.55); }

.zone-top { display: flex; align-items: center; justify-content: space-between; }
.zone-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.zone-name { font-size: 15px; font-weight: 600; color: var(--v2-text-1); letter-spacing: 0.5px; }
.zone-addr { font-size: 10px; color: var(--v2-text-3); letter-spacing: 1px; }

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
  background: linear-gradient(135deg, #4F46E5, #5B8FFF);
  box-shadow:
    0 0 14px rgba(91, 143, 255, 0.6),
    0 0 28px rgba(91, 143, 255, 0.35);
}
.v2-toggle.on::after {
  background: white;
  box-shadow: 0 1px 4px rgba(0,0,0,0.4), 0 0 8px rgba(255, 255, 255, 0.6);
}
.v2-toggle.on::after { transform: translateX(18px); }

/* 温度大显示 */
.temp-block {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  gap: var(--v2-sp-3);
  padding: var(--v2-sp-3);
  background: var(--v2-surf-2);
  border-radius: var(--v2-r-md);
}
.step {
  width: 44px; height: 44px;
  border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2);
  display: grid; place-items: center;
  cursor: pointer;
  transition: all 0.18s ease;
}
.step:hover:not(:disabled) {
  background: rgba(96, 165, 250, 0.14);
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.3);
}
.step:disabled { opacity: 0.4; cursor: not-allowed; }
.temp-display {
  display: flex; align-items: baseline; justify-content: center; gap: 4px;
}
.temp-num {
  font-size: 40px; font-weight: 700;
  color: var(--v2-text-1);
  line-height: 1;
}
.v2-hvac-zone.on .temp-num {
  background: linear-gradient(135deg, #5B8FFF 0%, #A855F7 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 12px rgba(91, 143, 255, 0.55));
}
.temp-unit { font-size: 18px; color: var(--v2-text-3); }

/* 模式 / 风速 行 */
.row-block { display: flex; flex-direction: column; gap: var(--v2-sp-1); }
.row-name {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-3);
  letter-spacing: 0.5px;
}
.mode-row {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px;
}
.mode-btn {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 8px 0;
  border-radius: 6px;
  background: var(--v2-surf-2);
  color: var(--v2-text-2);
  cursor: pointer; border: 1px solid transparent;
  transition: all 0.18s ease;
  font-size: 11px;
  min-height: 44px;
}
.mode-btn:hover:not(:disabled) { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.mode-btn.active {
  background: rgba(96, 165, 250, 0.14);
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.3);
}
.mode-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.fan-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.fan-btn {
  padding: 10px 0; border-radius: 6px;
  background: var(--v2-surf-2);
  color: var(--v2-text-2);
  cursor: pointer; border: 1px solid transparent;
  font-size: var(--v2-fs-sm);
  transition: all 0.18s ease;
  min-height: 40px;
}
.fan-btn:hover:not(:disabled) { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.fan-btn.active {
  background: rgba(96, 165, 250, 0.14);
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.3);
}
.fan-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
