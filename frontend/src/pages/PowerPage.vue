<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, Zap, Power, X, RefreshCw, Activity, Gauge, Lightbulb, Plug,
  MonitorPlay, Snowflake, Volume2, ChevronDown, Thermometer, Droplet,
  AlertTriangle, ShieldCheck,
} from 'lucide-vue-next';
import {
  powerCircuitsService,
  type PowerCircuitView,
  type BreakerMeasurements,
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
  const want = op === 'on';
  const prevOn = c.reading.on;
  // 乐观: 立即翻转 on (UI 即变), 后台异步下发; 成功用真实读数替换, 失败回滚
  const idx0 = circuits.value.findIndex((x) => x.id === c.id);
  if (idx0 >= 0) circuits.value[idx0] = { ...c, reading: { ...c.reading, on: want } };
  busyIds.value.add(c.id);
  try {
    const updated = want
      ? await powerCircuitsService.on(c.id)
      : await powerCircuitsService.off(c.id);
    const idx = circuits.value.findIndex((x) => x.id === c.id);
    if (idx >= 0) circuits.value[idx] = updated;
  } catch (err) {
    const idx = circuits.value.findIndex((x) => x.id === c.id);
    if (idx >= 0) circuits.value[idx] = { ...circuits.value[idx], reading: { ...circuits.value[idx].reading, on: prevOn } };
    ElMessage.error(`${c.name} ${want ? '通电' : '断电'}失败: ${(err as Error).message}`);
  } finally {
    busyIds.value.delete(c.id);
  }
}

// 空开专属详情 (三相分相 + 温度 + 漏电 + 报警) — 只对 isBreaker 回路, 点开才拉
const expandedId = ref<number | null>(null);
const breakerDetail = ref<Record<number, BreakerMeasurements>>({});
const breakerLoading = ref<Set<number>>(new Set());

async function toggleBreaker(c: PowerCircuitView): Promise<void> {
  if (expandedId.value === c.id) { expandedId.value = null; return; }
  expandedId.value = c.id;
  if (!breakerDetail.value[c.id]) await loadBreaker(c.id);
}

async function loadBreaker(id: number): Promise<void> {
  breakerLoading.value.add(id);
  try {
    breakerDetail.value[id] = await powerCircuitsService.breaker(id);
  } catch (err) {
    ElMessage.error(`读空开详情失败: ${(err as Error).message}`);
  } finally {
    breakerLoading.value.delete(id);
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
      // 展开着的空开详情也顺带刷新 (三相/温度实时变化)
      if (expandedId.value != null) void loadBreaker(expandedId.value);
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
        :class="{ on: c.reading.on, breaker: c.isBreaker }"
      >
        <!-- 顶部 -->
        <div class="card-top">
          <div class="card-ico"><component :is="iconFor(c.icon)" :size="22" :stroke-width="1.8" /></div>
          <div class="card-meta">
            <div class="card-name">
              {{ c.name }}
              <span v-if="c.isBreaker" class="breaker-badge" title="智能断路器 · 远程物理总闸">总闸</span>
            </div>
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
          <span v-if="c.isBreaker" class="chip muted">485 空开</span>
          <span v-else-if="c.relayChannel != null" class="chip muted">CH {{ c.relayChannel }}</span>
          <span class="chip" :class="c.reading.on ? 'on' : 'off'">
            {{ c.reading.on ? '通电' : '断电' }}
          </span>
          <button
            v-if="c.isBreaker"
            class="detail-toggle"
            :class="{ open: expandedId === c.id }"
            @click="toggleBreaker(c)"
            :title="expandedId === c.id ? '收起空开详情' : '展开空开详情'"
          >
            详情 <ChevronDown :size="13" :stroke-width="2.2" />
          </button>
        </div>

        <!-- 空开专属详情: 三相分相 + 温度 + 漏电 + 报警 -->
        <div v-if="c.isBreaker && expandedId === c.id" class="breaker-detail">
          <div v-if="breakerLoading.has(c.id) && !breakerDetail[c.id]" class="bd-loading">
            <RefreshCw :size="14" class="spin" /> 读取中…
          </div>
          <template v-else-if="breakerDetail[c.id]">
            <!-- 报警条 -->
            <div
              class="bd-alarm"
              :class="breakerDetail[c.id].alarms.any ? 'bad' : 'ok'"
            >
              <component :is="breakerDetail[c.id].alarms.any ? AlertTriangle : ShieldCheck" :size="14" :stroke-width="2" />
              {{ breakerDetail[c.id].alarms.any ? '有电气报警 — 请检查' : '无电气报警' }}
            </div>

            <!-- 三相分相表 -->
            <table class="bd-phase">
              <thead>
                <tr><th></th><th>A 相</th><th>B 相</th><th>C 相</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td class="bd-rk">电压 V</td>
                  <td v-for="(v, i) in breakerDetail[c.id].voltages" :key="'v' + i" class="v2-inter">{{ v.toFixed(1) }}</td>
                </tr>
                <tr>
                  <td class="bd-rk">电流 A</td>
                  <td v-for="(a, i) in breakerDetail[c.id].currents" :key="'a' + i" class="v2-inter">{{ a.toFixed(2) }}</td>
                </tr>
              </tbody>
            </table>

            <!-- 温度 + 漏电 + PF/频率 -->
            <div class="bd-row">
              <div class="bd-item"><Thermometer :size="13" :stroke-width="2" /> 接线柱
                <span class="v2-inter">{{ breakerDetail[c.id].temperatures.map((t) => t.toFixed(0)).join(' / ') }}</span> ℃
              </div>
              <div class="bd-item" :class="{ warn: breakerDetail[c.id].leakageCurrent > 0.03 }">
                <Droplet :size="13" :stroke-width="2" /> 漏电
                <span class="v2-inter">{{ (breakerDetail[c.id].leakageCurrent * 1000).toFixed(0) }}</span> mA
              </div>
              <div class="bd-item"><Gauge :size="13" :stroke-width="2" /> PF
                <span class="v2-inter">{{ breakerDetail[c.id].powerFactor.toFixed(2) }}</span>
              </div>
              <div class="bd-item"><Activity :size="13" :stroke-width="2" /> 频率
                <span class="v2-inter">{{ breakerDetail[c.id].frequency }}</span> Hz
              </div>
            </div>
          </template>
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
  color: var(--v2-text-2);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
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
  border-color: var(--v2-border-soft);
}
.v2-quick.primary {
  background: var(--v2-purple-soft);
  color: var(--v2-text-2);
  border-color: var(--v2-border-soft);
}
.v2-quick.danger {
  background: var(--v2-danger-soft);
  color: #EC8880;
  border-color: rgba(229, 100, 93, 0.45);
}
.v2-quick:disabled { opacity: 0.4; cursor: not-allowed; }

/* ============ 总览 ============ */
.v2-overview {
  display: flex; align-items: center;
  padding: 8px var(--v2-sp-3);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.01));
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
}
.ov-item {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: var(--v2-sp-3);
  padding: 0 var(--v2-sp-4);
  position: relative;
}
.ov-item:not(:first-child)::before {
  content: ''; position: absolute; left: 0; top: 50%;
  transform: translateY(-50%);
  width: 1px; height: 28px;
  background: var(--v2-border-soft);
}
.ov-ico {
  width: 32px; height: 32px;
  border-radius: var(--v2-r-sm);
  background: var(--v2-purple-soft);
  color: var(--v2-text-2);
  display: grid; place-items: center;
  flex-shrink: 0;
  filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.08));
}
.ov-body { display: flex; flex-direction: column; min-width: 0; }
.ov-label { font-size: var(--v2-fs-xs); color: var(--v2-text-2); letter-spacing: 1px; text-transform: uppercase; }
.ov-value {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.1;
  margin-top: 1px;
  color: #E9D5FF;
  text-shadow: var(--v2-text-glow-purple);
  letter-spacing: 0.5px;
}
.ov-value .unit { font-size: 11px; color: var(--v2-text-3); margin-left: 4px; font-weight: 500; text-shadow: none; }

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
  border-color: var(--v2-border-soft);
  box-shadow:
    inset 0 1px 0 var(--v2-card-hairline),
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 14px 32px -10px rgba(255, 255, 255, 0.08);
}
.circuit-card:hover::after { opacity: 0.85; }
.circuit-card.on {
  border-color: var(--v2-border-soft);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.04));
  box-shadow:
    inset 0 1px 0 var(--v2-card-hairline),
    0 8px 32px -8px rgba(255, 255, 255, 0.08),
    0 0 40px -10px rgba(255, 255, 255, 0.08) !important;
}
.circuit-card.on::after { opacity: 1; }

/* 顶部 */
.card-top { display: flex; align-items: center; gap: var(--v2-sp-3); }
.card-ico {
  width: 44px; height: 44px;
  border-radius: var(--v2-r-md);
  background: var(--v2-purple-soft);
  color: var(--v2-text-2);
  display: grid; place-items: center;
  flex-shrink: 0;
  filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.08));
  transition: all 0.22s ease;
}
.circuit-card.on .card-ico {
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
  filter: none;
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
  background: linear-gradient(135deg, #9BA1A9, #9BA1A9);
  box-shadow:
    0 0 14px rgba(255, 255, 255, 0.08),
    0 0 28px rgba(255, 255, 255, 0.08);
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
  background: var(--v2-inset-bg);
  border-radius: var(--v2-r-md);
  border: 1px solid var(--v2-border-soft);
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
  background: var(--v2-ov-1);
  color: var(--v2-text-2);
  letter-spacing: 0.6px;
  border: 1px solid var(--v2-border-soft);
  text-transform: uppercase;
  font-weight: 600;
}
.chip.muted { color: var(--v2-text-3); }
.chip.on {
  background: var(--v2-success-soft);
  color: #6BFFB9;
  border-color: rgba(63, 191, 135, 0.45);
}
.chip.off {
  background: var(--v2-ov-1);
  color: var(--v2-text-3);
}
.chip[data-category="lighting"] { background: rgba(224, 160, 48, 0.20); color: #FCD34D; border-color: rgba(224, 160, 48, 0.45); }
.chip[data-category="socket"]   { background: rgba(76, 154, 255, 0.18); color: #67E8F9; border-color: rgba(76, 154, 255, 0.45); }
.chip[data-category="hvac"]     { background: rgba(76, 154, 255, 0.18); color: #BFD7FF; border-color: rgba(76, 154, 255, 0.45); }
.chip[data-category="led"]      { background: rgba(76, 154, 255, 0.18); color: #67E8F9; border-color: rgba(76, 154, 255, 0.45); }
.chip[data-category="audio"]    { background: rgba(63, 191, 135, 0.18); color: #5FCB9B; border-color: rgba(63, 191, 135, 0.45); }
.chip[data-category="misc"]     { background: var(--v2-ov-2); color: #9BA1A9; border-color: var(--v2-border-soft); }

/* ============ 空开专属: 总闸标记 + 详情面板 ============ */
.circuit-card.breaker { border-color: var(--v2-warning-soft); }
.breaker-badge {
  display: inline-block;
  vertical-align: middle;
  margin-left: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--v2-warning-soft);
  color: var(--v2-warning);
  border: 1px solid var(--v2-warning-soft);
}
.detail-toggle {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.4px;
  padding: 2px 8px;
  border-radius: 999px;
  cursor: pointer;
  background: var(--v2-surf-1);
  color: var(--v2-text-2);
  border: 1px solid var(--v2-border-soft);
  transition: background 0.15s, color 0.15s;
}
.detail-toggle:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.detail-toggle svg { transition: transform 0.2s; }
.detail-toggle.open svg { transform: rotate(180deg); }

.breaker-detail {
  margin-top: var(--v2-sp-2);
  padding-top: var(--v2-sp-3);
  border-top: 1px dashed var(--v2-border-soft);
  display: flex;
  flex-direction: column;
  gap: var(--v2-sp-3);
}
.bd-loading {
  display: flex; align-items: center; gap: 6px;
  font-size: var(--v2-fs-sm); color: var(--v2-text-3);
}
.spin { animation: bd-spin 0.9s linear infinite; }
@keyframes bd-spin { to { transform: rotate(360deg); } }

.bd-alarm {
  display: flex; align-items: center; gap: 6px;
  font-size: var(--v2-fs-sm); font-weight: 600;
  padding: 5px 10px; border-radius: var(--v2-r-sm);
}
.bd-alarm.ok  { background: var(--v2-success-soft); color: var(--v2-success, #3FBF87); }
.bd-alarm.bad { background: var(--v2-danger-soft);  color: var(--v2-danger, #E5645D); }

.bd-phase { width: 100%; border-collapse: collapse; font-size: 12px; }
.bd-phase th, .bd-phase td {
  text-align: right; padding: 3px 6px;
  border-bottom: 1px solid var(--v2-border-soft);
}
.bd-phase th { color: var(--v2-text-3); font-weight: 600; font-size: 10px; text-transform: uppercase; }
.bd-phase td { color: var(--v2-text-1); }
.bd-phase .bd-rk { text-align: left; color: var(--v2-text-3); }

.bd-row { display: flex; flex-wrap: wrap; gap: var(--v2-sp-2) var(--v2-sp-4); }
.bd-item {
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--v2-text-2);
}
.bd-item .v2-inter { color: var(--v2-text-1); font-weight: 600; }
.bd-item.warn, .bd-item.warn .v2-inter { color: var(--v2-warning); }

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
.state-card.error { border-color: rgba(229, 100, 93, 0.3); color: var(--v2-danger); }
.state-title { font-size: 14px; color: var(--v2-text-1); }
.state-sub { font-size: 12px; color: var(--v2-text-3); }
</style>
