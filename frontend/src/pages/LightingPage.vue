<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import { ArrowLeft, Lightbulb, Power, X, Sparkles, Layers, RefreshCw, GripVertical, Pencil } from 'lucide-vue-next';
import { lightingService } from '@/services/lighting.service';
import {
  lightZonesService,
  type LightZoneView,
  type LightGroupView,
} from '@/services/light-zones.service';

/**
 * 2026-07-16 模型改造: 一个分区 = 若干个 DALI 组 (可跨两台网关), 不再是"分区就是一组".
 * 现场 7 分区 / 11 组, 全在一层。分区里的组数可以是 0 (刚建的空分区)。
 */
interface ZoneRow {
  id: number;
  code: string;
  name: string;
  floor: string;
  /** 该分区包含的 DALI 组; 组号必须跟网关一起看 (两台网关的"组3"是不同的灯) */
  groups: LightGroupView[];
  brightness: number;
  on: boolean;
  busy: boolean;
  error: string | null;
}

// ============ 数据源 — Sprint E (2026-05-31): 从 /api/light-zones 拉, 不再硬编码 ============
const zones = ref<ZoneRow[]>([]);
const allGroups = ref<LightGroupView[]>([]);
const loading = ref<boolean>(false);
const loadError = ref<string | null>(null);

async function loadZones(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    // 并发拉: 分区列表 + 全部组 (编组面板要列"未分配"的组)
    const [list, groups] = await Promise.all([
      lightZonesService.list(),
      lightZonesService.groups(),
    ]);
    allGroups.value = groups;
    zones.value = list.map((z: LightZoneView): ZoneRow => ({
      id: z.id,
      code: z.code,
      name: z.name,
      floor: z.floor,
      groups: z.groups,
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

/** 未归入任何分区的组 — 编组面板的左侧待分配池 */
const unassignedGroups = computed(() => allGroups.value.filter((g) => g.zoneCode === null));

// ============ 总览 ============
const overview = computed(() => {
  const total = zones.value.length;
  const onCount = zones.value.filter((z) => z.on).length;
  const avgBri = onCount === 0 ? 0 : Math.round(
    zones.value.filter((z) => z.on).reduce((s, z) => s + z.brightness, 0) / onCount,
  );
  // 网关台数从组上统计 — 分区自己不再挂网关
  const gateways = new Set(allGroups.value.map((g) => g.gatewayCode));
  return { total, onCount, avgBri, gatewayCount: gateways.size, groupCount: allGroups.value.length };
});

// ============ 编组模式 ============
// 业主要能在前端把组塞进分区 (代码里写死过一次, 现场对不上就得改代码重部署 — 不可接受).
const grouping = ref<boolean>(false);
const pickedGroups = ref<Set<number>>(new Set());

function togglePick(gid: number): void {
  const s = new Set(pickedGroups.value);
  if (s.has(gid)) s.delete(gid); else s.add(gid);
  pickedGroups.value = s;   // 换引用才触发 Vue 响应式 (Set 原地改不触发)
}

async function assignPickedTo(zoneCode: string | null): Promise<void> {
  const ids = Array.from(pickedGroups.value);
  if (ids.length === 0) {
    ElMessage.info('先选中要分配的灯组');
    return;
  }
  try {
    await lightZonesService.assignGroups(ids, zoneCode);
    pickedGroups.value = new Set();
    await loadZones();       // 重新拉, 以后端为准 — 别本地猜
    const zoneName = zoneCode === null
      ? '未分配'
      : (zones.value.find((z) => z.code === zoneCode)?.name ?? zoneCode);
    ElMessage.success(`${ids.length} 组已归入「${zoneName}」`);
  } catch (err) {
    ElMessage.error(`分配失败: ${(err as Error).message}`);
  }
}

/** 把一个组移出所在分区, 回到未分配池 */
async function moveOut(g: LightGroupView): Promise<void> {
  try {
    await lightZonesService.assignGroups([g.id], null);
    await loadZones();
    ElMessage.success(`${groupLabel(g)} 已移出`);
  } catch (err) {
    ElMessage.error(`移出失败: ${(err as Error).message}`);
  }
}

/** 组的人类可读名 — 必须带网关, 否则两台网关的同号组分不清 */
function groupLabel(g: LightGroupView): string {
  return `${g.gatewayDisplayName} · ${g.daliGroup}组`;
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
          <button class="v2-tab" :class="{ active: grouping }" @click="grouping = true">编组</button>
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
      </div>
    </header>

    <!-- 编组面板: 选中灯组 → 点分区按钮归入. 现场核对分组时用, 不用改代码. -->
    <div v-if="grouping" class="group-panel">
      <div class="gp-head">
        <div class="gp-title"><Layers :size="16" :stroke-width="2" /> 未分配灯组</div>
        <div class="gp-hint">
          选中灯组, 再点下方分区卡上的「放这里」。分区里的组点一下可移出。
        </div>
      </div>
      <div v-if="unassignedGroups.length === 0" class="gp-empty">全部灯组都已分配</div>
      <div v-else class="gp-chips">
        <button
          v-for="g in unassignedGroups"
          :key="g.id"
          class="gp-chip"
          :class="{ picked: pickedGroups.has(g.id) }"
          @click="togglePick(g.id)"
        >{{ groupLabel(g) }}</button>
      </div>
      <div v-if="pickedGroups.size > 0" class="gp-bar">
        已选 {{ pickedGroups.size }} 组
        <button class="v2-quick" @click="pickedGroups = new Set()">取消选择</button>
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
            <!-- 控制态只报"几组灯", 不摆 gateway/组号这种调试信息; 编组态才需要看明细 -->
            <div class="zone-addr">
              {{ z.groups.length === 0 ? '暂无灯组' : `${z.groups.length} 组灯` }}
            </div>
          </div>
          <button
            v-if="!grouping"
            class="v2-toggle"
            :class="{ on: z.on }"
            @click="toggleZone(z)"
            :title="z.on ? '关闭' : '开启'"
          ></button>
        </div>

        <!-- 编组态: 列出本区的组 (点一下移出), 并提供"放这里" -->
        <div v-if="grouping" class="zone-groups">
          <div v-if="z.groups.length === 0" class="zg-empty">还没有灯组</div>
          <button
            v-for="g in z.groups"
            :key="g.id"
            class="gp-chip in-zone"
            @click="moveOut(g)"
            :title="`点击把 ${groupLabel(g)} 移出本区`"
          >{{ groupLabel(g) }} <X :size="11" :stroke-width="2.5" /></button>
          <button
            class="zg-drop"
            :disabled="pickedGroups.size === 0"
            @click="assignPickedTo(z.code)"
            :title="pickedGroups.size === 0 ? '先在上面选中灯组' : `把选中的 ${pickedGroups.size} 组放入 ${z.name}`"
          >放这里</button>
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
  color: var(--v2-text-1); background: rgba(0,0,0,.35);
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
  background: rgba(255, 255, 255, 0.03);
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
  background: rgba(255, 255, 255, 0.05);
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
/* 状态行卡片: 原 4 个独立大格压成一条横条, 段间细线分隔 */
.v2-overview {
  display: flex; align-items: center;
  padding: 8px var(--v2-sp-3);
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.05), rgba(251, 191, 36, 0.01));
  border: 1px solid rgba(251, 191, 36, 0.12);
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
  background: var(--v2-amber-soft);
  color: var(--v2-amber);
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
