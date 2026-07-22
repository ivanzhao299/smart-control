<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import { ArrowLeft, Lightbulb, Power, X, Sparkles, Layers, RefreshCw, GripVertical, Pencil, FolderPlus, Search } from 'lucide-vue-next';
import { lightingService } from '@/services/lighting.service';
import { api } from '@/services/http';
import {
  lightZonesService,
  type LightZoneView,
} from '@/services/light-zones.service';

/**
 * 2026-07-21: 硬件组编排退役 (见 refactor 6989cf1)。分区成员统一为"单灯"(在单灯页按盏分配),
 * 分区控制走单灯优先。灯光页只保留分区本身 (改名/排序/新建) + 分区控制。
 */
interface ZoneRow {
  id: number;
  code: string;
  name: string;
  floor: string;
  /** 老硬件组数 —— 现场还有靠硬件组工作的分区, 单灯没分进来时用它兜底显示/控制 */
  groupCount: number;
  brightness: number;
  on: boolean;
  busy: boolean;
  error: string | null;
}

// ============ 数据源: 分区列表 + 每区单灯计数 (成员归属在单灯页管理) ============
interface DaliLightLite { zoneCode: string | null }
const zones = ref<ZoneRow[]>([]);
const lightCountByZone = ref<Map<string, number>>(new Map());
const totalLights = ref<number>(0);
const loading = ref<boolean>(false);
const loadError = ref<string | null>(null);

async function loadZones(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    // 分区列表 + 单灯 (只用来统计每区几盏灯; 成员的增删在单灯页做)
    const [list, lights] = await Promise.all([
      lightZonesService.list(),
      api.get<DaliLightLite[]>('/dali-lights').catch(() => [] as DaliLightLite[]),
    ]);
    const counts = new Map<string, number>();
    for (const l of lights) if (l.zoneCode) counts.set(l.zoneCode, (counts.get(l.zoneCode) ?? 0) + 1);
    lightCountByZone.value = counts;
    totalLights.value = lights.length;
    zones.value = list.map((z: LightZoneView): ZoneRow => ({
      id: z.id,
      code: z.code,
      name: z.name,
      floor: z.floor,
      groupCount: z.groups?.length ?? 0,
      brightness: 80,        // 后端没存运行时亮度, 默认 80, 用户操作后更新
      on: false,             // 默认关 — 不再硬编码"假装亮着"
      busy: false,
      error: null,
    }));
  } catch (err) {
    loadError.value = (err as Error).message;
    ElMessage.error(`加载灯光分区失败: ${loadError.value}`);
  } finally {
    loading.value = false;
  }
}

onMounted(() => { void loadZones(); });

// 全馆只有一层, 不再做楼层 tab (业主: "去除所有二层的信息, 只保留一层").
// filteredZones 保留是为了下面 dispatchMany / 模板不用改口径.
const filteredZones = computed(() => zones.value);

/** 某分区里的单灯数 (成员在单灯页管) */
function zoneLightCount(code: string): number {
  return lightCountByZone.value.get(code) ?? 0;
}
/** 分区成员摘要 —— 单灯优先; 单灯没分进来就报老硬件组数 (现场很多分区还靠组工作, 别误报"暂无灯") */
function zoneMemberLabel(z: ZoneRow): string {
  const n = zoneLightCount(z.code);
  if (n > 0) return `${n} 盏灯`;
  if (z.groupCount > 0) return `${z.groupCount} 组灯 (硬件组)`;
  return '暂无灯 (去单灯页分配)';
}

// ============ 总览 ============
const overview = computed(() => {
  const total = zones.value.length;
  const onCount = zones.value.filter((z) => z.on).length;
  const avgBri = onCount === 0 ? 0 : Math.round(
    zones.value.filter((z) => z.on).reduce((s, z) => s + z.brightness, 0) / onCount,
  );
  return { total, onCount, avgBri, lights: totalLights.value };
});

// ============ 分区管理模式 (原"编组"; 硬件组编排已退役, 见 refactor 6989cf1) ============
// 分区成员统一在"单灯调试"页按盏分配; 这个模式只留分区本身的管理: 新建 / 改名 / 拖动排序。
const grouping = ref<boolean>(false);

// ============ 新建分区 (业主: "灯光分组应该和空调分组一样, 可以新建分组") ============
// 跟空调 createZone 一个交互: 弹框输名字即可, code 前端自动生成 (业主不需要懂 code)。
// 后端 POST /light-zones 早就支持, 之前前端只在空状态写了"到后台加" —— 那是死路,
// 现在编组面板和空状态都能直接建。建完是空分区, 切"编组"把灯组放进去。
async function createLightZone(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('新建灯光分区', '新建分区', {
      inputPlaceholder: '例如: 会议室 / 前厅 / 走廊',
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    });
    const name = String(value).trim();
    await lightZonesService.create({ code: `lz-${Date.now()}`, name, floor: '1F' });
    await loadZones();
    ElMessage.success(`已新建分区「${name}」, 去「单灯调试」页把灯分进来`);
  } catch (err) {
    if (err === 'cancel' || err === 'close') return;
    ElMessage.error('新建分区失败: ' + (err as Error).message);
  }
}

// ============ 分区改名 (就地编辑, 不弹窗) ============
const editingZone = ref<number | null>(null);
const editingText = ref('');
function startRenameZone(z: ZoneRow): void {
  editingZone.value = z.id;
  editingText.value = z.name;
}
async function commitRenameZone(z: ZoneRow): Promise<void> {
  const name = editingText.value.trim();
  editingZone.value = null;
  if (!name || name === z.name) return;
  try {
    await lightZonesService.update(z.id, { name });
    z.name = name;                    // 乐观: 立刻显示, 不等重拉
    ElMessage.success(`已改名为「${name}」`);
  } catch (err) {
    ElMessage.error(`改名失败: ${(err as Error).message}`);
    await loadZones();                // 失败就以后端为准, 不留假名字
  }
}

// ============ 拖拽排序 ============
// 用原生 HTML5 drag & drop, 不引第三方库 —— 这点需求不值得再加一个依赖。
// 顺序**存后端** (见 service 里的说明): 现场多终端, 存前端等于没排。
const dragZoneId = ref<number | null>(null);
const dragOverZoneId = ref<number | null>(null);

function onZoneDragStart(z: ZoneRow, ev: DragEvent): void {
  dragZoneId.value = z.id;
  ev.dataTransfer?.setData('text/plain', String(z.id));  // Firefox 不设这个不触发 drop
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
}
function onZoneDragOver(z: ZoneRow, ev: DragEvent): void {
  if (dragZoneId.value === null || dragZoneId.value === z.id) return;
  ev.preventDefault();                                    // 不 preventDefault 就不允许 drop
  dragOverZoneId.value = z.id;
}
async function onZoneDrop(target: ZoneRow): Promise<void> {
  const from = dragZoneId.value;
  dragZoneId.value = null;
  dragOverZoneId.value = null;
  if (from === null || from === target.id) return;

  const list = zones.value.slice();
  const fi = list.findIndex((z) => z.id === from);
  const ti = list.findIndex((z) => z.id === target.id);
  if (fi < 0 || ti < 0) return;
  const [moved] = list.splice(fi, 1);
  list.splice(ti, 0, moved);
  const before = zones.value;
  zones.value = list;                                     // 乐观: 松手立刻就位, 不等网络
  try {
    await lightZonesService.reorderZones(list.map((z) => z.id));
  } catch (err) {
    zones.value = before;                                 // 失败回滚, 不留一个后端不认的假顺序
    ElMessage.error(`排序保存失败: ${(err as Error).message}`);
  }
}
function onZoneDragEnd(): void {
  dragZoneId.value = null;
  dragOverZoneId.value = null;
}

// ============ 操作 ============
async function toggleZone(z: ZoneRow): Promise<void> {
  // 乐观更新: 点击瞬间翻转 UI, 后台异步下发 DALI, 失败回滚. 消除"等硬件下发"的迟缓感.
  const prevOn = z.on;
  const prevBri = z.brightness;
  z.on = !z.on;
  if (z.on && z.brightness === 0) z.brightness = 80;
  z.error = null;
  try {
    const res = z.on ? await lightingService.zoneOn(z.id) : await lightingService.zoneOff(z.id);
    if (!res.ok) throw new Error(res.error || '执行失败');
  } catch (err) {
    z.on = prevOn; z.brightness = prevBri;       // 回滚
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} 操作失败: ${z.error}`);
  }
}

async function applyBrightness(z: ZoneRow, value: number): Promise<void> {
  // 乐观: 滑条/预设值立即生效, 后台异步下发, 失败回滚
  const prevOn = z.on;
  z.brightness = value;
  z.on = value > 0;
  z.error = null;
  try {
    const res = await lightingService.setBrightness(z.id, value);
    if (!res.ok) throw new Error(res.error || '执行失败');
  } catch (err) {
    z.on = prevOn;
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} 亮度调节失败: ${z.error}`);
  }
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
// 注意 2: "全部开/全部关" 操作 **所有** zone — 全馆只有一层, 操作员预期就是整馆.
async function dispatchMany(targets: ZoneRow[], op: 'on' | 'off'): Promise<void> {
  // 乐观: 先把目标区 UI 立即切到目标态, 再逐区异步下发硬件, 个别失败再回滚那一区
  const want = op === 'on';
  for (const z of targets) {
    z.error = null;
    z.on = want;
    if (want && z.brightness === 0) z.brightness = 80;
  }
  let okCount = 0;
  let failCount = 0;
  let mockCount = 0;
  for (const z of targets) {
    try {
      const res = want ? await lightingService.zoneOn(z.id) : await lightingService.zoneOff(z.id);
      if (!res.ok) throw new Error(res.error || '执行失败');
      okCount += 1;
      if (res.mock) mockCount += 1;
    } catch (err) {
      failCount += 1;
      z.on = !want;                 // 个别回滚
      z.error = (err as Error).message;
    }
  }
  if (mockCount > 0 && mockCount === okCount) {
    ElMessage.warning(
      `命令成功送出, 但后端在 MOCK 模式 (${mockCount}/${targets.length} 区), 灯不会真的动. ` +
      `去 GK9000 后端 .env 改 MOCK_MODE=false 并重启.`,
    );
  } else if (failCount === 0 && okCount > 0) {
    ElMessage.success(`${okCount} 区已下发`);
  } else if (failCount > 0) {
    ElMessage.error(`${failCount}/${targets.length} 区下发失败`);
  }
}

async function allOn(): Promise<void> {
  ElMessage.info(`全部开启 — 逐区下发 (${zones.value.length} 区)`);
  await dispatchMany(zones.value, 'on');
}
async function allOff(): Promise<void> {
  ElMessage.warning(`全部关闭 — 逐区下发 (${zones.value.length} 区)`);
  await dispatchMany(zones.value, 'off');
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
        </div>
        <div class="v2-tabs">
          <button class="v2-tab" :class="{ active: !grouping }" @click="grouping = false">控制</button>
          <button class="v2-tab" :class="{ active: grouping }" @click="grouping = true">分区</button>
        </div>
      </div>
      <div class="quick-actions">
        <button class="v2-quick" @click="loadZones" :disabled="loading" title="重新加载分区列表">
          <RefreshCw :size="14" :stroke-width="2" />
        </button>
        <button class="v2-quick primary" @click="allOn" :disabled="loading || zones.length === 0" title="整馆全开">
          <Power :size="14" :stroke-width="2" /> 全部开
        </button>
        <button class="v2-quick danger" @click="allOff" :disabled="loading || zones.length === 0" title="整馆全关">
          <X :size="14" :stroke-width="2" /> 全部关
        </button>
        <button class="v2-quick" @click="gotoScene">
          <Sparkles :size="14" :stroke-width="2" /> 调用场景
        </button>
        <button class="v2-quick" @click="router.push({ name: 'dali-lights' })" title="扫描/命名/分组单盏 DALI 灯">
          <Search :size="14" :stroke-width="2" /> 单灯调试
        </button>
      </div>
    </header>

    <!-- 分区管理面板: 新建 / 拖动排序 / 双击改名。成员 (哪盏灯在哪个区) 在单灯页管。 -->
    <div v-if="grouping" class="group-panel">
      <div class="gp-head">
        <div class="gp-title"><Layers :size="16" :stroke-width="2" /> 分区管理</div>
        <div class="gp-hint">
          新建 / 拖动排序 / 双击改名。<b style="color: var(--v2-text-1)">分区里放哪些灯, 去「单灯调试」页按盏分配</b>
          (逐灯直控、不依赖硬件组、可跨总线随时改)。
        </div>
        <div class="gp-new-btns">
          <button class="v2-quick primary" @click="createLightZone">
            <FolderPlus :size="14" :stroke-width="2" /> 新建分区
          </button>
          <button class="v2-quick" @click="router.push({ name: 'dali-lights' })">
            <Search :size="14" :stroke-width="2" /> 去单灯页分配
          </button>
        </div>
      </div>
    </div>

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
          <div class="ov-label">已分配灯</div>
          <div class="ov-value v2-inter">{{ overview.lights }}<span class="unit"> 盏</span></div>
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
      <div class="state-sub">点下面直接新建, 或到 后台 → 灯光分区管理 添加</div>
      <button class="v2-quick primary" style="margin-top: 12px" @click="createLightZone">
        <FolderPlus :size="14" :stroke-width="2" /> 新建分区
      </button>
    </div>

    <!-- 区卡网格 -->
    <div v-else class="v2-zone-grid">
      <div
        v-for="z in filteredZones"
        :key="z.id"
        class="v2-zone"
        :class="{
          on: z.on, off: !z.on, offline: !!z.error,
          dragging: dragZoneId === z.id,
          dropzone: dragOverZoneId === z.id,
        }"
        :draggable="grouping && editingZone !== z.id"
        @dragstart="onZoneDragStart(z, $event)"
        @dragover="onZoneDragOver(z, $event)"
        @drop.prevent="onZoneDrop(z)"
        @dragend="onZoneDragEnd"
      >
        <div class="zone-top">
          <div class="zone-meta">
            <!-- 编组态才给拖 —— 控制态误拖会让人以为点错了, 而且那时也不该改布局 -->
            <span v-if="grouping" class="zone-drag" title="按住拖动可调整顺序">
              <GripVertical :size="16" :stroke-width="2" />
            </span>
            <!-- 就地改名: 双击/点笔即可, 不弹窗。业主要的是"区域名称可自定义" -->
            <input
              v-if="editingZone === z.id"
              v-model="editingText"
              class="zone-name-input" maxlength="24"
              @click.stop @keyup.enter="commitRenameZone(z)"
              @keyup.esc="editingZone = null" @blur="commitRenameZone(z)"
            />
            <div v-else class="zone-name" @dblclick.stop="grouping && startRenameZone(z)">
              {{ z.name }}
              <button
                v-if="grouping" class="zone-edit" title="改名"
                @click.stop="startRenameZone(z)"
              ><Pencil :size="13" /></button>
            </div>
            <div class="zone-addr">{{ zoneMemberLabel(z) }}</div>
          </div>
          <button
            v-if="!grouping"
            class="v2-toggle"
            :class="{ on: z.on }"
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
/* ============ 拖拽排序 + 就地改名 ============
   顺序存后端 (见 service): 现场多终端, 存 localStorage 每台设备顺序都不一样。 */
.zone-drag {
  display: inline-flex; align-items: center; margin-right: 6px;
  color: var(--v2-text-2); cursor: grab;
}
.zone-drag:active { cursor: grabbing; }
.v2-zone.dragging { opacity: .45; }
/* 拖到哪儿就在哪儿亮一条边 —— 松手前就知道会落在哪, 不用猜 */
.v2-zone.dropzone {
  outline: 2px dashed var(--v2-primary);
  outline-offset: 2px;
}
.zone-name-input {
  width: 100%; padding: 4px 8px;
  font-size: 17px; font-weight: 600;
  color: var(--v2-text-1); background: var(--v2-inset-bg);
  border: 1px solid var(--v2-primary); border-radius: 6px;
  outline: none;
}
.zone-edit {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; margin-left: 6px; border-radius: 6px;
  background: transparent; border: none; cursor: pointer;
  color: var(--v2-text-2); opacity: 0; transition: opacity .12s;
}
.v2-zone:hover .zone-edit { opacity: 1; }
.zone-edit:hover { color: var(--v2-primary); }

/* ============ 编组面板 ============ */
.group-panel {
  margin-bottom: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-ov-1);
}
.gp-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.gp-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--v2-text-1);
}
.gp-hint { font-size: 13px; color: var(--v2-text-2); }
.gp-empty { font-size: 13px; color: var(--v2-text-2); padding: 6px 0; }
.gp-chips { display: flex; flex-wrap: wrap; gap: 8px; }
/* 灯组 chip 要够大 —— 现场是站着用平板点的, 不是坐着用鼠标 */
.gp-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 9px 14px;
  min-height: 40px;
  border-radius: 8px;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-ov-1);
  color: var(--v2-text-1);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.gp-chip:hover { border-color: var(--v2-primary-soft); }
.gp-chip.picked {
  border-color: var(--v2-primary);
  background: var(--v2-primary-soft);
  color: #fff;
  box-shadow: 0 0 0 1px var(--v2-primary) inset;
}
.gp-chip.in-zone { padding: 6px 10px; min-height: 32px; font-size: 13px; }
.gp-chip.in-zone:hover { border-color: var(--v2-danger); color: var(--v2-danger); }
.gp-bar {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--v2-text-1);
}
.gp-new-btn { margin-left: auto; }
.gp-new-btns { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }

/* ============ 新建组 dialog ============ */
.ng-mask {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.ng-box {
  width: min(400px, 100%); display: flex; flex-direction: column; gap: 6px;
  background: var(--v2-surf-1, #14161A); border: 1px solid var(--v2-border-soft);
  border-radius: 14px; padding: 20px;
}
.ng-title { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; color: var(--v2-text-1); }
.ng-hint { font-size: 12px; color: var(--v2-text-3); margin-bottom: 8px; line-height: 1.5; }
.ng-label { font-size: 12px; color: var(--v2-text-3); margin-top: 6px; }
.ng-input {
  background: var(--v2-ov-1); border: 1px solid var(--v2-border-soft); border-radius: 8px;
  padding: 10px 12px; color: var(--v2-text-1); font-size: 14px; outline: none; font-family: inherit;
}
.ng-input:focus { border-color: var(--v2-primary); }
.ng-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }

/* 卡片内的灯组列表 (编组态) */
.zone-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 10px;
}
.zg-empty { font-size: 13px; color: var(--v2-text-2); }
.zg-drop {
  padding: 6px 12px;
  min-height: 32px;
  border-radius: 8px;
  border: 1px dashed var(--v2-primary);
  background: transparent;
  color: var(--v2-primary);
  font-size: 13px;
  cursor: pointer;
}
.zg-drop:disabled { opacity: 0.35; cursor: not-allowed; border-style: dashed; }
.zg-drop:not(:disabled):hover { background: var(--v2-primary-soft); color: #fff; }

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
  box-shadow: 0 0 0 1px rgba(76, 154, 255, 0.2);
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
/* "全部开"是常规批量操作, 不是警示也不是危险 —— 不该穿琥珀色。
   危险的那个("全部关")保持红色即可, 一屏上只需要一个颜色警示。 */
.v2-quick.primary {
  background: var(--v2-surf-2);
  color: var(--v2-text-1);
  border-color: var(--v2-border-strong);
}
.v2-quick.danger {
  background: rgba(229, 100, 93, 0.1);
  color: var(--v2-danger);
  border-color: rgba(229, 100, 93, 0.3);
}

/* ============ 总览 ============ */
/* 状态行卡片: 原 4 个独立大格压成一条横条, 段间细线分隔 */
/* 总览条: 去掉"灯光=琥珀"的品类底色, 统一中性表面。
   这条是纯数据展示, 不表达任何状态, 不该占用颜色预算。 */
.v2-overview {
  display: flex; align-items: center;
  padding: 8px var(--v2-sp-3);
  background: var(--v2-surf-1);
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
  background: var(--v2-ov-1);
  color: var(--v2-text-2);
  display: grid; place-items: center;
  flex-shrink: 0;
}
.ov-body { display: flex; flex-direction: column; min-width: 0; }
.ov-label { font-size: var(--v2-fs-xs); color: var(--v2-text-3); letter-spacing: 1px; }
.ov-value {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.1;
  margin-top: 1px;
  color: var(--v2-text-1);
}
.ov-value .unit { font-size: 11px; color: var(--v2-text-3); margin-left: 2px; font-weight: 400; }

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
/* v4: 每张分区卡顶部那条琥珀发光带取消 —— 十几个分区各来一条, 就是一屏发光条 */
.v2-zone::after {
  display: none;
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
  border-color: rgba(224, 160, 48, 0.45);
  box-shadow:
    inset 0 1px 0 rgba(224, 160, 48, 0.5),
    0 0 0 1px rgba(224, 160, 48, 0.15),
    0 14px 32px -10px rgba(224, 160, 48, 0.25);
}
.v2-zone:hover::after { opacity: 0.8; }
/* 灯亮着 = 暖色高亮(物理语义: 灯本来就是暖的, 不用强调蓝)。
   强度对齐全站"活跃/选中"那条: 明显染底 + 实心暖边 + 光晕 —— 业主反馈"打开状态不明显", 原来底色只有 10%。 */
.v2-zone.on {
  --zone-glow: rgba(224, 160, 48, 0.35);
  border-color: var(--v2-light-warm);
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--v2-light-warm) 24%, var(--v2-surf-1)),
    color-mix(in srgb, var(--v2-light-warm) 13%, var(--v2-surf-1)));
  box-shadow:
    inset 0 1px 0 rgba(224, 160, 48, 0.65),
    0 8px 32px -8px rgba(224, 160, 48, 0.45),
    0 0 40px -10px rgba(224, 160, 48, 0.35) !important;
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
  box-shadow: 0 0 12px rgba(229, 100, 93, 0.35);
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
  background: linear-gradient(135deg, #E0A030, #E0A030);
  box-shadow:
    0 0 14px rgba(224, 160, 48, 0.6),
    0 0 28px rgba(224, 160, 48, 0.35);
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
  border: 1px solid var(--v2-border-soft);
}
.slider-fill {
  height: 100%;
  background: linear-gradient(90deg, #E0A030 0%, #E0A030 50%, #FFD060 100%);
  border-radius: 7px;
  box-shadow:
    0 0 16px rgba(224, 160, 48, 0.55),
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
/* 选中态用强调色, 不用琥珀 —— 琥珀是警示语义, 不该拿来表示"当前选的是这档" */
.preset.active {
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
  border-color: rgba(76, 154, 255, 0.35);
}
.preset:disabled { opacity: 0.4; cursor: not-allowed; }

/* 单 zone 错误提示 */
.zone-err {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 11px;
  background: rgba(229, 100, 93, 0.12);
  color: var(--v2-danger);
  border: 1px solid rgba(229, 100, 93, 0.25);
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
.state-card.error { border-color: rgba(229, 100, 93, 0.3); color: var(--v2-danger); }
.state-title { font-size: 14px; color: var(--v2-text-1); }
.state-sub { font-size: 12px; color: var(--v2-text-3); }

/* ============ 分配分区对话框 (跟单灯页一致: 手机底部 sheet / 桌面居中) ============ */
.zone-modal-mask {
  position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, .55);
  display: flex; align-items: flex-end; justify-content: center;
}
@media (min-width: 560px) { .zone-modal-mask { align-items: center; padding: 20px; } }
.zone-modal {
  width: 100%; max-width: 460px;
  background: var(--v2-surf-2); border: 1px solid var(--v2-border-strong);
  border-radius: 16px 16px 0 0; box-shadow: var(--v2-elev-3);
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
}
@media (min-width: 560px) { .zone-modal { border-radius: 16px; } }
.zm-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.zm-title .zm-sub { font-size: 12px; color: var(--v2-text-3); font-weight: 400; margin-left: 8px; }
.zm-list { display: flex; flex-direction: column; gap: 6px; max-height: 44vh; overflow-y: auto; }
.zm-opt {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-radius: 10px; text-align: left; cursor: pointer; font-size: 14px;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.zm-opt.sel { border-color: var(--v2-primary); background: var(--v2-primary-soft); color: var(--v2-primary); font-weight: 600; }
.zm-check { font-weight: 700; }
.zm-empty { color: var(--v2-text-3); font-size: 13px; text-align: center; padding: 10px 0; }
.zm-new { margin-top: 10px; }
.zm-new-btn {
  width: 100%; padding: 11px; border-radius: 10px; cursor: pointer; font-size: 14px;
  background: var(--v2-surf-1); border: 1px dashed var(--v2-border-strong); color: var(--v2-text-2);
}
.zm-new-row { display: flex; gap: 8px; }
.zm-input {
  flex: 1; min-width: 0; padding: 11px 12px; border-radius: 10px; font-size: 14px;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.zm-create {
  flex: none; padding: 11px 18px; border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 600;
  background: var(--v2-primary-soft); border: 1px solid var(--v2-primary); color: var(--v2-primary);
}
.zm-create:disabled { opacity: .5; }
.zm-actions { display: flex; gap: 10px; margin-top: 16px; }
.zm-cancel, .zm-save { flex: 1; padding: 12px; border-radius: 10px; cursor: pointer; font-size: 15px; font-weight: 600; }
.zm-cancel { background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-2); }
.zm-save { background: var(--v2-primary); border: 1px solid var(--v2-primary); color: #fff; }
</style>
