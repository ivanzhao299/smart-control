<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  energyService,
  type EnergyAssets,
  type TransformerAsset,
  type BuildingAsset,
  type ElevatorAsset,
} from '@/services/energy.service';
import {
  em123Service,
  chargeModeLabel,
  chargeStatusLabel,
  controlResultLabel,
  type Em123MeterType,
  type Em123TypeSummary,
  type Em123Group,
  type Em123MeterView,
  type Em123ChargeRow,
  type Em123ControlRow,
  type Em123Arrears,
} from '@/services/em123.service';

type TabKey = 'overview' | 'charges' | 'arrears' | 'control' | 'assets';
const tabs: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '水电总览' },
  { key: 'charges', label: '缴费流水' },
  { key: 'arrears', label: '欠费清单' },
  { key: 'control', label: '控制记录' },
  { key: 'assets', label: '园区台账' },
];
const activeTab = ref<TabKey>('overview');

// ---------- 轻提示 ----------
const toast = ref('');
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(msg: string): void {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 2600);
}

// ---------- 格式化 ----------
function fmtMoney(n: unknown): string {
  return Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n: unknown): string {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
}
function todayStr(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ==================== 水电总览 ====================
const overviewType = ref<Em123MeterType>('E');
const treeData = ref<Record<Em123MeterType, Em123TypeSummary | null>>({ E: null, W: null });
const arrearsData = ref<Record<Em123MeterType, Em123Arrears | null>>({ E: null, W: null });
const loadingTree = ref(false);
const todayCharge = reactive<Record<Em123MeterType, { count: number; amount: number }>>({
  E: { count: 0, amount: 0 },
  W: { count: 0, amount: 0 },
});
const expandedGroups = ref<Set<string>>(new Set());
const readoutLoading = ref<Set<string>>(new Set());

const ov = computed(() => treeData.value[overviewType.value]);
const ovArrears = computed(() => arrearsData.value[overviewType.value]);

/** 按分区聚合楼栋（分区→楼栋→逐表）。 */
const zonesView = computed<{ zone: string; groups: Em123Group[] }[]>(() => {
  const s = treeData.value[overviewType.value];
  if (!s) return [];
  const map = new Map<string, Em123Group[]>();
  for (const g of s.groups) {
    const z = g.zone ? `${g.zone}区` : '公寓配套区';
    if (!map.has(z)) map.set(z, []);
    map.get(z)!.push(g);
  }
  return Array.from(map.entries())
    .map(([zone, groups]) => ({ zone, groups }))
    .sort((a, b) => a.zone.localeCompare(b.zone, 'zh-CN'));
});

async function loadTree(type: Em123MeterType): Promise<void> {
  loadingTree.value = true;
  try {
    treeData.value[type] = await em123Service.tree(type);
  } catch (e) {
    showToast(`拉取${type === 'E' ? '电' : '水'}表数据失败：${(e as Error).message}`);
  } finally {
    loadingTree.value = false;
  }
}
async function loadArrears(type: Em123MeterType): Promise<void> {
  try {
    arrearsData.value[type] = await em123Service.arrears(type);
  } catch {
    /* 金额可缺失 */
  }
}
/** 今日缴费（按 priceId 92 电 / 93 水 区分）。 */
async function loadTodayCharge(): Promise<void> {
  try {
    const t = todayStr();
    const r = await em123Service.charges({ beginTime: t, endTime: t, pageSize: 200 });
    const okRows = r.rows.filter((x) => x.chargeStatus === 1);
    const pick = (pid: number) => okRows.filter((x) => Number(x.priceId) === pid);
    const sum = (arr: Em123ChargeRow[]) => arr.reduce((s, x) => s + Number(x.chargeMoney || 0), 0);
    const e = pick(92);
    const w = pick(93);
    todayCharge.E = { count: e.length, amount: sum(e) };
    todayCharge.W = { count: w.length, amount: sum(w) };
  } catch {
    /* 今日缴费可缺失 */
  }
}
function toggleGroup(key: string): void {
  const s = new Set(expandedGroups.value);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  expandedGroups.value = s;
}
async function doReadout(m: Em123MeterView): Promise<void> {
  const ok = window.confirm(
    `对【${m.name}】(表号 ${m.meterNo}) 发起只读召测？\n\n仅请求平台立即抄读一次该表，不改变开关、不充值、不影响任何状态。`,
  );
  if (!ok) return;
  const set = new Set(readoutLoading.value);
  set.add(m.meterNo);
  readoutLoading.value = set;
  try {
    await em123Service.readout(m.meterNo, m.type);
    showToast('召测已发起，稍候片刻后点"刷新"查看最新读数');
  } catch (e) {
    showToast(`召测失败：${(e as Error).message}`);
  } finally {
    const s2 = new Set(readoutLoading.value);
    s2.delete(m.meterNo);
    readoutLoading.value = s2;
  }
}
async function refreshAll(): Promise<void> {
  await Promise.all([loadTree(overviewType.value), loadArrears(overviewType.value), loadTodayCharge()]);
  showToast('已刷新');
}

// ==================== 缴费流水 ====================
const chargePage = ref(1);
const chargePages = ref(1);
const chargeRows = ref<Em123ChargeRow[]>([]);
const chargeTotal = ref(0);
const loadingCharges = ref(false);
const chargeFilter = reactive({ chargeMode: '', chargeStatus: '', meterNo: '', range: '30' });
const chargePageSize = 20;

async function loadCharges(): Promise<void> {
  loadingCharges.value = true;
  try {
    const q: Record<string, string | number> = { pageNum: chargePage.value, pageSize: chargePageSize };
    if (chargeFilter.chargeMode) q.chargeMode = chargeFilter.chargeMode;
    if (chargeFilter.chargeStatus) q.chargeStatus = chargeFilter.chargeStatus;
    if (chargeFilter.meterNo.trim()) q.meterNo = chargeFilter.meterNo.trim();
    if (chargeFilter.range) {
      q.beginTime = daysAgoStr(Number(chargeFilter.range) - 1);
      q.endTime = todayStr();
    }
    const r = await em123Service.charges(q);
    chargeRows.value = r.rows;
    chargeTotal.value = r.total;
    chargePages.value = Math.max(1, Math.ceil(r.total / chargePageSize));
  } catch (e) {
    showToast(`缴费流水查询失败：${(e as Error).message}`);
  } finally {
    loadingCharges.value = false;
  }
}
function applyChargeFilter(): void {
  chargePage.value = 1;
  void loadCharges();
}

// ==================== 欠费清单 ====================
const arrearsType = ref<Em123MeterType>('E');
const arrears = computed(() => arrearsData.value[arrearsType.value]);
async function switchArrearsType(t: Em123MeterType): Promise<void> {
  arrearsType.value = t;
  if (!arrearsData.value[t]) await loadArrears(t);
}

// ==================== 控制记录 ====================
const controlPage = ref(1);
const controlPages = ref(1);
const controlRows = ref<Em123ControlRow[]>([]);
const controlTotal = ref(0);
const loadingControls = ref(false);
const controlFilter = reactive({ controlCode: '', meterNo: '', range: '7' });
const controlPageSize = 20;

async function loadControls(): Promise<void> {
  loadingControls.value = true;
  try {
    const q: Record<string, string | number> = { pageNum: controlPage.value, pageSize: controlPageSize };
    if (controlFilter.controlCode) q.controlCode = controlFilter.controlCode;
    if (controlFilter.meterNo.trim()) q.meterNo = controlFilter.meterNo.trim();
    if (controlFilter.range) {
      q.beginTime = daysAgoStr(Number(controlFilter.range) - 1);
      q.endTime = todayStr();
    }
    const r = await em123Service.controlRecords(q);
    controlRows.value = r.rows;
    controlTotal.value = r.total;
    controlPages.value = Math.max(1, Math.ceil(r.total / controlPageSize));
  } catch (e) {
    showToast(`控制记录查询失败：${(e as Error).message}`);
  } finally {
    loadingControls.value = false;
  }
}
function applyControlFilter(): void {
  controlPage.value = 1;
  void loadControls();
}

// ==================== 导出 ====================
const exporting = ref('');
async function doExport(
  kind: 'meter' | 'charge' | 'usage',
  extra: { meterType?: Em123MeterType; chargeMode?: string; beginTime?: string; endTime?: string } = {},
): Promise<void> {
  exporting.value = `${kind}-${extra.meterType ?? ''}`;
  try {
    await em123Service.exportXlsx(kind, extra);
    showToast('已开始下载 Excel（平台真实数据）');
  } catch (e) {
    showToast(`导出失败：${(e as Error).message}`);
  } finally {
    exporting.value = '';
  }
}
function exportCharge(): void {
  const extra: { chargeMode?: string; beginTime?: string; endTime?: string } = {};
  if (chargeFilter.chargeMode) extra.chargeMode = chargeFilter.chargeMode;
  if (chargeFilter.range) {
    extra.beginTime = daysAgoStr(Number(chargeFilter.range) - 1);
    extra.endTime = todayStr();
  }
  void doExport('charge', extra);
}

// ==================== 园区台账（保留原变压器/楼栋维护，CAS 版本控制） ====================
const ZONE_OPTIONS = [
  { value: 'center', label: '展贸中心' },
  { value: 'phase1', label: '一期·智造区' },
  { value: 'phase2', label: '二期·研发区' },
  { value: 'future', label: '远期·科创区' },
] as const;
const FUNC_OPTIONS = [
  { value: 'exhibition', label: '展贸' },
  { value: 'plant', label: '工业厂房' },
  { value: 'office', label: '研发办公' },
  { value: 'support', label: '配套服务' },
  { value: 'dorm', label: '宿舍公寓' },
] as const;

const assetsLoading = ref(true);
const assetsError = ref<string | null>(null);
const assetsRevision = ref(0);
const assetsDirty = ref(false);
const assetsSaving = ref(false);
const assetsMsg = ref<string | null>(null);
const editTransformers = ref<TransformerAsset[]>([]);
const editBuildings = ref<BuildingAsset[]>([]);
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
    editTransformers.value = doc.value.transformers.map((t) => ({ ...t, feeds: [...t.feeds] }));
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
    assetsMsg.value = `台账已保存（修订版本 r${r.revision}），大屏能源中心已更新。`;
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

function switchTab(k: TabKey): void {
  activeTab.value = k;
  if (k === 'charges' && chargeRows.value.length === 0) void loadCharges();
  if (k === 'control' && controlRows.value.length === 0) void loadControls();
  if (k === 'arrears' && !arrearsData.value[arrearsType.value]) void loadArrears(arrearsType.value);
}

onMounted(() => {
  void loadAssets();
  void loadTree('E');
  void loadTree('W');
  void loadArrears('E');
  void loadArrears('W');
  void loadTodayCharge();
});
</script>

<template>
  <section class="page energy-admin">
    <header class="en-hero">
      <h2>水电管理平台</h2>
    </header>

    <nav class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ active: activeTab === t.key }"
        @click="switchTab(t.key)"
      >
        {{ t.label }}
      </button>
    </nav>

    <!-- ============ 水电总览 ============ -->
    <section v-if="activeTab === 'overview'" class="pane">
      <div class="toolbar">
        <div class="seg">
          <button :class="{ active: overviewType === 'E' }" @click="overviewType = 'E'">电表</button>
          <button :class="{ active: overviewType === 'W' }" @click="overviewType = 'W'">水表</button>
        </div>
        <div class="spacer" />
        <button class="btn ghost" :disabled="loadingTree" @click="refreshAll">刷新</button>
        <button class="btn ghost" :disabled="!!exporting" @click="doExport('meter', { meterType: overviewType })">
          导出表档案
        </button>
      </div>

      <div v-if="ov" class="kpi-grid">
        <div class="kpi">
          <div class="kpi-label">{{ overviewType === 'E' ? '电表' : '水表' }}总数</div>
          <div class="kpi-value">{{ ov.totalMeters }}</div>
          <div class="kpi-foot">总表 {{ ov.masterCount }} · 分户 {{ ov.householdCount }}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">在线 / 离线</div>
          <div class="kpi-value">
            <span class="ok">{{ ov.online }}</span>
            <span class="kpi-sep">/</span>
            <span :class="ov.offline ? 'warn' : 'muted'">{{ ov.offline }}</span>
          </div>
          <div class="kpi-foot">在线率 {{ ov.totalMeters ? Math.round((ov.online / ov.totalMeters) * 100) : 0 }}%</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">欠费户数</div>
          <div class="kpi-value" :class="(ovArrears?.household.count ?? 0) ? 'danger' : 'muted'">
            {{ ovArrears?.household.count ?? '—' }}
          </div>
          <div class="kpi-foot">分户欠费 {{ ovArrears ? Math.abs(ovArrears.household.amount).toFixed(2) : '—' }} 元</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">今日缴费</div>
          <div class="kpi-value">{{ todayCharge[overviewType].count }}<span class="kpi-unit"> 笔</span></div>
          <div class="kpi-foot">{{ fmtMoney(todayCharge[overviewType].amount) }} 元</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">今日用量</div>
          <div class="kpi-value">{{ fmtNum(ov.today) }}</div>
          <div class="kpi-foot">{{ ov.unit }}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">本月用量</div>
          <div class="kpi-value">{{ fmtNum(ov.month) }}</div>
          <div class="kpi-foot">{{ ov.unit }}</div>
        </div>
      </div>
      <div v-else class="empty">{{ loadingTree ? '加载中…' : '暂无数据' }}</div>

      <div v-if="ov && ov.monthDiff" class="compare-note">
        总表本月 {{ fmtNum(ov.master.month) }} {{ ov.unit }}，分户合计 {{ fmtNum(ov.household.month) }}
        {{ ov.unit }}；关口总表还覆盖公区/商业/大棚等未装分户表负荷，差额不等于损耗。
      </div>

      <div v-for="z in zonesView" :key="z.zone" class="zone">
        <div class="zone-title">{{ z.zone }}<span class="zone-count">{{ z.groups.length }} 个楼栋/区域</span></div>
        <div v-for="g in z.groups" :key="g.key" class="group">
          <button class="group-head" @click="toggleGroup(g.key)">
            <div class="gh-main">
              <span class="gh-name">{{ g.name }}</span>
              <span class="gh-tags">
                表 {{ g.meterCount }} · 在线 {{ g.online }}
                <span v-if="g.offline" class="warn">· 离线 {{ g.offline }}</span>
                <span v-if="g.arrears" class="danger">· 欠费 {{ g.arrears }}</span>
              </span>
            </div>
            <div class="gh-stat">本月 {{ fmtNum(g.month) }} {{ ov?.unit }}</div>
            <span class="caret">{{ expandedGroups.has(g.key) ? '▾' : '▸' }}</span>
          </button>
          <div v-if="expandedGroups.has(g.key)" class="meters">
            <div v-for="m in g.meters" :key="m.meterNo" class="meter-row">
              <div class="meter-main">
                <div class="meter-title">
                  <span class="badge" :class="m.kind === 'master' ? 'badge-master' : 'badge-house'">
                    {{ m.kind === 'master' ? '总表' : '分户' }}
                  </span>
                  <span class="meter-name">{{ m.name }}</span>
                  <span v-if="m.cutOff" class="badge badge-cut">已拉闸</span>
                  <span v-if="m.arrears" class="badge badge-arr">欠费</span>
                </div>
                <div class="meter-meta">
                  表号 {{ m.meterNo }} ·
                  <span :class="m.online ? 'ok' : 'warn'">{{ m.online ? '在线' : '离线' }}</span>
                  · 读数时间 {{ m.readingTime || '—' }}
                </div>
                <div v-if="m.modelName" class="meter-meta subtle">型号 {{ m.modelName }} · 倍率 {{ m.multiply }}</div>
              </div>
              <div class="meter-stats">
                <div class="ms-item">
                  <div class="ms-label">余额(元)</div>
                  <div class="ms-value" :class="m.money < 0 ? 'danger' : ''">{{ fmtMoney(m.money) }}</div>
                </div>
                <div class="ms-item">
                  <div class="ms-label">累计读数</div>
                  <div class="ms-value">{{ fmtNum(m.reading) }}</div>
                </div>
                <div class="ms-item">
                  <div class="ms-label">本月</div>
                  <div class="ms-value">{{ fmtNum(m.month) }}</div>
                </div>
                <button class="btn small readout" :disabled="readoutLoading.has(m.meterNo)" @click="doReadout(m)">
                  {{ readoutLoading.has(m.meterNo) ? '召测中…' : '召测' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ 缴费流水 ============ -->
    <section v-if="activeTab === 'charges'" class="pane">
      <div class="filters">
        <select v-model="chargeFilter.chargeMode" @change="applyChargeFilter">
          <option value="">全部方式</option>
          <option value="cash">现金/补量</option>
          <option value="wxpay">微信在线</option>
        </select>
        <select v-model="chargeFilter.chargeStatus" @change="applyChargeFilter">
          <option value="">全部状态</option>
          <option value="1">成功</option>
          <option value="0">失败/未完成</option>
        </select>
        <select v-model="chargeFilter.range" @change="applyChargeFilter">
          <option value="">全部时间</option>
          <option value="7">近 7 天</option>
          <option value="30">近 30 天</option>
          <option value="90">近 90 天</option>
        </select>
        <input v-model="chargeFilter.meterNo" class="input" placeholder="按表号查询" @keyup.enter="applyChargeFilter" />
        <button class="btn ghost" @click="applyChargeFilter">查询</button>
        <div class="spacer" />
        <button class="btn primary" :disabled="!!exporting" @click="exportCharge">导出 Excel</button>
      </div>

      <div class="list-head">共 {{ chargeTotal }} 笔缴费记录</div>
      <div v-if="loadingCharges" class="empty">加载中…</div>
      <div v-else-if="chargeRows.length === 0" class="empty">暂无记录</div>
      <div v-for="r in chargeRows" :key="r.recordId" class="rec-card">
        <div class="rec-top">
          <div class="rec-title">
            {{ r.userName || '—' }}
            <span class="rec-sub">{{ r.houseName }}</span>
          </div>
          <div class="rec-amount" :class="chargeStatusLabel(r.chargeStatus).ok ? '' : 'muted'">
            {{ fmtMoney(r.chargeMoney) }} 元
          </div>
        </div>
        <div class="rec-tags">
          <span class="badge" :class="r.chargeMode === 'wxpay' || r.chargeWay === 'huifupay' ? 'badge-online' : 'badge-cash'">
            {{ chargeModeLabel(r.chargeMode, r.chargeWay) }}
          </span>
          <span class="badge" :class="chargeStatusLabel(r.chargeStatus).ok ? 'badge-ok' : 'badge-fail'">
            {{ chargeStatusLabel(r.chargeStatus).text }}
          </span>
          <span class="rec-time">{{ r.createTime }}</span>
        </div>
        <div class="rec-foot">表号 {{ r.meterNo || '—' }} · 操作员 {{ r.createBy || '—' }}</div>
        <div v-if="r.tradeNo" class="rec-foot subtle">交易号 {{ r.tradeNo }}</div>
      </div>

      <div class="pager">
        <button class="btn ghost" :disabled="chargePage <= 1" @click="chargePage--; loadCharges()">上一页</button>
        <span class="pager-info">第 {{ chargePage }} / {{ chargePages }} 页</span>
        <button class="btn ghost" :disabled="chargePage >= chargePages" @click="chargePage++; loadCharges()">下一页</button>
      </div>
    </section>

    <!-- ============ 欠费清单 ============ -->
    <section v-if="activeTab === 'arrears'" class="pane">
      <div class="toolbar">
        <div class="seg">
          <button :class="{ active: arrearsType === 'E' }" @click="switchArrearsType('E')">电表</button>
          <button :class="{ active: arrearsType === 'W' }" @click="switchArrearsType('W')">水表</button>
        </div>
        <div class="spacer" />
        <button class="btn ghost" @click="loadArrears(arrearsType)">刷新</button>
      </div>

      <div class="arrears-summary">
        <div class="arrears-box">
          <div class="ab-title">分户欠费</div>
          <div class="ab-value danger">{{ arrears?.household.count ?? 0 }} 户</div>
          <div class="ab-foot">合计 {{ Math.abs(arrears?.household.amount ?? 0).toFixed(2) }} 元</div>
        </div>
        <div class="arrears-box">
          <div class="ab-title">关口总表透支</div>
          <div class="ab-value warn">{{ arrears?.master.count ?? 0 }} 块</div>
          <div class="ab-foot">{{ Math.abs(arrears?.master.amount ?? 0).toFixed(2) }} 元</div>
        </div>
      </div>
      <div class="compare-note">
        关口总表为园区内部核算口径，覆盖公区/商业/大棚等未装分户表的负荷，其负余额<b>不属于欠费户</b>，请勿与分户欠费混为一谈；催缴以"分户欠费"清单为准。
      </div>

      <div class="list-head">分户欠费明细（{{ arrears?.household.list.length ?? 0 }}）</div>
      <div v-if="arrears && arrears.household.list.length === 0" class="empty">无分户欠费</div>
      <div v-for="m in arrears?.household.list" :key="m.meterNo" class="rec-card">
        <div class="rec-top">
          <div class="rec-title">{{ m.name }}</div>
          <div class="rec-amount danger">{{ fmtMoney(m.money) }} 元</div>
        </div>
        <div class="rec-foot">表号 {{ m.meterNo }} · 累计 {{ fmtNum(m.reading) }} · 读数时间 {{ m.readingTime || '—' }}</div>
      </div>

      <div class="list-head master-head">关口总表透支明细（{{ arrears?.master.list.length ?? 0 }}）</div>
      <div v-for="m in arrears?.master.list" :key="m.meterNo" class="rec-card subtle-card">
        <div class="rec-top">
          <div class="rec-title">{{ m.name }}</div>
          <div class="rec-amount warn">{{ fmtMoney(m.money) }} 元</div>
        </div>
        <div class="rec-foot">表号 {{ m.meterNo }} · 读数时间 {{ m.readingTime || '—' }}</div>
      </div>
    </section>

    <!-- ============ 控制记录 ============ -->
    <section v-if="activeTab === 'control'" class="pane">
      <div class="filters">
        <select v-model="controlFilter.controlCode" @change="applyControlFilter">
          <option value="">全部类型</option>
          <option value="turn_off">拉闸</option>
          <option value="turn_on">合闸</option>
        </select>
        <select v-model="controlFilter.range" @change="applyControlFilter">
          <option value="7">近 7 天</option>
          <option value="30">近 30 天</option>
          <option value="90">近 90 天</option>
          <option value="">全部时间</option>
        </select>
        <input v-model="controlFilter.meterNo" class="input" placeholder="按表号查询" @keyup.enter="applyControlFilter" />
        <button class="btn ghost" @click="applyControlFilter">查询</button>
      </div>

      <div class="list-head">共 {{ controlTotal }} 条控制记录（仅查看，不提供远程控制）</div>
      <div v-if="loadingControls" class="empty">加载中…</div>
      <div v-else-if="controlRows.length === 0" class="empty">暂无记录</div>
      <div v-for="r in controlRows" :key="r.recordId" class="rec-card">
        <div class="rec-top">
          <div class="rec-title">
            {{ r.houseName || '—' }}
            <span class="rec-sub">{{ r.meterNo }}</span>
          </div>
          <span class="badge" :class="r.controlCode === 'turn_off' ? 'badge-off' : 'badge-on'">
            {{ r.controlName || r.controlCode || '—' }}
          </span>
        </div>
        <div class="rec-tags">
          <span class="badge" :class="controlResultLabel(r.returnFlag).ok ? 'badge-ok' : 'badge-fail'">
            {{ controlResultLabel(r.returnFlag).text }}
          </span>
          <span class="rec-time">{{ r.createTime }}</span>
        </div>
        <div class="rec-foot">来源 {{ r.createBy || '—' }}</div>
      </div>

      <div class="pager">
        <button class="btn ghost" :disabled="controlPage <= 1" @click="controlPage--; loadControls()">上一页</button>
        <span class="pager-info">第 {{ controlPage }} / {{ controlPages }} 页</span>
        <button class="btn ghost" :disabled="controlPage >= controlPages" @click="controlPage++; loadControls()">下一页</button>
      </div>
    </section>

    <!-- ============ 园区台账（原有，保留） ============ -->
    <section v-if="activeTab === 'assets'" class="en-card">
      <div class="en-card-head">
        <h3>园区能源台账 <span class="assets-rev">修订版本 r{{ assetsRevision }}</span></h3>
        <div class="assets-actions">
          <button class="assets-btn" :disabled="assetsSaving" @click="loadAssets">重新加载</button>
          <button class="assets-btn primary" :disabled="!assetsDirty || assetsSaving" @click="saveAssets">
            {{ assetsSaving ? '保存中…' : '保存台账' }}
          </button>
        </div>
      </div>
      <p class="assets-hint">
        变压器、楼栋为规划/台账口径，可直接修改名称、所属分区、容量或建筑面积，保存后大屏能源中心即时更新；接入真实电表后以计量为准。
      </p>

      <div v-if="assetsLoading" class="en-state">台账加载中…</div>
      <div v-else-if="assetsError" class="en-state error">
        {{ assetsError }}
        <button class="en-retry" @click="loadAssets">重试</button>
      </div>
      <div v-else class="assets-grid">
        <div class="assets-col">
          <h4>变压器（{{ editTransformers.length }} 台）</h4>
          <div class="assets-scroll">
            <div v-for="t in editTransformers" :key="t.code" class="asset-row">
              <span class="ar-code">{{ t.code }}</span>
              <input v-model="t.name" @input="markDirty" class="ar-name" placeholder="名称" />
              <select v-model="t.zone" @change="markDirty" class="ar-zone" title="所属分区">
                <option v-for="z in ZONE_OPTIONS" :key="z.value" :value="z.value">{{ z.label }}</option>
              </select>
              <input type="number" v-model.number="t.capacityKva" @input="markDirty" class="ar-num" min="50" step="50" />
              <span class="ar-unit">kVA</span>
            </div>
          </div>
        </div>
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
              <input type="number" v-model.number="b.areaM2" @input="markDirty" class="ar-num" min="50" step="100" />
              <span class="ar-unit">㎡</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="assetsMsg" class="assets-msg ok">{{ assetsMsg }}</div>
    </section>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </section>
</template>

<style scoped>
.energy-admin {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--v2-text-2);
  min-width: 0;
}
.en-hero h2 {
  margin: 0;
  font-size: 20px;
  color: var(--v2-text-1);
}

/* tabs */
.tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
  -webkit-overflow-scrolling: touch;
}
.tab {
  flex: 0 0 auto;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
  color: var(--v2-text-2);
  border-radius: 999px;
  font-size: 14px;
  cursor: pointer;
}
.tab.active {
  background: var(--v2-primary-fill);
  border-color: var(--v2-primary-fill);
  color: var(--v2-on-primary, #fff);
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.toolbar,
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.spacer {
  flex: 1;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md, 10px);
  overflow: hidden;
}
.seg button {
  min-height: 38px;
  padding: 0 18px;
  border: 0;
  background: transparent;
  color: var(--v2-text-2);
  cursor: pointer;
  font-size: 14px;
}
.seg button.active {
  background: var(--v2-primary-fill);
  color: var(--v2-on-primary, #fff);
}

.btn {
  min-height: 40px;
  padding: 0 16px;
  border-radius: var(--v2-r-md, 10px);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
  color: var(--v2-text-2);
  cursor: pointer;
  font-size: 14px;
}
.btn.small {
  min-height: 32px;
  padding: 0 12px;
  font-size: 13px;
}
.btn.primary {
  background: var(--v2-primary-fill);
  border-color: var(--v2-primary-fill);
  color: var(--v2-on-primary, #fff);
}
.btn.ghost {
  background: transparent;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.input,
select {
  min-height: 40px;
  padding: 0 10px;
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md, 10px);
  font-size: 14px;
  background: var(--v2-inset-bg);
  color: var(--v2-text-1);
}

/* KPI */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
@media (min-width: 720px) {
  .kpi-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
.kpi {
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg, 14px);
  padding: 14px;
  background: var(--v2-surf-1);
  box-shadow: var(--v2-elev-1);
}
.kpi-label {
  font-size: 12px;
  color: var(--v2-text-3);
}
.kpi-value {
  font-size: 26px;
  font-weight: 700;
  margin: 4px 0;
  color: var(--v2-text-1);
}
.kpi-unit {
  font-size: 14px;
  font-weight: 500;
  color: var(--v2-text-3);
}
.kpi-sep {
  margin: 0 4px;
  color: var(--v2-text-3);
}
.kpi-foot {
  font-size: 12px;
  color: var(--v2-text-3);
}

.compare-note {
  font-size: 12px;
  color: var(--v2-amber, #b45309);
  background: var(--v2-amber-soft, rgba(245, 158, 11, 0.12));
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md, 10px);
  padding: 10px 12px;
  line-height: 1.6;
}

/* 下钻 */
.zone {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.zone-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--v2-text-1);
  padding-top: 6px;
}
.zone-count {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--v2-text-3);
}
.group {
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg, 14px);
  overflow: hidden;
  background: var(--v2-surf-1);
}
.group-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.gh-main {
  flex: 1;
  min-width: 0;
}
.gh-name {
  display: block;
  font-weight: 600;
  font-size: 14px;
  color: var(--v2-text-1);
}
.gh-tags {
  display: block;
  font-size: 12px;
  color: var(--v2-text-3);
  margin-top: 2px;
}
.gh-stat {
  font-size: 12px;
  color: var(--v2-text-3);
  white-space: nowrap;
}
.caret {
  color: var(--v2-text-3);
}
.meters {
  border-top: 1px solid var(--v2-border-soft);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.meter-row {
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md, 10px);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
@media (min-width: 720px) {
  .meter-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
.meter-main {
  min-width: 0;
  flex: 1;
}
.meter-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.meter-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--v2-text-1);
}
.meter-meta {
  font-size: 12px;
  color: var(--v2-text-3);
  margin-top: 3px;
}
.meter-meta.subtle {
  opacity: 0.85;
}
.meter-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.ms-item {
  min-width: 64px;
}
.ms-label {
  font-size: 11px;
  color: var(--v2-text-3);
}
.ms-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--v2-text-1);
}
.readout {
  white-space: nowrap;
}

/* 徽标 */
.badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-3);
  background: var(--v2-surf-2);
  white-space: nowrap;
}
.badge-master {
  color: var(--v2-info, #2563eb);
  border-color: var(--v2-info-soft, rgba(37, 99, 235, 0.3));
  background: var(--v2-info-soft, rgba(37, 99, 235, 0.12));
}
.badge-house {
  color: var(--v2-success, #10b981);
  border-color: var(--v2-success-soft, rgba(16, 185, 129, 0.3));
  background: var(--v2-success-soft, rgba(16, 185, 129, 0.12));
}
.badge-cut {
  color: var(--v2-amber, #b45309);
  border-color: var(--v2-amber-soft, rgba(245, 158, 11, 0.3));
  background: var(--v2-amber-soft, rgba(245, 158, 11, 0.12));
}
.badge-arr,
.badge-fail,
.badge-off {
  color: var(--v2-danger, #ef4444);
  border-color: var(--v2-danger-soft, rgba(239, 68, 68, 0.3));
  background: var(--v2-danger-soft, rgba(239, 68, 68, 0.12));
}
.badge-ok,
.badge-on {
  color: var(--v2-success, #10b981);
  border-color: var(--v2-success-soft, rgba(16, 185, 129, 0.3));
  background: var(--v2-success-soft, rgba(16, 185, 129, 0.12));
}
.badge-online {
  color: var(--v2-info, #2563eb);
  border-color: var(--v2-info-soft, rgba(37, 99, 235, 0.3));
  background: var(--v2-info-soft, rgba(37, 99, 235, 0.12));
}
.badge-cash {
  color: var(--v2-purple, #7c3aed);
  border-color: var(--v2-purple-soft, rgba(124, 58, 237, 0.3));
  background: var(--v2-purple-soft, rgba(124, 58, 237, 0.12));
}

/* 记录卡片 */
.list-head {
  font-size: 13px;
  font-weight: 600;
  color: var(--v2-text-1);
  padding-top: 4px;
}
.master-head {
  margin-top: 14px;
}
.rec-card {
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg, 14px);
  padding: 12px;
  background: var(--v2-surf-1);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rec-card.subtle-card {
  background: var(--v2-surf-2);
}
.rec-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.rec-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--v2-text-1);
}
.rec-sub {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--v2-text-3);
}
.rec-amount {
  font-size: 17px;
  font-weight: 700;
  white-space: nowrap;
  color: var(--v2-text-1);
}
.rec-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.rec-time {
  font-size: 12px;
  color: var(--v2-text-3);
}
.rec-foot {
  font-size: 12px;
  color: var(--v2-text-3);
}
.rec-foot.subtle {
  word-break: break-all;
}

/* 欠费 */
.arrears-summary {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.arrears-box {
  border-radius: var(--v2-r-lg, 14px);
  padding: 16px;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
}
.ab-title {
  font-size: 13px;
  color: var(--v2-text-3);
}
.ab-value {
  font-size: 28px;
  font-weight: 700;
  margin: 4px 0;
}
.ab-foot {
  font-size: 12px;
  color: var(--v2-text-3);
}

/* 分页 */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 6px 0;
}
.pager-info {
  font-size: 13px;
  color: var(--v2-text-3);
}
.empty {
  color: var(--v2-text-3);
  padding: 24px;
  text-align: center;
  font-size: 14px;
}
.ok {
  color: var(--v2-success, #10b981);
}
.warn {
  color: var(--v2-amber, #b45309);
}
.danger {
  color: var(--v2-danger, #ef4444);
}
.muted {
  color: var(--v2-text-3);
}

/* 园区台账（沿用原样式） */
.en-card {
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg, 14px);
  padding: 16px;
  box-shadow: var(--v2-elev-1);
}
.en-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.en-card-head h3 {
  margin: 0;
  font-size: 15px;
  color: var(--v2-text-1);
}
.assets-rev {
  margin-left: 10px;
  font-size: 12px;
  font-weight: 400;
  color: var(--v2-text-3);
}
.assets-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.assets-btn {
  padding: 7px 14px;
  border-radius: var(--v2-r-md, 9px);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
  color: var(--v2-text-2);
  font-size: 12px;
  cursor: pointer;
}
.assets-btn.primary {
  background: var(--v2-primary-fill);
  color: var(--v2-on-primary, #fff);
  border-color: var(--v2-primary-fill);
}
.assets-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.assets-hint {
  margin: 10px 0 12px;
  font-size: 12px;
  color: var(--v2-text-3);
  line-height: 1.6;
}
.assets-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
  gap: 16px;
}
.assets-col h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--v2-text-1);
}
.assets-scroll {
  max-height: 340px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}
.asset-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ar-code {
  width: 40px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--v2-text-3);
  font-variant-numeric: tabular-nums;
}
.ar-name {
  flex: 1.4;
  min-width: 0;
  padding: 6px 8px;
  border-radius: var(--v2-r-sm, 8px);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-inset-bg);
  color: var(--v2-text-1);
  font-size: 12px;
}
.ar-zone,
.ar-func {
  flex: 1;
  min-width: 0;
  padding: 6px 4px;
  border-radius: var(--v2-r-sm, 8px);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-inset-bg);
  color: var(--v2-text-2);
  font-size: 11px;
}
.ar-num {
  width: 64px;
  flex-shrink: 0;
  padding: 6px;
  border-radius: var(--v2-r-sm, 8px);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-inset-bg);
  color: var(--v2-text-1);
  font-size: 12px;
}
.ar-unit {
  font-size: 10px;
  color: var(--v2-text-3);
  flex-shrink: 0;
}
.assets-msg {
  margin-top: 10px;
  font-size: 12px;
  padding: 8px 12px;
  border-radius: var(--v2-r-md, 9px);
}
.assets-msg.ok {
  background: var(--v2-success-soft, rgba(52, 211, 153, 0.15));
  color: var(--v2-success, #34d399);
}
.en-state {
  padding: 36px;
  text-align: center;
  color: var(--v2-text-3);
}
.en-state.error {
  color: var(--v2-danger, #f87171);
}
.en-retry {
  display: block;
  margin: 12px auto 0;
  padding: 8px 18px;
  border-radius: var(--v2-r-md, 9px);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
  color: var(--v2-text-1);
  cursor: pointer;
}

/* toast */
.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  background: rgba(17, 24, 39, 0.92);
  color: #fff;
  padding: 10px 18px;
  border-radius: 999px;
  font-size: 13px;
  max-width: 90vw;
  z-index: 999;
}

@media (max-width: 860px) {
  .assets-grid {
    grid-template-columns: 1fr;
  }
}
</style>
