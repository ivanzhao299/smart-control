<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, Zap, Power, X, RefreshCw, Activity, Gauge, Lightbulb, Plug,
  MonitorPlay, Snowflake, Volume2,
} from 'lucide-vue-next';
import {
  powerCircuitsService,
  type PowerCircuitView,
} from '@/services/power-circuits.service';

const ICON_MAP: Record<string, typeof Zap> = {
  Zap, Lightbulb, Plug, MonitorPlay, Snowflake, Volume2,
};
function iconFor(name: string | null): typeof Zap {
  if (name && ICON_MAP[name]) return ICON_MAP[name];
  return Zap;
}

const circuits = ref<PowerCircuitView[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const busyIds = ref<Set<number>>(new Set());

async function loadCircuits(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    circuits.value = await powerCircuitsService.list();
    const floors = floorOptions.value;
    if (!floors.includes(floorTab.value) && floors.length > 0) {
      floorTab.value = floors[0];
    }
  } catch (err) {
    loadError.value = (err as Error).message;
    ElMessage.error(`加载电源回路失败: ${loadError.value}`);
  } finally {
    loading.value = false;
  }
}

// 楼层 tab
const floorTab = ref<string>('1F');
const floorOptions = computed<string[]>(() => {
  const set = new Set<string>();
  for (const c of circuits.value) set.add(c.floor);
  return Array.from(set).sort();
});
const filteredCircuits = computed(() => {
  if (floorTab.value === 'all') return circuits.value;
  return circuits.value.filter((c) => c.floor === floorTab.value);
});

// 总览
const overview = computed(() => {
  const total = circuits.value.length;
  const onCount = circuits.value.filter((c) => c.reading.on).length;
  const totalPower = circuits.value.reduce((s, c) => s + (c.reading.on ? c.reading.power : 0), 0);
  const totalEnergy = circuits.value.reduce((s, c) => s + c.reading.energy, 0);
  return { total, onCount, totalPower, totalEnergy };
});

// 单回路 on/off
async function dispatchOne(c: PowerCircuitView, op: 'on' | 'off'): Promise<void> {
  busyIds.value.add(c.id);
  try {
    const updated = op === 'on'
      ? await powerCircuitsService.on(c.id)
      : await powerCircuitsService.off(c.id);
    // 替换本地数据
    const idx = circuits.value.findIndex((x) => x.id === c.id);
    if (idx >= 0) circuits.value[idx] = updated;
  } catch (err) {
    ElMessage.error(`${c.name} ${op === 'on' ? '通电' : '断电'}失败: ${(err as Error).message}`);
  } finally {
    busyIds.value.delete(c.id);
  }
}

async function dispatchMany(targets: PowerCircuitView[], op: 'on' | 'off'): Promise<void> {
  for (const c of targets) {
    await dispatchOne(c, op);
  }
}

async function allOn(): Promise<void> {
  ElMessage.info(`全部通电 — 逐路下发 (${circuits.value.length} 路, 跨所有楼层)`);
  await dispatchMany(circuits.value, 'on');
}
async function allOff(): Promise<void> {
  ElMessage.warning(`全部断电 — 逐路下发 (${circuits.value.length} 路, 跨所有楼层)`);
  await dispatchMany(circuits.value, 'off');
}
async function floorOn(): Promise<void> {
  ElMessage.info(`${floorTab.value} 通电 — 逐路下发 (${filteredCircuits.value.length} 路)`);
  await dispatchMany(filteredCircuits.value, 'on');
}
async function floorOff(): Promise<void> {
  ElMessage.warning(`${floorTab.value} 断电 — 逐路下发 (${filteredCircuits.value.length} 路)`);
  await dispatchMany(filteredCircuits.value, 'off');
}

// 实时刷新 — 每 5 秒拉一次最新读数 (mock adapter 几乎零开销)
let refreshTimer: ReturnType<typeof setInterval> | null = null;
function startRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (!loading.value && busyIds.value.size === 0) {
      void powerCircuitsService.list().then((rows) => {
        circuits.value = rows;
      }).catch(() => { /* 静默 */ });
    }
  }, 5000);
}
function stopRefresh(): void {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

const router = useRouter();
function goBack(): void { router.push({ name: 'dashboard' }); }

onMounted(() => {
  void loadCircuits();
  startRefresh();
});
onUnmounted(() => { stopRefresh(); });
</script>

<template>
  <section class="v2-page">
    <!-- 页面头部 -->
    <header class="v2-page-head">
      <div class="back-row">
        <button class="v2-back-btn" @click="goBack" title="返回首页">
          <ArrowLeft :size="18" :stroke-width="2" />
        </button>
        <div class="title-block">
          <div class="title"><Zap :size="18" :stroke-width="1.8" /> 电源管理</div>
          <div class="sub">{{ overview.total }} 路 · 共 {{ Math.round(overview.totalPower) }} W</div>
        </div>
        <div class="v2-tabs">
          <button
            v-for="f in floorOptions"
            :key="f"
            class="v2-tab"
            :class="{ active: floorTab === f }"
            @click="floorTab = f"
          >{{ f }}</button>
          <button class="v2-tab" :class="{ active: floorTab === 'all' }" @click="floorTab = 'all'">全部</button>
        </div>
      </div>
      <div class="quick-actions">
        <button class="v2-quick" @click="loadCircuits" :disabled="loading" title="重新加载">
          <RefreshCw :size="14" :stroke-width="2" />
        </button>
        <button
          v-if="floorTab !== 'all'"
          class="v2-quick"
          @click="floorOn"
          :disabled="loading || filteredCircuits.length === 0"
        >
          <Power :size="14" :stroke-width="2" /> {{ floorTab }} 通电
        </button>
        <button
          v-if="floorTab !== 'all'"
          class="v2-quick"
          @click="floorOff"
          :disabled="loading || filteredCircuits.length === 0"
        >
          <X :size="14" :stroke-width="2" /> {{ floorTab }} 断电
        </button>
        <button class="v2-quick primary" @click="allOn" :disabled="loading || circuits.length === 0" title="整馆通电">
          <Power :size="14" :stroke-width="2" /> 全部通电
        </button>
        <button class="v2-quick danger" @click="allOff" :disabled="loading || circuits.length === 0" title="整馆断电">
          <X :size="14" :stroke-width="2" /> 全部断电
        </button>
      </div>
    </header>

    <!-- 总览 -->
    <div class="v2-overview">
      <div class="ov-item">
        <div class="ov-ico"><Power :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">通电回路</div>
          <div class="ov-value v2-inter">{{ overview.onCount }}<span class="unit">/ {{ overview.total }}</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Activity :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">实时功率</div>
          <div class="ov-value v2-inter">{{ Math.round(overview.totalPower) }}<span class="unit">W</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Gauge :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">累计电量</div>
          <div class="ov-value v2-inter">{{ overview.totalEnergy.toFixed(2) }}<span class="unit">kWh</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Zap :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">数据源</div>
          <div class="ov-value v2-inter" style="font-size: 14px; color: var(--v2-warning);">模拟</div>
        </div>
      </div>
    </div>

    <!-- 加载/错误/空态 -->
    <div v-if="loading && circuits.length === 0" class="state-card">
      <Zap :size="32" :stroke-width="1.5" />
      <div class="state-title">加载电源回路中…</div>
    </div>
    <div v-else-if="loadError" class="state-card error">
      <X :size="32" :stroke-width="2" />
      <div class="state-title">加载失败</div>
      <div class="state-sub">{{ loadError }}</div>
      <button class="v2-quick primary" @click="loadCircuits"><RefreshCw :size="14" /> 重试</button>
    </div>
    <div v-else-if="circuits.length === 0" class="state-card">
      <Zap :size="32" :stroke-width="1.5" />
      <div class="state-title">还没有配置电源回路</div>
      <div class="state-sub">到 后台 → 电源回路 添加</div>
    </div>

    <!-- 回路网格 -->
    <div v-else class="circuit-grid">
      <div
        v-for="c in filteredCircuits"
        :key="c.id"
        class="circuit-card"
        :class="{ on: c.reading.on }"
      >
        <!-- 顶部 -->
        <div class="card-top">
          <div class="card-ico"><component :is="iconFor(c.icon)" :size="22" :stroke-width="1.8" /></div>
          <div class="card-meta">
            <div class="card-name">{{ c.name }}</div>
            <div class="card-floor">{{ c.floor }} · {{ c.ratedVoltage }}V {{ c.ratedCurrent }}A</div>
          </div>
          <button
            class="v2-toggle"
            :class="{ on: c.reading.on }"
            :disabled="busyIds.has(c.id)"
            @click="dispatchOne(c, c.reading.on ? 'off' : 'on')"
            :title="c.reading.on ? '断电' : '通电'"
          ></button>
        </div>

        <!-- 4 数据值 -->
        <div class="metrics">
          <div class="metric">
            <div class="metric-label">电流</div>
            <div class="metric-value v2-inter">
              <span class="num">{{ c.reading.current.toFixed(2) }}</span><span class="unit">A</span>
            </div>
          </div>
          <div class="metric">
            <div class="metric-label">电压</div>
            <div class="metric-value v2-inter">
              <span class="num">{{ c.reading.voltage.toFixed(1) }}</span><span class="unit">V</span>
            </div>
          </div>
          <div class="metric">
            <div class="metric-label">功率</div>
            <div class="metric-value v2-inter">
              <span class="num">{{ Math.round(c.reading.power) }}</span><span class="unit">W</span>
            </div>
          </div>
          <div class="metric">
            <div class="metric-label">累计</div>
            <div class="metric-value v2-inter">
              <span class="num">{{ c.reading.energy.toFixed(2) }}</span><span class="unit">kWh</span>
            </div>
          </div>
        </div>

        <!-- 底部 chip 行 -->
        <div class="chip-row">
          <span class="chip" :data-category="c.category">{{ c.category }}</span>
          <span v-if="c.gatewayCode" class="chip muted">CH {{ c.relayChannel ?? '-' }}</span>
          <span class="chip" :class="c.reading.on ? 'on' : 'off'">
            {{ c.reading.on ? '通电' : '断电' }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.v2-page {
  padding: var(--v2-sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--v2-sp-4);
}

/* ============ 页头 ============ */
.v2-page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--v2-sp-4);
  flex-wrap: wrap;
}
.back-row { display: flex; align-items: center; gap: var(--v2-sp-4); }
.v2-back-btn {
  width: 36px; height: 36px;
  border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  display: grid; place-items: center;
  cursor: pointer;
  color: var(--v2-text-2);
  transition: all 0.18s ease;
}
.v2-back-btn:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.title-block { display: flex; flex-direction: column; }
.title {
  font-size: 15px;
  font-weight: 600;
  color: var(--v2-text-1);
  display: inline-flex;
  align-items: center;
  gap: var(--v2-sp-2);
  letter-spacing: 0.5px;
}
.sub {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-2);
  margin-top: 2px;
}

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
}
.v2-tab.active {
  background: var(--v2-purple-soft);
  color: #C084FC;
  box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.3);
}

.quick-actions { display: flex; gap: var(--v2-sp-2); }
.v2-quick {
  padding: 8px 14px;
  border-radius: var(--v2-r-sm);
  font-size: var(--v2-fs-sm);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.18s ease;
  min-height: 36px;
}
.v2-quick:hover:not(:disabled) {
  background: var(--v2-surf-1-hover);
  color: var(--v2-text-1);
  border-color: rgba(168, 85, 247, 0.45);
}
.v2-quick.primary {
  background: var(--v2-purple-soft);
  color: #C084FC;
  border-color: rgba(168, 85, 247, 0.45);
}
.v2-quick.danger {
  background: var(--v2-danger-soft);
  color: #FCA5A5;
  border-color: rgba(255, 71, 87, 0.45);
}
.v2-quick:disabled { opacity: 0.4; cursor: not-allowed; }

/* ============ 总览 ============ */
.v2-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--v2-sp-3);
  padding: var(--v2-sp-4);
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.06), rgba(168, 85, 247, 0.01));
  border: 1px solid rgba(168, 85, 247, 0.18);
  border-radius: var(--v2-r-lg);
}
.ov-item { display: flex; align-items: center; gap: var(--v2-sp-3); }
.ov-ico {
  width: 40px; height: 40px;
  border-radius: var(--v2-r-sm);
  background: var(--v2-purple-soft);
  color: #C084FC;
  display: grid; place-items: center;
  flex-shrink: 0;
  filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.5));
}
.ov-body { display: flex; flex-direction: column; min-width: 0; }
.ov-label { font-size: var(--v2-fs-xs); color: var(--v2-text-2); letter-spacing: 1px; text-transform: uppercase; }
.ov-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
  margin-top: 2px;
  color: #E9D5FF;
  text-shadow: var(--v2-text-glow-purple);
  letter-spacing: 0.5px;
}
.ov-value .unit { font-size: 12px; color: var(--v2-text-3); margin-left: 4px; font-weight: 500; text-shadow: none; }

/* ============ 回路卡 ============ */
.circuit-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--v2-sp-3);
}
@media (max-width: 1280px) { .circuit-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 720px)  { .circuit-grid { grid-template-columns: 1fr; } }
@media (max-width: 600px)  {
  .v2-page { padding: var(--v2-sp-3); gap: var(--v2-sp-3); }
  .v2-overview { padding: var(--v2-sp-3); gap: var(--v2-sp-2); grid-template-columns: 1fr 1fr; }
  .ov-value { font-size: 18px; }
  .ov-ico { width: 32px; height: 32px; }
  .circuit-card { padding: var(--v2-sp-3); }
  .metrics { grid-template-columns: 1fr 1fr; gap: var(--v2-sp-2); }
  .metric-value { font-size: 16px; }
  .quick-actions { flex-wrap: wrap; }
  .v2-toggle { width: 48px; height: 28px; }
  .v2-toggle::after { width: 24px; height: 24px; }
  .v2-toggle.on::after { transform: translateX(20px); }
}

.circuit-card {
  position: relative;
  padding: var(--v2-sp-4);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  display: flex;
  flex-direction: column;
  gap: var(--v2-sp-3);
  overflow: hidden;
  transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.circuit-card::after {
  content: '';
  position: absolute;
  top: 0; left: 12%; right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--v2-purple) 50%, transparent);
  box-shadow: 0 0 8px var(--v2-purple);
  opacity: 0.35;
  transition: opacity 0.28s ease;
  pointer-events: none;
}
.circuit-card:hover {
  transform: translateY(-3px);
  border-color: rgba(168, 85, 247, 0.45);
  box-shadow:
    inset 0 1px 0 rgba(168, 85, 247, 0.55),
    0 0 0 1px rgba(168, 85, 247, 0.15),
    0 14px 32px -10px rgba(168, 85, 247, 0.3);
}
.circuit-card:hover::after { opacity: 0.85; }
.circuit-card.on {
  border-color: rgba(168, 85, 247, 0.55);
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.10), rgba(99, 102, 241, 0.04));
  box-shadow:
    inset 0 1px 0 rgba(168, 85, 247, 0.65),
    0 8px 32px -8px rgba(168, 85, 247, 0.45),
    0 0 40px -10px rgba(168, 85, 247, 0.35) !important;
}
.circuit-card.on::after { opacity: 1; }

/* 顶部 */
.card-top { display: flex; align-items: center; gap: var(--v2-sp-3); }
.card-ico {
  width: 44px; height: 44px;
  border-radius: var(--v2-r-md);
  background: var(--v2-purple-soft);
  color: #C084FC;
  display: grid; place-items: center;
  flex-shrink: 0;
  filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.4));
  transition: all 0.22s ease;
}
.circuit-card.on .card-ico {
  background: rgba(168, 85, 247, 0.35);
  color: white;
  filter: drop-shadow(0 0 12px var(--v2-purple));
}
.card-meta { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.card-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--v2-text-1);
  letter-spacing: 0.3px;
}
.card-floor {
  font-size: 11px;
  color: var(--v2-text-2);
  letter-spacing: 0.5px;
}

/* 开关 */
.v2-toggle {
  position: relative;
  width: 46px; height: 26px;
  border-radius: 13px;
  background: var(--v2-surf-2);
  cursor: pointer;
  transition: background 0.22s ease;
  flex-shrink: 0;
  border: none;
  padding: 0;
}
.v2-toggle::after {
  content: '';
  position: absolute;
  top: 2px; left: 2px;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.v2-toggle.on {
  background: linear-gradient(135deg, #6366F1, #A855F7);
  box-shadow:
    0 0 14px rgba(168, 85, 247, 0.6),
    0 0 28px rgba(168, 85, 247, 0.35);
}
.v2-toggle.on::after {
  transform: translateX(20px);
  box-shadow: 0 1px 4px rgba(0,0,0,0.4), 0 0 8px rgba(255, 255, 255, 0.6);
}
.v2-toggle:disabled { opacity: 0.5; cursor: not-allowed; }

/* 4 数据值 */
.metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--v2-sp-2);
  padding: var(--v2-sp-3);
  background: rgba(0, 0, 0, 0.18);
  border-radius: var(--v2-r-md);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.metric { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.metric-label {
  font-size: 10px;
  color: var(--v2-text-3);
  letter-spacing: 1px;
  text-transform: uppercase;
}
.metric-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--v2-text-1);
  letter-spacing: 0.3px;
  line-height: 1.1;
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
}
.circuit-card.on .metric-value .num {
  color: #E9D5FF;
  text-shadow: var(--v2-text-glow-purple);
}
.metric-value .unit {
  font-size: 11px;
  color: var(--v2-text-3);
  font-weight: 500;
  text-shadow: none;
}

/* chip 行 */
.chip-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: var(--v2-sp-2);
  border-top: 1px dashed var(--v2-border-soft);
}
.chip {
  font-size: 10px;
  padding: 3px 9px;
  border-radius: 999px;
  font-family: 'Inter', monospace;
  background: rgba(255, 255, 255, 0.06);
  color: var(--v2-text-2);
  letter-spacing: 0.6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  text-transform: uppercase;
  font-weight: 600;
}
.chip.muted { color: var(--v2-text-3); }
.chip.on {
  background: var(--v2-success-soft);
  color: #6BFFB9;
  border-color: rgba(0, 231, 138, 0.45);
}
.chip.off {
  background: rgba(255, 255, 255, 0.06);
  color: var(--v2-text-3);
}
.chip[data-category="lighting"] { background: rgba(255, 184, 0, 0.20); color: #FCD34D; border-color: rgba(255, 184, 0, 0.45); }
.chip[data-category="socket"]   { background: rgba(0, 229, 255, 0.18); color: #67E8F9; border-color: rgba(0, 229, 255, 0.45); }
.chip[data-category="hvac"]     { background: rgba(91, 143, 255, 0.18); color: #BFD7FF; border-color: rgba(91, 143, 255, 0.45); }
.chip[data-category="led"]      { background: rgba(0, 229, 255, 0.18); color: #67E8F9; border-color: rgba(0, 229, 255, 0.45); }
.chip[data-category="audio"]    { background: rgba(0, 231, 138, 0.18); color: #6EE7B7; border-color: rgba(0, 231, 138, 0.45); }
.chip[data-category="misc"]     { background: rgba(168, 85, 247, 0.20); color: #C084FC; border-color: rgba(168, 85, 247, 0.45); }

/* 状态 */
.state-card {
  padding: var(--v2-sp-5);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--v2-sp-3);
  background: var(--v2-surf-1);
  border: 1px dashed var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  color: var(--v2-text-3);
}
.state-card.error { border-color: rgba(255, 71, 87, 0.3); color: var(--v2-danger); }
.state-title { font-size: 14px; color: var(--v2-text-1); }
.state-sub { font-size: 12px; color: var(--v2-text-3); }
</style>
