<template>
  <section class="page energy-admin">
    <header class="en-hero">
      <div>
        <h2>能源管理</h2>
        <p>云断路器用电量取自华普云平台电表，系统每小时自动同步；其余回路按瞬时功率积分估算。数据按日聚合，可汇总园区总用电、趋势与电费。</p>
      </div>
    </header>

    <!-- 园区能源台账维护 -->
    <section class="en-card assets-card">
      <div class="en-card-head">
        <h3>园区能源台账</h3>
        <div class="assets-actions">
          <span class="assets-rev">修订版本 r{{ assetsRevision }}</span>
          <button class="assets-btn" @click="loadAssets" :disabled="assetsSaving">重新加载</button>
          <button
            class="assets-btn primary"
            @click="saveAssets"
            :disabled="!assetsDirty || assetsSaving"
          >{{ assetsSaving ? '保存中…' : '保存台账' }}</button>
        </div>
      </div>
      <p class="assets-hint">
        变压器、楼栋为规划/台账口径，可直接修改名称、所属分区、容量或建筑面积，保存后大屏能源中心与下方统计即时更新；接入真实电表后以计量为准。
      </p>

      <div v-if="assetsLoading" class="en-state">台账加载中…</div>
      <div v-else-if="assetsError" class="en-state error">
        {{ assetsError }}
        <button class="en-retry" @click="loadAssets">重试</button>
      </div>
      <div v-else class="assets-grid">
        <!-- 变压器 -->
        <div class="assets-col">
          <h4>变压器（{{ editTransformers.length }} 台）</h4>
          <div class="assets-scroll">
            <div v-for="t in editTransformers" :key="t.code" class="asset-row">
              <span class="ar-code">{{ t.code }}</span>
              <input v-model="t.name" @input="markDirty" class="ar-name" placeholder="名称" />
              <select v-model="t.zone" @change="markDirty" class="ar-zone" title="所属分区">
                <option v-for="z in ZONE_OPTIONS" :key="z.value" :value="z.value">{{ z.label }}</option>
              </select>
              <input
                type="number" v-model.number="t.capacityKva" @input="markDirty"
                class="ar-num" min="50" step="50"
              />
              <span class="ar-unit">kVA</span>
            </div>
          </div>
        </div>
        <!-- 楼栋 -->
        <div class="assets-col">
          <h4>楼栋（{{ editBuildings.length }} 栋）</h4>
          <div class="assets-scroll">
            <div v-for="b in editBuildings" :key="b.code" class="asset-row">
              <span class="ar-code">{{ b.code }}</span>
              <input v-model="b.name" @input="markDirty" class="ar-name" placeholder="名称" />
              <select v-model="b.zone" @change="markDirty" class="ar-zone" title="所属分区">
                <option v-for="z in ZONE_OPTIONS" :key="z.value" :value="z.value">{{ z.label }}</option>
              </select>
              <select v-model="b.function" @change="markDirty" class="ar-func" title="功能类型">
                <option v-for="f in FUNC_OPTIONS" :key="f.value" :value="f.value">{{ f.label }}</option>
              </select>
              <input
                type="number" v-model.number="b.areaM2" @input="markDirty"
                class="ar-num" min="50" step="100"
              />
              <span class="ar-unit">㎡</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="assetsMsg" class="assets-msg ok">{{ assetsMsg }}</div>
    </section>

    <div v-if="loading" class="en-state">正在加载能源数据…</div>
    <div v-else-if="error" class="en-state error">{{ error }}<button class="en-retry" @click="load">重试</button></div>

    <template v-else-if="ov">
      <!-- KPI -->
      <section class="en-kpis">
        <div class="kpi"><span class="kpi-label">累计用电</span><span class="kpi-value">{{ fmt(ov.totalKwh) }}<em>kWh</em></span></div>
        <div class="kpi"><span class="kpi-label">今日用电</span><span class="kpi-value">{{ fmt(ov.todayKwh) }}<em>kWh</em></span><span class="kpi-sub">昨日 {{ fmt(ov.yesterdayKwh) }}</span></div>
        <div class="kpi"><span class="kpi-label">本月用电</span><span class="kpi-value">{{ fmt(ov.monthKwh) }}<em>kWh</em></span></div>
        <div class="kpi"><span class="kpi-label">今日电费</span><span class="kpi-value">¥{{ fmt(ov.todayCost) }}</span><span class="kpi-sub">电价 ¥{{ ov.pricePerKwh }}/kWh</span></div>
        <div class="kpi"><span class="kpi-label">累计电费</span><span class="kpi-value">¥{{ fmt(ov.totalCost) }}</span></div>
        <div class="kpi"><span class="kpi-label">峰值功率</span><span class="kpi-value">{{ fmt(ov.peakPowerW) }}<em>W</em></span><span class="kpi-sub">{{ ov.circuitCount }} 个回路</span></div>
      </section>

      <!-- 趋势 -->
      <section class="en-card">
        <div class="en-card-head">
          <h3>用电趋势</h3>
          <div class="en-range">
            <button :class="{ on: mode === 'day' && days === 7 }" @click="setRange('day', 7)">近7天</button>
            <button :class="{ on: mode === 'day' && days === 30 }" @click="setRange('day', 30)">近30天</button>
            <button :class="{ on: mode === 'day' && days === 90 }" @click="setRange('day', 90)">近90天</button>
            <button :class="{ on: mode === 'month' }" @click="setRange('month', 365)">按月</button>
          </div>
        </div>
        <svg class="en-bars" viewBox="0 0 720 260" preserveAspectRatio="none" role="img">
          <!-- 网格 -->
          <g>
            <line v-for="g in gridLines" :key="'l'+g.v" :x1="padL" :x2="width-padR" :y1="g.y" :y2="g.y" class="grid" />
            <text v-for="g in gridLines" :key="'t'+g.v" :x="padL-8" :y="g.y+4" class="axis-y" text-anchor="end">{{ g.label }}</text>
          </g>
          <!-- 柱 -->
          <g>
            <rect
              v-for="(p, i) in trend" :key="p.label"
              :x="barX(i)" :y="barY(p.kwh)" :width="barW" :height="barH(p.kwh)"
              rx="3" class="bar"
            ><title>{{ p.label }}：{{ fmt(p.kwh) }} kWh</title></rect>
          </g>
          <!-- x 标签 -->
          <g>
            <text v-for="p in xLabelIndexes" :key="'x'+p.label" :x="barX(p.i)+barW/2" :y="height-8" class="axis-x" text-anchor="middle">{{ shortLabel(p.label) }}</text>
          </g>
        </svg>
      </section>

      <!-- 占比 + 排行 -->
      <section class="en-card">
        <h3>回路用电占比（{{ days === 365 ? '近一年' : `近${days}天` }}）</h3>
        <div v-if="donut.segments.length" class="en-donut-wrap">
          <div class="donut-box">
            <svg viewBox="0 0 200 200" class="donut">
              <circle cx="100" cy="100" :r="r" class="donut-track" fill="none" />
              <g transform="rotate(-90 100 100)">
                <circle
                  v-for="s in donut.segments" :key="s.code"
                  cx="100" cy="100" :r="r" fill="none"
                  :stroke="s.color" stroke-width="22"
                  :stroke-dasharray="`${s.dash} ${C - s.dash}`"
                  :stroke-dashoffset="-s.offset"
                ><title>{{ s.name }}：{{ fmt(s.kwh) }} kWh（{{ s.pct }}%）</title></circle>
              </g>
            </svg>
            <div class="donut-center"><strong>{{ fmt(donut.total) }}</strong><span>kWh</span></div>
          </div>
          <ul class="donut-legend">
            <li v-for="s in donut.segments" :key="s.code">
              <i :style="{ background: s.color }"></i>
              <span class="lg-name">{{ s.name }}</span>
              <span class="lg-pct">{{ s.pct }}%</span>
              <span class="lg-kwh">{{ fmt(s.kwh) }} kWh</span>
            </li>
          </ul>
        </div>
        <div v-else class="en-state">所选区间暂无用电数据</div>

        <table class="en-table">
          <thead><tr><th>回路</th><th>数据来源</th><th class="r">峰值 (W)</th><th class="r">用电量 (kWh)</th></tr></thead>
          <tbody>
            <tr v-for="b in breakdown" :key="b.code">
              <td class="l">{{ b.name }}</td>
              <td><span class="src" :class="b.source">{{ sourceLabel(b.source) }}</span></td>
              <td class="r">{{ fmt(b.peakPowerW) }}</td>
              <td class="r strong">{{ fmt(b.kwh) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  energyService,
  type EnergyOverview,
  type EnergyPoint,
  type EnergyBreakdownItem,
  type EnergyAssets,
  type TransformerAsset,
  type BuildingAsset,
  type ElevatorAsset,
} from '@/services/energy.service';

const loading = ref(true);
const error = ref<string | null>(null);
const ov = ref<EnergyOverview | null>(null);
const trend = ref<EnergyPoint[]>([]);
const breakdown = ref<EnergyBreakdownItem[]>([]);
const mode = ref<'day' | 'month'>('day');
const days = ref(30);

// 柱状图几何
const width = 720;
const height = 260;
const padL = 44;
const padR = 14;
const padT = 14;
const padB = 26;
const plotW = width - padL - padR;
const plotH = height - padT - padB;

const maxKwh = computed(() => Math.max(1, ...trend.value.map((p) => p.kwh)));
const n = computed(() => trend.value.length);
const slot = computed(() => plotW / Math.max(1, n.value));
const barW = computed(() => Math.min(30, Math.max(2, slot.value * 0.62)));
function barX(i: number): number {
  return padL + i * slot.value + (slot.value - barW.value) / 2;
}
function barH(v: number): number {
  return (v / maxKwh.value) * plotH;
}
function barY(v: number): number {
  return padT + plotH - barH(v);
}
const gridLines = computed(() => {
  const steps = 4;
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const frac = i / steps;
    out.push({
      v: frac,
      y: padT + plotH - frac * plotH,
      label: Number((frac * maxKwh.value).toFixed(1)),
    });
  }
  return out;
});
const labelEvery = computed(() => Math.max(1, Math.ceil(n.value / 10)));
// x 轴稀疏标签，保留真实索引以便定位
const xLabelIndexes = computed(() =>
  trend.value.map((p, i) => ({ ...p, i })).filter((p) => p.i % labelEvery.value === 0),
);
function shortLabel(label: string): string {
  // 日 YYYY-MM-DD → MM-DD；月 YYYY-MM 保留
  return label.length === 10 ? label.slice(5) : label;
}

// 环形图
const r = 70;
const C = 2 * Math.PI * r;
const COLORS = ['#6366f1', '#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb7185', '#4ade80'];
const donut = computed(() => {
  const top = breakdown.value.slice(0, 7);
  const total = breakdown.value.reduce((s, b) => s + b.kwh, 0);
  let cum = 0;
  const segments = top.map((b, i) => {
    const frac = total > 0 ? b.kwh / total : 0;
    const seg = {
      code: b.code,
      name: b.name,
      color: COLORS[i % COLORS.length],
      kwh: b.kwh,
      pct: Number((frac * 100).toFixed(1)),
      dash: frac * C,
      offset: cum,
    };
    cum += frac * C;
    return seg;
  });
  return { segments, total };
});

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return v >= 100 ? v.toFixed(0) : String(Number(v.toFixed(2)));
}
function sourceLabel(s: string): string {
  if (s === 'cloud') return '平台电表';
  if (s === 'integral') return '功率积分';
  return '无数据';
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [o, t, b] = await Promise.all([
      energyService.overview(),
      energyService.trend(mode.value, days.value),
      energyService.breakdown(mode.value === 'month' ? 365 : days.value),
    ]);
    ov.value = o;
    trend.value = t;
    breakdown.value = b;
  } catch (e) {
    error.value = `加载失败：${(e as Error).message}`;
  } finally {
    loading.value = false;
  }
}

async function setRange(m: 'day' | 'month', d: number): Promise<void> {
  mode.value = m;
  days.value = d;
  await load();
}

// ============ 园区能源台账维护 ============
const ZONE_OPTIONS = [
  { value: 'center', label: '展贸中心' },
  { value: 'phase1', label: '一期·智造区' },
  { value: 'phase2', label: '二期·研发区' },
  { value: 'future', label: '远期·科创区' },
];
const FUNC_OPTIONS = [
  { value: 'exhibition', label: '展贸' },
  { value: 'plant', label: '工业厂房' },
  { value: 'office', label: '研发办公' },
  { value: 'support', label: '配套服务' },
  { value: 'dorm', label: '宿舍公寓' },
];

const assetsLoading = ref(true);
const assetsError = ref<string | null>(null);
const assetsRevision = ref(0);
const assetsDirty = ref(false);
const assetsSaving = ref(false);
const assetsMsg = ref<string | null>(null);
const editTransformers = ref<TransformerAsset[]>([]);
const editBuildings = ref<BuildingAsset[]>([]);
// 电梯不在本界面编辑，保存时原样带回，避免被清空。
const keepElevators = ref<ElevatorAsset[]>([]);

function markDirty(): void {
  assetsDirty.value = true;
  assetsMsg.value = null;
  assetsError.value = null;
}

async function loadAssets(): Promise<void> {
  assetsLoading.value = true;
  assetsError.value = null;
  try {
    const doc = await energyService.getAssets();
    assetsRevision.value = doc.revision;
    editTransformers.value = doc.value.transformers.map((t) => ({
      ...t,
      feeds: [...t.feeds],
    }));
    editBuildings.value = doc.value.buildings.map((b) => ({ ...b }));
    keepElevators.value = doc.value.elevators.map((e) => ({ ...e }));
    assetsDirty.value = false;
  } catch (e) {
    assetsError.value = `台账加载失败：${(e as Error).message}`;
  } finally {
    assetsLoading.value = false;
  }
}

async function saveAssets(): Promise<void> {
  assetsSaving.value = true;
  assetsMsg.value = null;
  assetsError.value = null;
  try {
    const payload: EnergyAssets = {
      transformers: editTransformers.value,
      buildings: editBuildings.value,
      elevators: keepElevators.value,
    };
    const r = await energyService.saveAssets(payload, assetsRevision.value);
    assetsRevision.value = r.revision;
    assetsDirty.value = false;
    assetsMsg.value = `台账已保存（修订版本 r${r.revision}），下方统计已刷新。`;
    await load(); // 模型口径变化，刷新 KPI/趋势/占比
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 409) {
      assetsError.value =
        '台账已被他人修改（版本冲突）。请点击「重新加载」获取最新版本后再编辑，避免覆盖他人数据。';
    } else {
      assetsError.value = `保存失败：${(e as Error).message}`;
    }
  } finally {
    assetsSaving.value = false;
  }
}

onMounted(() => {
  void load();
  void loadAssets();
});
</script>

<style scoped>
.energy-admin { display: flex; flex-direction: column; gap: 16px; color: var(--v2-text-2); min-width: 0; }
.en-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.en-hero h2 { margin: 0 0 8px; font-size: 20px; color: var(--v2-text-1); }
.en-hero p { margin: 0; font-size: 13px; line-height: 1.65; color: var(--v2-text-3); max-width: 720px; }
.en-state { padding: 36px; text-align: center; color: var(--v2-text-3); }
.en-state.error { color: var(--v2-danger, #f87171); }
.en-retry { display: block; margin: 12px auto 0; padding: 8px 18px; border-radius: 9px; border: 1px solid var(--v2-border-soft); background: var(--v2-surf-1); color: var(--v2-text-1); cursor: pointer; }

.en-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.kpi { display: flex; flex-direction: column; gap: 4px; padding: 13px 14px; background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); border-radius: 13px; box-shadow: var(--v2-elev-1); min-width: 0; }
.kpi-label { font-size: 12px; color: var(--v2-text-3); }
.kpi-value { font-size: 22px; font-weight: 700; color: var(--v2-text-1); font-variant-numeric: tabular-nums; }
.kpi-value em { font-size: 12px; font-weight: 500; color: var(--v2-text-3); margin-left: 3px; font-style: normal; }
.kpi-sub { font-size: 11px; color: var(--v2-text-3); }

.en-card { background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); border-radius: 14px; padding: 16px; box-shadow: var(--v2-elev-1); }
.en-card h3 { margin: 0 0 14px; font-size: 15px; color: var(--v2-text-1); }
.en-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.en-card-head h3 { margin: 0; }
.en-range { display: inline-flex; gap: 4px; background: var(--v2-inset-bg); padding: 3px; border-radius: 9px; border: 1px solid var(--v2-border-soft); }
.en-range button { padding: 6px 12px; border: none; background: transparent; color: var(--v2-text-3); font-size: 12px; border-radius: 7px; cursor: pointer; }
.en-range button.on { background: var(--v2-primary); color: #fff; }

/* 园区能源台账维护 */
.assets-actions { display: inline-flex; align-items: center; gap: 8px; }
.assets-rev { font-size: 12px; color: var(--v2-text-3); font-variant-numeric: tabular-nums; }
.assets-btn { padding: 7px 14px; border-radius: 9px; border: 1px solid var(--v2-border-soft); background: var(--v2-surf-1); color: var(--v2-text-2); font-size: 12px; cursor: pointer; }
.assets-btn.primary { background: var(--v2-primary); color: #fff; border-color: var(--v2-primary); }
.assets-btn:disabled { opacity: .5; cursor: not-allowed; }
.assets-hint { margin: 10px 0 12px; font-size: 12px; color: var(--v2-text-3); line-height: 1.6; }
.assets-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.35fr); gap: 16px; }
.assets-col h4 { margin: 0 0 8px; font-size: 13px; color: var(--v2-text-1); }
.assets-scroll { max-height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; }
.asset-row { display: flex; align-items: center; gap: 6px; }
.ar-code { width: 40px; flex-shrink: 0; font-size: 11px; color: var(--v2-text-3); font-variant-numeric: tabular-nums; }
.ar-name { flex: 1.4; min-width: 0; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--v2-border-soft); background: var(--v2-inset-bg); color: var(--v2-text-1); font-size: 12px; }
.ar-zone, .ar-func { flex: 1; min-width: 0; padding: 6px 4px; border-radius: 8px; border: 1px solid var(--v2-border-soft); background: var(--v2-inset-bg); color: var(--v2-text-2); font-size: 11px; }
.ar-num { width: 64px; flex-shrink: 0; padding: 6px 6px; border-radius: 8px; border: 1px solid var(--v2-border-soft); background: var(--v2-inset-bg); color: var(--v2-text-1); font-size: 12px; }
.ar-unit { font-size: 10px; color: var(--v2-text-3); flex-shrink: 0; }
.assets-msg { margin-top: 10px; font-size: 12px; padding: 8px 12px; border-radius: 9px; }
.assets-msg.ok { background: var(--v2-success-soft, rgba(52,211,153,.15)); color: var(--v2-success, #34d399); }

.en-bars { width: 100%; height: 260px; display: block; }
.grid { stroke: var(--v2-border-soft); stroke-width: 1; }
.axis-y { fill: var(--v2-text-3); font-size: 11px; }
.axis-x { fill: var(--v2-text-3); font-size: 10px; }
.bar { fill: var(--v2-primary); opacity: .9; }
.bar:hover { opacity: 1; }

.en-donut-wrap { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }
.donut-box { position: relative; width: 180px; height: 180px; flex-shrink: 0; }
.donut { width: 180px; height: 180px; }
.donut-track { stroke: var(--v2-border-soft); stroke-width: 22; }
.donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
.donut-center strong { font-size: 24px; color: var(--v2-text-1); font-variant-numeric: tabular-nums; }
.donut-center span { font-size: 11px; color: var(--v2-text-3); }
.donut-legend { list-style: none; margin: 0; padding: 0; flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 7px; }
.donut-legend li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.donut-legend i { width: 11px; height: 11px; border-radius: 3px; flex-shrink: 0; }
.lg-name { color: var(--v2-text-2); flex: 1; min-width: 0; }
.lg-pct { color: var(--v2-text-3); width: 48px; text-align: right; }
.lg-kwh { color: var(--v2-text-1); width: 92px; text-align: right; font-variant-numeric: tabular-nums; }

.en-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.en-table th { text-align: left; color: var(--v2-text-3); font-weight: 600; padding: 8px 10px; border-top: 1px solid var(--v2-border-soft); }
.en-table td { padding: 9px 10px; border-top: 1px solid var(--v2-border-soft); color: var(--v2-text-2); }
.en-table .r { text-align: right; font-variant-numeric: tabular-nums; }
.en-table .l { color: var(--v2-text-1); }
.en-table .strong { font-weight: 700; color: var(--v2-text-1); }
.src { padding: 2px 9px; border-radius: 20px; font-size: 11px; }
.src.cloud { background: var(--v2-success-soft, rgba(52,211,153,.15)); color: var(--v2-success, #34d399); }
.src.integral { background: var(--v2-primary-soft); color: var(--v2-primary); }

@media (max-width: 860px) {
  .assets-grid { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .en-hero { flex-direction: column; }
  .kpi-value { font-size: 19px; }
}
</style>
