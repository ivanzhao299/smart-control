<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import { ArrowLeft, Lightbulb, Power, X, Sparkles, Layers, RefreshCw } from 'lucide-vue-next';
import { lightingService } from '@/services/lighting.service';
import { lightZonesService, type LightZoneView } from '@/services/light-zones.service';

interface ZoneRow {
  id: number;
  code: string;
  name: string;
  floor: string;
  /** DALI 组号 (1-16), 只在网关上是 group, 在 UI 里只做副标题展示 */
  daliGroup: number;
  /** 关联的网关 code, 用于显示 */
  gatewayDisplayName: string;
  brightness: number;
  on: boolean;
  busy: boolean;
  error: string | null;
}

// ============ 数据源 — Sprint E (2026-05-31): 从 /api/light-zones 拉, 不再硬编码 ============
const zones = ref<ZoneRow[]>([]);
const loading = ref<boolean>(false);
const loadError = ref<string | null>(null);

async function loadZones(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const list = await lightZonesService.list();
    zones.value = list.map((z: LightZoneView): ZoneRow => ({
      id: z.id,
      code: z.code,
      name: z.name,
      floor: z.floor,
      daliGroup: z.daliGroup,
      gatewayDisplayName: z.gatewayDisplayName,
      brightness: 80,        // 后端没存运行时亮度, 默认 80, 用户操作后更新
      on: false,             // 默认关 — 不再硬编码"假装亮着"
      busy: false,
      error: null,
    }));
    // 初次进页面默认 1F tab; 若 1F 没数据自动切到第一个有数据的楼层
    const floors = floorOptions.value;
    if (!floors.includes(floorTab.value) && floors.length > 0) {
      floorTab.value = floors[0];
    }
  } catch (err) {
    loadError.value = (err as Error).message;
    ElMessage.error(`加载灯光分区失败: ${loadError.value}`);
  } finally {
    loading.value = false;
  }
}

// ============ 楼层 Tab ============
const floorTab = ref<string>('1F');
const floorOptions = computed<string[]>(() => {
  const set = new Set<string>();
  for (const z of zones.value) set.add(z.floor);
  // 按字母升序 ('1F', '2F', '3F'... 'all' 单独追加)
  return Array.from(set).sort();
});
const filteredZones = computed(() => {
  if (floorTab.value === 'all') return zones.value;
  return zones.value.filter((z) => z.floor === floorTab.value);
});

onMounted(() => { void loadZones(); });

// ============ 总览 ============
const overview = computed(() => {
  const total = zones.value.length;
  const onCount = zones.value.filter((z) => z.on).length;
  const avgBri = onCount === 0 ? 0 : Math.round(
    zones.value.filter((z) => z.on).reduce((s, z) => s + z.brightness, 0) / onCount,
  );
  // 涉及的 gateway 个数 (作为"驱动器/网关"统计的替代)
  const gateways = new Set(zones.value.map((z) => z.gatewayDisplayName));
  return { total, onCount, avgBri, gatewayCount: gateways.size };
});

// ============ 操作 ============
async function toggleZone(z: ZoneRow): Promise<void> {
  z.busy = true; z.error = null;
  try {
    if (z.on) {
      const res = await lightingService.zoneOff(z.id);
      if (!res.ok) throw new Error(res.error || '执行失败');
      z.on = false;
    } else {
      const res = await lightingService.zoneOn(z.id);
      if (!res.ok) throw new Error(res.error || '执行失败');
      z.on = true;
      if (z.brightness === 0) z.brightness = 80;
    }
  } catch (err) {
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} 操作失败: ${z.error}`);
  } finally { z.busy = false; }
}

async function applyBrightness(z: ZoneRow, value: number): Promise<void> {
  z.brightness = value;
  z.busy = true; z.error = null;
  try {
    const res = await lightingService.setBrightness(z.id, value);
    if (!res.ok) throw new Error(res.error || '执行失败');
    z.on = value > 0;
  } catch (err) {
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} 亮度调节失败: ${z.error}`);
  } finally { z.busy = false; }
}

// 滑条交互 — 拖动时即时更新, 鼠标抬起才调 API
function onSliderInput(z: ZoneRow, ev: Event): void {
  const v = Number((ev.target as HTMLInputElement).value);
  z.brightness = v;
}
function onSliderChange(z: ZoneRow, ev: Event): void {
  const v = Number((ev.target as HTMLInputElement).value);
  void applyBrightness(z, v);
}

// ============ 预设 ============
const PRESETS = [
  { label: '关', value: 0 },
  { label: '低', value: 30 },
  { label: '中', value: 60 },
  { label: '高', value: 90 },
];
function applyPreset(z: ZoneRow, value: number): void {
  void applyBrightness(z, value);
}

// ============ 全部开/关 ============
// 注意 1: 不要看本地 z.on 状态判断要不要发! z.on 是页面打开时的初始值, 跟现场
//         灯真实状态没关系. DALI 命令幂等, 全部一律发就完了.
// 注意 2: "全部开/全部关" 操作 **所有** zone, 不分楼层 — 操作员预期的是
//         "整馆全开/全关", 不是 "当前看的 tab 的 zone 全开/全关".
//         如果只想控当前楼层, 用下面的 floorOn / floorOff.
async function dispatchMany(targets: ZoneRow[], op: 'on' | 'off'): Promise<void> {
  let okCount = 0;
  let failCount = 0;
  let mockCount = 0;
  for (const z of targets) {
    z.busy = true; z.error = null;
    try {
      const res = op === 'on'
        ? await lightingService.zoneOn(z.id)
        : await lightingService.zoneOff(z.id);
      if (!res.ok) throw new Error(res.error || '执行失败');
      okCount += 1;
      if (res.mock) mockCount += 1;
      if (op === 'on') {
        z.on = true;
        if (z.brightness === 0) z.brightness = 80;
      } else {
        z.on = false;
      }
    } catch (err) {
      failCount += 1;
      z.error = (err as Error).message;
      ElMessage.error(`${z.name} ${op === 'on' ? '开启' : '关闭'}失败: ${z.error}`);
    } finally { z.busy = false; }
  }
  // 全 mock → 用户看到"成功 toast"但灯没动, 必须高亮警告
  if (mockCount > 0 && mockCount === okCount) {
    ElMessage.warning(
      `命令成功送出, 但后端在 MOCK 模式 (${mockCount}/${targets.length} 区), 灯不会真的动. ` +
      `去 GK9000 后端 .env 改 MOCK_MODE=false 并重启 pm2.`,
    );
  } else if (failCount === 0 && okCount > 0) {
    ElMessage.success(`${okCount} 区命令已送出. 若灯未动, 到后台 → 灯光分区 → 测试 看细节.`);
  }
}

async function allOn(): Promise<void> {
  ElMessage.info(`全部开启 — 逐区下发 (${zones.value.length} 区, 跨所有楼层)`);
  await dispatchMany(zones.value, 'on');
}
async function allOff(): Promise<void> {
  ElMessage.warning(`全部关闭 — 逐区下发 (${zones.value.length} 区, 跨所有楼层)`);
  await dispatchMany(zones.value, 'off');
}
async function floorOn(): Promise<void> {
  ElMessage.info(`${floorTab.value} 全开 — 逐区下发 (${filteredZones.value.length} 区)`);
  await dispatchMany(filteredZones.value, 'on');
}
async function floorOff(): Promise<void> {
  ElMessage.warning(`${floorTab.value} 全关 — 逐区下发 (${filteredZones.value.length} 区)`);
  await dispatchMany(filteredZones.value, 'off');
}

const router = useRouter();
function goBack(): void { router.push({ name: 'dashboard' }); }
function gotoScene(): void { router.push({ name: 'dashboard' }); }
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
          <div class="title"><Lightbulb :size="18" :stroke-width="1.8" /> 灯光控制</div>
          <div class="sub">{{ overview.total }} 个分区 · {{ overview.gatewayCount }} 个 DALI 网关</div>
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
        <button class="v2-quick" @click="loadZones" :disabled="loading" title="重新加载分区列表">
          <RefreshCw :size="14" :stroke-width="2" />
        </button>
        <button
          v-if="floorTab !== 'all'"
          class="v2-quick"
          @click="floorOn"
          :disabled="loading || filteredZones.length === 0"
          :title="`只开当前 ${floorTab} 楼层 (${filteredZones.length} 区)`"
        >
          <Power :size="14" :stroke-width="2" /> {{ floorTab }} 开
        </button>
        <button
          v-if="floorTab !== 'all'"
          class="v2-quick"
          @click="floorOff"
          :disabled="loading || filteredZones.length === 0"
          :title="`只关当前 ${floorTab} 楼层 (${filteredZones.length} 区)`"
        >
          <X :size="14" :stroke-width="2" /> {{ floorTab }} 关
        </button>
        <button class="v2-quick primary" @click="allOn" :disabled="loading || zones.length === 0" title="整馆全开 (跨所有楼层)">
          <Power :size="14" :stroke-width="2" /> 全部开
        </button>
        <button class="v2-quick danger" @click="allOff" :disabled="loading || zones.length === 0" title="整馆全关 (跨所有楼层)">
          <X :size="14" :stroke-width="2" /> 全部关
        </button>
        <button class="v2-quick" @click="gotoScene">
          <Sparkles :size="14" :stroke-width="2" /> 调用场景
        </button>
      </div>
    </header>

    <!-- 总览条 -->
    <div class="v2-overview">
      <div class="ov-item">
        <div class="ov-ico"><Lightbulb :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">在线分区</div>
          <div class="ov-value v2-inter">{{ overview.onCount }}<span class="unit">/ {{ overview.total }}</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Sparkles :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">平均亮度</div>
          <div class="ov-value v2-inter">{{ overview.avgBri }}<span class="unit">%</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Layers :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">DALI 网关</div>
          <div class="ov-value v2-inter">{{ overview.gatewayCount }}<span class="unit"> 台</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Power :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">网关状态</div>
          <div class="ov-value v2-inter" style="color: var(--v2-success); font-size: 16px;">在线</div>
        </div>
      </div>
    </div>

    <!-- 加载 / 错误 / 空态 -->
    <div v-if="loading && zones.length === 0" class="state-card">
      <Lightbulb :size="32" :stroke-width="1.5" />
      <div class="state-title">加载灯光分区中…</div>
    </div>
    <div v-else-if="loadError" class="state-card error">
      <X :size="32" :stroke-width="2" />
      <div class="state-title">加载失败</div>
      <div class="state-sub">{{ loadError }}</div>
      <button class="v2-quick primary" @click="loadZones"><RefreshCw :size="14" :stroke-width="2" /> 重试</button>
    </div>
    <div v-else-if="zones.length === 0" class="state-card">
      <Lightbulb :size="32" :stroke-width="1.5" />
      <div class="state-title">还没有配置灯光分区</div>
      <div class="state-sub">到 后台 → 灯光分区管理 添加</div>
    </div>
    <div v-else-if="filteredZones.length === 0" class="state-card">
      <Lightbulb :size="32" :stroke-width="1.5" />
      <div class="state-title">{{ floorTab }} 楼层没有分区</div>
      <div class="state-sub">切换到其他楼层 tab, 或在后台添加</div>
    </div>

    <!-- 区卡网格 -->
    <div v-else class="v2-zone-grid">
      <div
        v-for="z in filteredZones"
        :key="z.id"
        class="v2-zone"
        :class="{ on: z.on, off: !z.on, offline: !!z.error }"
      >
        <div class="zone-top">
          <div class="zone-meta">
            <div class="zone-name">{{ z.name }}</div>
            <!-- 业主不看 gateway/group 这种调试信息, 只显示楼层. 调试详情在后台 → 灯光分区. -->
            <div class="zone-addr">{{ z.floor }}</div>
          </div>
          <button
            class="v2-toggle"
            :class="{ on: z.on }"
            :disabled="z.busy"
            @click="toggleZone(z)"
            :title="z.on ? '关闭' : '开启'"
          ></button>
        </div>

        <div class="brightness">
          <div class="bri-label">
            <span class="bri-name">亮度</span>
            <span class="bri-value v2-inter">{{ z.brightness }}<span class="pct">%</span></span>
          </div>
          <div class="slider-wrap">
            <div class="slider">
              <div class="slider-fill" :style="{ width: z.brightness + '%' }"></div>
            </div>
            <input
              type="range"
              :value="z.brightness"
              :min="0"
              :max="100"
              :step="5"
              :disabled="z.busy || !z.on"
              class="slider-input"
              @input="onSliderInput(z, $event)"
              @change="onSliderChange(z, $event)"
            />
          </div>
        </div>

        <div class="preset-row">
          <button
            v-for="p in PRESETS"
            :key="p.value"
            class="preset"
            :class="{ active: z.on && z.brightness === p.value }"
            :disabled="z.busy"
            @click="applyPreset(z, p.value)"
          >{{ p.label }}</button>
        </div>

        <div v-if="z.error" class="zone-err">{{ z.error }}</div>
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

/* ============ Page head ============ */
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
  color: var(--v2-text-3);
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
  transition: all 0.18s ease;
}
.v2-tab.active {
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
  box-shadow: 0 0 0 1px rgba(6, 182, 212, 0.2);
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
.v2-quick:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.v2-quick.primary {
  background: var(--v2-amber-soft);
  color: var(--v2-amber);
  border-color: rgba(245, 158, 11, 0.3);
}
.v2-quick.danger {
  background: rgba(239, 68, 68, 0.1);
  color: var(--v2-danger);
  border-color: rgba(239, 68, 68, 0.3);
}

/* ============ 总览 ============ */
.v2-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--v2-sp-3);
  padding: var(--v2-sp-4);
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.05), rgba(251, 191, 36, 0.01));
  border: 1px solid rgba(251, 191, 36, 0.12);
  border-radius: var(--v2-r-lg);
}
.ov-item { display: flex; align-items: center; gap: var(--v2-sp-3); }
.ov-ico {
  width: 40px; height: 40px;
  border-radius: var(--v2-r-sm);
  background: var(--v2-amber-soft);
  color: var(--v2-amber);
  display: grid; place-items: center;
  flex-shrink: 0;
}
.ov-body { display: flex; flex-direction: column; min-width: 0; }
.ov-label { font-size: var(--v2-fs-xs); color: var(--v2-text-3); letter-spacing: 1px; }
.ov-value {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.1;
  margin-top: 2px;
  color: var(--v2-text-1);
}
.ov-value .unit { font-size: 12px; color: var(--v2-text-3); margin-left: 2px; font-weight: 400; }

/* ============ 区卡 ============ */
.v2-zone-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--v2-sp-3);
}
@media (max-width: 1280px) { .v2-zone-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 900px)  { .v2-zone-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px)  {
  .v2-zone-grid { grid-template-columns: 1fr; }
  .v2-page { padding: var(--v2-sp-3); gap: var(--v2-sp-3); }
  .v2-zone { padding: var(--v2-sp-3); }
  .bri-value { font-size: 22px; }
  /* 滑条触控区加大: 14px → 18px, 拇指更容易精准 */
  .slider { height: 18px; }
  .slider-input { min-height: 32px; }
  .v2-toggle { width: 48px; height: 28px; }
  .v2-toggle::after { width: 24px; height: 24px; }
  .v2-toggle.on::after { transform: translateX(20px); }
  /* 顶部 quick-actions 横向滚动避免溢出 */
  .quick-actions { flex-wrap: wrap; }
}

.v2-zone {
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
/* 顶部 1px 琥珀色发光光带 — 默认弱, on 时强 */
.v2-zone::after {
  content: '';
  position: absolute;
  top: 0; left: 12%; right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--v2-amber) 50%, transparent);
  box-shadow: 0 0 6px var(--v2-amber);
  opacity: 0.35;
  pointer-events: none;
  transition: opacity 0.28s ease;
}
.v2-zone::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 0%, var(--zone-glow, transparent), transparent 65%);
  opacity: 0;
  transition: opacity 0.32s ease;
  pointer-events: none;
}
.v2-zone:hover {
  transform: translateY(-3px);
  border-color: rgba(255, 184, 0, 0.45);
  box-shadow:
    inset 0 1px 0 rgba(255, 184, 0, 0.5),
    0 0 0 1px rgba(255, 184, 0, 0.15),
    0 14px 32px -10px rgba(255, 184, 0, 0.25);
}
.v2-zone:hover::after { opacity: 0.8; }
.v2-zone.on {
  --zone-glow: rgba(255, 184, 0, 0.35);
  border-color: rgba(255, 184, 0, 0.55);
  background: linear-gradient(135deg, rgba(255, 184, 0, 0.10), rgba(255, 100, 0, 0.04));
  box-shadow:
    inset 0 1px 0 rgba(255, 184, 0, 0.65),
    0 8px 32px -8px rgba(255, 184, 0, 0.45),
    0 0 40px -10px rgba(255, 184, 0, 0.35) !important;
}
.v2-zone.on::before { opacity: 1; }
.v2-zone.on::after { opacity: 1; }
.v2-zone.offline { opacity: 0.5; }
.v2-zone.offline::after {
  content: '故障';
  position: absolute;
  top: var(--v2-sp-3); right: var(--v2-sp-3);
  font-size: 10px;
  padding: 3px 10px;
  background: var(--v2-danger-soft);
  color: var(--v2-danger);
  border: 1px solid var(--v2-danger);
  border-radius: 999px;
  letter-spacing: 0.5px;
  font-weight: 600;
  box-shadow: 0 0 12px rgba(255, 71, 87, 0.35);
}

.zone-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.zone-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.zone-name {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--v2-text-1);
}
.zone-addr {
  font-size: 11px;
  color: var(--v2-text-2);
  letter-spacing: 1.2px;
  font-weight: 500;
}

/* 开关 toggle */
.v2-toggle {
  position: relative;
  width: 42px; height: 24px;
  border-radius: 12px;
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
  width: 20px; height: 20px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.v2-toggle.on {
  background: linear-gradient(135deg, #FF8800, #FFB800);
  box-shadow:
    0 0 14px rgba(255, 184, 0, 0.6),
    0 0 28px rgba(255, 184, 0, 0.35);
}
.v2-toggle.on::after {
  background: white;
  box-shadow:
    0 1px 4px rgba(0,0,0,0.4),
    0 0 8px rgba(255, 255, 255, 0.6);
}
.v2-toggle.on::after { transform: translateX(18px); }
.v2-toggle:disabled { opacity: 0.5; cursor: not-allowed; }

/* 亮度 + slider */
.brightness {
  display: flex;
  flex-direction: column;
  gap: var(--v2-sp-2);
}
.bri-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.bri-name {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-3);
  letter-spacing: 0.5px;
}
.bri-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--v2-text-1);
  letter-spacing: 0.5px;
}
.v2-zone.on .bri-value {
  color: #FFD060;
  text-shadow: var(--v2-text-glow-amber);
}
.bri-value .pct { font-size: 13px; color: var(--v2-text-3); margin-left: 3px; font-weight: 500; text-shadow: none; }

.slider-wrap { position: relative; }
.slider {
  position: relative;
  height: 14px;
  background: var(--v2-surf-2);
  border-radius: 7px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.slider-fill {
  height: 100%;
  background: linear-gradient(90deg, #FF8800 0%, #FFB800 50%, #FFD060 100%);
  border-radius: 7px;
  box-shadow:
    0 0 16px rgba(255, 184, 0, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.v2-zone.off .slider-fill { background: var(--v2-surf-2); box-shadow: none; }
.v2-zone.off .bri-value { color: var(--v2-text-3); }
.slider-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.slider-input:disabled { cursor: not-allowed; }

/* 预设按钮 */
.preset-row {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
.preset {
  flex: 1;
  padding: 8px 0;
  border-radius: 6px;
  font-size: var(--v2-fs-xs);
  background: var(--v2-surf-2);
  color: var(--v2-text-2);
  text-align: center;
  cursor: pointer;
  transition: all 0.18s ease;
  border: 1px solid transparent;
  min-height: 32px;
}
.preset:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.preset.active {
  background: var(--v2-amber-soft);
  color: var(--v2-amber);
  border-color: rgba(245, 158, 11, 0.3);
}
.preset:disabled { opacity: 0.4; cursor: not-allowed; }

/* 单 zone 错误提示 */
.zone-err {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 11px;
  background: rgba(239, 68, 68, 0.12);
  color: var(--v2-danger);
  border: 1px solid rgba(239, 68, 68, 0.25);
  word-break: break-all;
}

/* 加载 / 错误 / 空态 */
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
.state-card.error { border-color: rgba(239, 68, 68, 0.3); color: var(--v2-danger); }
.state-title { font-size: 14px; color: var(--v2-text-1); }
.state-sub { font-size: 12px; color: var(--v2-text-3); }
</style>
