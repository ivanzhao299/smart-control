<script setup lang="ts">
/**
 * 中央空调 — 22 台内机, 1920×1080 一屏不滚动.
 *
 * 交互模型: **选择 与 控制 分离**.
 *   22 台内机 × (开关 + 温度 + 模式 + 风速) 如果每张卡都塞满控件, 一屏必然放不下,
 *   而且 88 个控件同屏也没人找得到。所以卡片只负责"看状态 + 选中", 底部一条控制条
 *   作用于当前选中集合:
 *     选 1 台   → 单机控制 (现场单机测试就是这么用: 选一台, 开, 看哪个房间凉)
 *     选一个组 → 分区控制
 *     选一楼    → 楼层控制
 *     全选      → 集中控制
 *   四种粒度共用同一条控制条和同一个后端接口 (POST /hvac/batch/*), 不需要为每种
 *   粒度各做一套 UI 和一套接口。
 *
 * 编组模式: 选中若干台 → "归到此组" → 选组。跟单机测试是同一个选择习惯,
 * 不用学第二套操作。组名/内机名都能就地改, 全部落库, 不用改代码。
 */
import { computed, nextTick, onMounted, ref, type Component } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, Snowflake, Flame, Wind, Sparkles, Droplet,
  Power, Minus, Plus, Thermometer, Pencil, Check, FolderPlus, Trash2, Layers,
} from 'lucide-vue-next';
import {
  hvacService, type HvacFan, type HvacIndoor, type HvacMode, type HvacZone,
} from '@/services/hvac.service';

const router = useRouter();
function goBack(): void { void router.push('/'); }

/** 本地推测的内机状态 — 中弘网关读回状态较慢, 这里走乐观更新, 失败再回滚 */
interface IndoorState {
  on: boolean;
  temperature: number;
  mode: HvacMode;
  fan: HvacFan;
}
interface IndoorRow extends HvacIndoor {
  state: IndoorState;
}

const indoors = ref<IndoorRow[]>([]);
const zones = ref<HvacZone[]>([]);
const loading = ref(false);
const busy = ref(false);
const floorTab = ref<'1F' | '2F' | 'all'>('all');
const selected = ref<Set<number>>(new Set());
const groupMode = ref(false);

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

function freshState(): IndoorState {
  return { on: false, temperature: 24, mode: 'auto', fan: 'auto' };
}

async function loadAll(): Promise<void> {
  loading.value = true;
  try {
    const [ind, zs] = await Promise.all([hvacService.listIndoors(), hvacService.listZones()]);
    // 重载时保留已有的本地状态推测, 免得刚点完开机一刷新又变回关
    const prev = new Map(indoors.value.map((i) => [i.idx, i.state]));
    indoors.value = ind.map((i) => ({ ...i, state: prev.get(i.idx) ?? freshState() }));
    zones.value = zs;
    // 选中项里可能有已被删掉的内机, 清理掉
    const alive = new Set(ind.map((i) => i.idx));
    selected.value = new Set([...selected.value].filter((x) => alive.has(x)));
  } catch (err) {
    ElMessage.error('加载空调数据失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(() => { void loadAll(); });

// ============ 视图 ============

const visibleIndoors = computed(() =>
  floorTab.value === 'all' ? indoors.value : indoors.value.filter((i) => i.floor === floorTab.value),
);

/** 当前楼层下的组 + "未分组" 兜底 (未分组不是错误, 是编组过程中的正常状态) */
const visibleZones = computed(() => {
  const zs = floorTab.value === 'all' ? zones.value : zones.value.filter((z) => z.floor === floorTab.value);
  return zs.filter((z) => visibleIndoors.value.some((i) => i.zoneCode === z.code));
});
const ungroupedCount = computed(() => visibleIndoors.value.filter((i) => !i.zoneCode).length);

const zoneNameOf = computed(() => {
  const m = new Map(zones.value.map((z) => [z.code, z.name]));
  return (code: string | null): string => (code ? m.get(code) ?? '?' : '未分组');
});

const selectedRows = computed(() => indoors.value.filter((i) => selected.value.has(i.idx)));
const selectedIdxs = computed(() => selectedRows.value.map((i) => i.idx));

const overview = computed(() => {
  const list = visibleIndoors.value;
  const on = list.filter((i) => i.state.on);
  return {
    onCount: on.length,
    total: list.length,
    avgT: on.length ? Math.round(on.reduce((s, i) => s + i.state.temperature, 0) / on.length) : 0,
    zoneCount: visibleZones.value.length,
  };
});

/** 控制条显示的值: 选中项一致就显示该值, 不一致显示 null (界面上留空/不高亮) */
function commonOf<K extends keyof IndoorState>(key: K): IndoorState[K] | null {
  const rows = selectedRows.value;
  if (!rows.length) return null;
  const first = rows[0].state[key];
  return rows.every((r) => r.state[key] === first) ? first : null;
}
const selMode = computed(() => commonOf('mode'));
const selFan = computed(() => commonOf('fan'));
const selOn = computed(() => commonOf('on'));
const selTemp = computed(() => {
  const rows = selectedRows.value;
  if (!rows.length) return 24;
  return Math.round(rows.reduce((s, r) => s + r.state.temperature, 0) / rows.length);
});

// ============ 选择 ============

function toggleOne(idx: number): void {
  const s = new Set(selected.value);
  if (s.has(idx)) s.delete(idx); else s.add(idx);
  selected.value = s;
}
function selectAll(): void { selected.value = new Set(visibleIndoors.value.map((i) => i.idx)); }
function selectNone(): void { selected.value = new Set(); }
function selectFloor(f: '1F' | '2F'): void {
  selected.value = new Set(indoors.value.filter((i) => i.floor === f).map((i) => i.idx));
}
function selectZone(code: string | null): void {
  selected.value = new Set(
    visibleIndoors.value.filter((i) => i.zoneCode === code).map((i) => i.idx),
  );
}
function isZoneSelected(code: string | null): boolean {
  const members = visibleIndoors.value.filter((i) => i.zoneCode === code).map((i) => i.idx);
  return members.length > 0 && members.every((m) => selected.value.has(m));
}

// ============ 控制 (统一走 batch, 乐观更新 + 失败回滚) ============

/**
 * @param apply 本地状态怎么改 (先改, 让界面立刻响应)
 * @param send  真正的下发
 */
async function run(
  label: string,
  apply: (s: IndoorState) => void,
  send: (idxs: number[]) => Promise<{ okCount: number; failCount: number }>,
): Promise<void> {
  const rows = selectedRows.value;
  if (!rows.length) { ElMessage.warning('请先选中内机'); return; }
  const backup = rows.map((r) => ({ idx: r.idx, snapshot: { ...r.state } }));
  rows.forEach((r) => apply(r.state));
  busy.value = true;
  try {
    const r = await send(rows.map((x) => x.idx));
    if (r.okCount === 0 && r.failCount > 0) throw new Error('全部失败');
    if (r.failCount > 0) ElMessage.warning(`${label}: 部分成功 (${r.okCount}/${r.okCount + r.failCount})`);
  } catch (err) {
    // 全失败才回滚 —— 部分成功时回滚会把成功的那些也抹掉, 反而更不准
    const map = new Map(backup.map((b) => [b.idx, b.snapshot]));
    indoors.value.forEach((i) => { const s = map.get(i.idx); if (s) i.state = s; });
    ElMessage.error(`${label} 失败: ${(err as Error).message}`);
  } finally {
    busy.value = false;
  }
}

const turnOn = () => run('开机', (s) => { s.on = true; }, (ix) => hvacService.batchOn(ix));
const turnOff = () => run('关机', (s) => { s.on = false; }, (ix) => hvacService.batchOff(ix));
const setMode = (mode: HvacMode) => run('模式', (s) => { s.mode = mode; }, (ix) => hvacService.batchMode(ix, mode));
const setFan = (speed: HvacFan) => run('风速', (s) => { s.fan = speed; }, (ix) => hvacService.batchFanSpeed(ix, speed));
function adjustTemp(delta: number): void {
  const next = Math.max(16, Math.min(30, selTemp.value + delta));
  if (next === selTemp.value) return;
  void run('温度', (s) => { s.temperature = next; }, (ix) => hvacService.batchTemperature(ix, next));
}

/** 顶部"全开/全关" — 作用于当前楼层 tab 的全部内机, 跟选中无关 */
async function floorPower(on: boolean): Promise<void> {
  const idxs = visibleIndoors.value.map((i) => i.idx);
  if (!idxs.length) return;
  const backup = indoors.value.map((i) => ({ idx: i.idx, on: i.state.on }));
  visibleIndoors.value.forEach((i) => { i.state.on = on; });
  busy.value = true;
  try {
    const r = await (on ? hvacService.batchOn(idxs) : hvacService.batchOff(idxs));
    if (r.okCount === 0 && r.failCount > 0) throw new Error('全部失败');
    if (r.failCount > 0) ElMessage.warning(`部分成功 (${r.okCount}/${r.total})`);
  } catch (err) {
    const map = new Map(backup.map((b) => [b.idx, b.on]));
    indoors.value.forEach((i) => { const v = map.get(i.idx); if (v !== undefined) i.state.on = v; });
    ElMessage.error(`${on ? '全开' : '全关'} 失败: ${(err as Error).message}`);
  } finally {
    busy.value = false;
  }
}

// ============ 改名 (内机 / 组) ============

const editingIndoor = ref<number | null>(null);
const editingZone = ref<string | null>(null);
const editingText = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

/**
 * 输入框用函数式 ref 绑.
 * 不能写 ref="nameInput" —— 它在 v-for 里, Vue 会把同名 ref 收集成**数组**,
 * 于是 nameInput.value.select() 静默失效 (点了铅笔但文字没选中)。
 * 靠 v-if 保证同一时刻只有一个输入框活着, 所以这里直接存单个元素即可。
 */
function bindNameInput(el: unknown): void {
  if (el) nameInput.value = el as HTMLInputElement;
}

function startRenameIndoor(row: IndoorRow): void {
  editingZone.value = null;
  editingIndoor.value = row.idx;
  editingText.value = row.name;
  void nextTick(() => nameInput.value?.select());
}
async function commitRenameIndoor(row: IndoorRow): Promise<void> {
  const name = editingText.value.trim();
  editingIndoor.value = null;
  if (!name || name === row.name) return;
  const old = row.name;
  row.name = name; // 乐观
  try {
    await hvacService.updateIndoor(row.idx, { name });
  } catch (err) {
    row.name = old;
    ElMessage.error('改名失败: ' + (err as Error).message);
  }
}

function startRenameZone(z: HvacZone): void {
  editingIndoor.value = null;
  editingZone.value = z.code;
  editingText.value = z.name;
  void nextTick(() => nameInput.value?.select());
}
async function commitRenameZone(z: HvacZone): Promise<void> {
  const name = editingText.value.trim();
  editingZone.value = null;
  if (!name || name === z.name) return;
  const old = z.name;
  z.name = name;
  try {
    await hvacService.renameZone(z.code, name);
  } catch (err) {
    z.name = old;
    ElMessage.error('改名失败: ' + (err as Error).message);
  }
}

// ============ 编组 ============

async function assignTo(zoneCode: string | null): Promise<void> {
  if (!selectedIdxs.value.length) { ElMessage.warning('请先选中内机'); return; }
  try {
    await hvacService.assignIndoors(selectedIdxs.value, zoneCode);
    await loadAll();
    ElMessage.success(zoneCode ? `已归入「${zoneNameOf.value(zoneCode)}」` : '已移出分组');
  } catch (err) {
    ElMessage.error('归组失败: ' + (err as Error).message);
  }
}

async function createZone(): Promise<void> {
  const floor = floorTab.value === 'all' ? '1F' : floorTab.value;
  try {
    const { value } = await ElMessageBox.prompt(
      `新建功能区${floorTab.value === 'all' ? ' (默认归到一楼)' : ''}`, '新建分组',
      { inputPlaceholder: '例如: 会议室', inputPattern: /\S+/, inputErrorMessage: '名称不能为空' },
    );
    const z = await hvacService.createZone(String(value).trim(), floor);
    await loadAll();
    ElMessage.success(`已新建「${z.name}」, 选中内机后点它即可归入`);
  } catch (err) {
    if (err === 'cancel' || err === 'close') return;
    ElMessage.error('新建失败: ' + (err as Error).message);
  }
}

async function removeZone(z: HvacZone): Promise<void> {
  const n = indoors.value.filter((i) => i.zoneCode === z.code).length;
  try {
    await ElMessageBox.confirm(
      n > 0 ? `删除「${z.name}」? 组里 ${n} 台内机会变成"未分组", 内机本身不会被删。` : `删除「${z.name}」?`,
      '删除分组', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
    await hvacService.deleteZone(z.code);
    await loadAll();
    ElMessage.success('已删除');
  } catch (err) {
    if (err === 'cancel' || err === 'close') return;
    ElMessage.error('删除失败: ' + (err as Error).message);
  }
}

const modeIcon = (m: HvacMode): Component => modes.find((x) => x.value === m)?.icon ?? Sparkles;
const modeLabel = (m: HvacMode): string => modes.find((x) => x.value === m)?.label ?? m;
</script>

<template>
  <section class="hv-page">
    <!-- ===== 顶栏 ===== -->
    <header class="hv-head">
      <button class="v2-back-btn" @click="goBack" title="返回首页">
        <ArrowLeft :size="18" />
      </button>
      <div class="hv-title"><Snowflake :size="18" :stroke-width="1.8" /> 中央空调</div>

      <div class="v2-tabs">
        <button class="v2-tab" :class="{ active: floorTab === '1F' }" @click="floorTab = '1F'">一楼</button>
        <button class="v2-tab" :class="{ active: floorTab === '2F' }" @click="floorTab = '2F'">二楼</button>
        <button class="v2-tab" :class="{ active: floorTab === 'all' }" @click="floorTab = 'all'">全部</button>
      </div>

      <div class="hv-stats">
        <span><b>{{ overview.onCount }}</b>/{{ overview.total }} 运行</span>
        <span v-if="overview.avgT"><Thermometer :size="13" /> {{ overview.avgT }}°C</span>
        <span><Layers :size="13" /> {{ overview.zoneCount }} 组</span>
      </div>

      <div class="hv-head-actions">
        <button class="hv-btn ghost" :class="{ active: groupMode }" @click="groupMode = !groupMode">
          <Layers :size="15" /> {{ groupMode ? '完成编组' : '编组' }}
        </button>
        <button class="hv-btn primary" :disabled="busy" @click="floorPower(true)">全开</button>
        <button class="hv-btn danger" :disabled="busy" @click="floorPower(false)">全关</button>
      </div>
    </header>

    <!-- ===== 快选条 ===== -->
    <div class="hv-quick">
      <span class="hv-quick-label">快选</span>
      <button class="hv-chip" @click="selectAll">全部 {{ visibleIndoors.length }}</button>
      <button v-if="floorTab === 'all'" class="hv-chip" @click="selectFloor('1F')">一楼</button>
      <button v-if="floorTab === 'all'" class="hv-chip" @click="selectFloor('2F')">二楼</button>
      <span class="hv-quick-sep" />
      <template v-for="z in visibleZones" :key="z.code">
        <input
          v-if="editingZone === z.code" :ref="bindNameInput" v-model="editingText"
          class="hv-chip-input" maxlength="32"
          @keyup.enter="commitRenameZone(z)" @keyup.esc="editingZone = null" @blur="commitRenameZone(z)"
        />
        <button
          v-else class="hv-chip zone" :class="{ on: isZoneSelected(z.code) }"
          @click="selectZone(z.code)"
        >
          {{ z.name }}
          <em>{{ visibleIndoors.filter((i) => i.zoneCode === z.code).length }}</em>
          <template v-if="groupMode">
            <span class="chip-act" title="改组名" @click.stop="startRenameZone(z)"><Pencil :size="11" /></span>
            <span class="chip-act danger" title="删除组" @click.stop="removeZone(z)"><Trash2 :size="11" /></span>
          </template>
        </button>
      </template>
      <button v-if="ungroupedCount" class="hv-chip warn" :class="{ on: isZoneSelected(null) }" @click="selectZone(null)">
        未分组 <em>{{ ungroupedCount }}</em>
      </button>
      <button v-if="groupMode" class="hv-chip add" @click="createZone"><FolderPlus :size="13" /> 新建组</button>
      <button v-if="selected.size" class="hv-chip clear" @click="selectNone">清空选择</button>
    </div>

    <!-- ===== 内机网格 (22 台一屏铺满) ===== -->
    <div class="hv-grid" :class="{ loading }">
      <button
        v-for="row in visibleIndoors" :key="row.idx"
        class="hv-cell"
        :class="{ sel: selected.has(row.idx), running: row.state.on }"
        @click="toggleOne(row.idx)"
      >
        <div class="cell-top">
          <span class="cell-tag">{{ row.floor }}-{{ row.idx }}</span>
          <span class="cell-dot" :class="{ on: row.state.on }" />
        </div>

        <div class="cell-name">
          <input
            v-if="editingIndoor === row.idx" :ref="bindNameInput" v-model="editingText"
            class="cell-name-input" maxlength="32"
            @click.stop @keyup.enter="commitRenameIndoor(row)"
            @keyup.esc="editingIndoor = null" @blur="commitRenameIndoor(row)"
          />
          <template v-else>
            <span class="cell-name-text" :title="row.name">{{ row.name }}</span>
            <span class="cell-edit" title="改名" @click.stop="startRenameIndoor(row)">
              <Pencil :size="11" />
            </span>
          </template>
        </div>

        <div class="cell-mid">
          <span v-if="row.state.on" class="cell-temp">{{ row.state.temperature }}<i>°C</i></span>
          <span v-else class="cell-off">关机</span>
        </div>

        <div class="cell-foot">
          <span class="cell-mode" :class="{ dim: !row.state.on }">
            <component :is="modeIcon(row.state.mode)" :size="11" /> {{ modeLabel(row.state.mode) }}
          </span>
          <span class="cell-zone" :title="zoneNameOf(row.zoneCode)">{{ zoneNameOf(row.zoneCode) }}</span>
        </div>
      </button>
    </div>

    <!-- ===== 控制条 (作用于选中集合) ===== -->
    <footer class="hv-bar" :class="{ empty: !selected.size }">
      <div class="bar-sel">
        <template v-if="selected.size">
          已选 <b>{{ selected.size }}</b> 台
          <span class="bar-names">{{ selectedRows.map((r) => r.name).join('、') }}</span>
        </template>
        <template v-else>点内机卡片选中, 或用上方快选</template>
      </div>

      <template v-if="groupMode">
        <div class="bar-group">
          <span class="bar-hint">归到:</span>
          <button
            v-for="z in visibleZones" :key="z.code"
            class="hv-btn tiny" :disabled="!selected.size" @click="assignTo(z.code)"
          >{{ z.name }}</button>
          <button class="hv-btn tiny warn" :disabled="!selected.size" @click="assignTo(null)">移出分组</button>
        </div>
      </template>

      <template v-else>
        <div class="bar-ctrl">
          <button class="hv-btn primary" :disabled="!selected.size || busy" @click="turnOn">
            <Power :size="15" /> 开
          </button>
          <button class="hv-btn danger" :disabled="!selected.size || busy" @click="turnOff">
            <Power :size="15" /> 关
          </button>

          <div class="bar-temp">
            <button class="temp-btn" :disabled="!selected.size || busy" @click="adjustTemp(-1)"><Minus :size="16" /></button>
            <span class="temp-val">{{ selTemp }}<i>°C</i></span>
            <button class="temp-btn" :disabled="!selected.size || busy" @click="adjustTemp(1)"><Plus :size="16" /></button>
          </div>

          <div class="bar-seg">
            <button
              v-for="m in modes" :key="m.value"
              class="seg" :class="{ on: selMode === m.value }"
              :disabled="!selected.size || busy" @click="setMode(m.value)"
            >
              <component :is="m.icon" :size="14" /> {{ m.label }}
            </button>
          </div>

          <div class="bar-seg">
            <button
              v-for="f in fans" :key="f.value"
              class="seg" :class="{ on: selFan === f.value }"
              :disabled="!selected.size || busy" @click="setFan(f.value)"
            >{{ f.label }}</button>
          </div>

          <span v-if="selected.size && selOn !== null" class="bar-state">
            <Check :size="13" /> {{ selOn ? '运行中' : '已关机' }}
          </span>
        </div>
      </template>
    </footer>
  </section>
</template>

<style scoped>
/* 整页按 1920×1080 排: 顶栏 + 快选 + 网格 + 控制条 = 100vh, 网格自己吃掉剩余空间.
   min-height:0 是关键 —— 没有它 grid 子项撑破 flex 容器, 整页就会出滚动条. */
.hv-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  padding: 10px 14px 12px;
  gap: 8px;
  box-sizing: border-box;
}

/* ---- 顶栏 ---- */
.hv-head { display: flex; align-items: center; gap: 12px; flex: 0 0 auto; }
.hv-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 17px; font-weight: 600; color: var(--v2-text, #e8eef7); white-space: nowrap;
}
.hv-stats {
  display: flex; align-items: center; gap: 14px; margin-left: auto;
  font-size: 12px; color: var(--v2-text-dim, #8fa3bd);
}
.hv-stats span { display: inline-flex; align-items: center; gap: 4px; }
.hv-stats b { color: var(--v2-accent, #4da3ff); font-size: 14px; }
.hv-head-actions { display: flex; gap: 8px; }

/* ---- 快选条 ---- */
.hv-quick {
  display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
  flex-wrap: wrap; padding: 6px 8px;
  background: var(--v2-surface, #141c28); border-radius: 8px;
}
.hv-quick-label { font-size: 11px; color: var(--v2-text-dim, #8fa3bd); margin-right: 2px; }
.hv-quick-sep { width: 1px; height: 16px; background: var(--v2-border, #26344a); margin: 0 4px; }
.hv-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 9px; border-radius: 999px; cursor: pointer;
  font-size: 12px; line-height: 1;
  background: var(--v2-surface-2, #1b2534); color: var(--v2-text, #e8eef7);
  border: 1px solid var(--v2-border, #26344a);
}
.hv-chip:hover { border-color: var(--v2-accent, #4da3ff); }
.hv-chip.on { background: var(--v2-accent, #4da3ff); border-color: var(--v2-accent, #4da3ff); color: #04101d; font-weight: 600; }
.hv-chip em { font-style: normal; opacity: .6; font-size: 11px; }
.hv-chip.warn { border-color: #b8860055; color: #e8b339; }
.hv-chip.warn.on { background: #e8b339; color: #2a1d00; }
.hv-chip.add { border-style: dashed; color: var(--v2-accent, #4da3ff); }
.hv-chip.clear { margin-left: auto; color: var(--v2-text-dim, #8fa3bd); }
.hv-chip-input {
  width: 110px; padding: 4px 9px; font-size: 12px; line-height: 1;
  color: var(--v2-text, #e8eef7); background: #0b1220;
  border: 1px solid var(--v2-accent, #4da3ff); border-radius: 999px; outline: none;
}
.chip-act {
  display: inline-flex; padding: 2px; border-radius: 4px; opacity: .65;
}
.chip-act:hover { opacity: 1; background: #ffffff22; }
.chip-act.danger:hover { background: #ff4d4f44; color: #ff7875; }

/* ---- 内机网格: 6 列铺满剩余高度, 22 台 = 4 行 ---- */
.hv-grid {
  flex: 1 1 auto; min-height: 0;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-auto-rows: 1fr;
  gap: 8px;
}
.hv-grid.loading { opacity: .5; pointer-events: none; }

.hv-cell {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px; text-align: left; cursor: pointer;
  min-height: 0; overflow: hidden;
  background: var(--v2-surface, #141c28);
  border: 1.5px solid var(--v2-border, #26344a);
  border-radius: 10px;
  transition: border-color .12s, background .12s;
}
.hv-cell:hover { border-color: var(--v2-accent, #4da3ff); }
.hv-cell.running { background: linear-gradient(160deg, #12283d, #141c28); }
/* 选中态用实心边框 + 外发光, 不靠颜色深浅 —— 现场大屏斜着看也要分得清 */
.hv-cell.sel {
  border-color: var(--v2-accent, #4da3ff);
  box-shadow: 0 0 0 2px #4da3ff55 inset;
}

.cell-top { display: flex; align-items: center; justify-content: space-between; }
.cell-tag { font-size: 10px; color: var(--v2-text-dim, #8fa3bd); letter-spacing: .3px; }
.cell-dot { width: 7px; height: 7px; border-radius: 50%; background: #3c4a5e; }
.cell-dot.on { background: #35d07f; box-shadow: 0 0 6px #35d07f99; }

.cell-name { display: flex; align-items: center; gap: 4px; min-height: 18px; }
.cell-name-text {
  font-size: 13px; font-weight: 600; color: var(--v2-text, #e8eef7);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cell-edit { opacity: 0; padding: 1px; border-radius: 3px; color: var(--v2-text-dim, #8fa3bd); flex: 0 0 auto; }
.hv-cell:hover .cell-edit { opacity: .7; }
.cell-edit:hover { opacity: 1 !important; background: #ffffff22; }
.cell-name-input {
  width: 100%; font-size: 13px; font-weight: 600; padding: 1px 4px;
  color: var(--v2-text, #e8eef7); background: #0b1220;
  border: 1px solid var(--v2-accent, #4da3ff); border-radius: 4px; outline: none;
}

.cell-mid { flex: 1 1 auto; display: flex; align-items: center; min-height: 0; }
.cell-temp { font-size: 26px; font-weight: 300; color: var(--v2-text, #e8eef7); line-height: 1; }
.cell-temp i { font-size: 12px; font-style: normal; opacity: .55; margin-left: 1px; }
.cell-off { font-size: 13px; color: #55637a; }

.cell-foot { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.cell-mode {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; color: var(--v2-accent, #4da3ff); white-space: nowrap;
}
.cell-mode.dim { color: #55637a; }
.cell-zone {
  font-size: 10px; color: var(--v2-text-dim, #8fa3bd);
  max-width: 62%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ---- 控制条 ---- */
.hv-bar {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 14px;
  padding: 9px 12px;
  background: var(--v2-surface, #141c28);
  border: 1px solid var(--v2-border, #26344a);
  border-radius: 10px;
}
.hv-bar.empty { opacity: .62; }
.bar-sel {
  display: flex; align-items: baseline; gap: 6px; min-width: 210px; max-width: 300px;
  font-size: 12px; color: var(--v2-text-dim, #8fa3bd);
}
.bar-sel b { font-size: 15px; color: var(--v2-accent, #4da3ff); }
.bar-names {
  font-size: 11px; color: #6d7f98;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bar-ctrl, .bar-group { display: flex; align-items: center; gap: 10px; flex-wrap: nowrap; }
.bar-group { flex-wrap: wrap; }
.bar-hint { font-size: 12px; color: var(--v2-text-dim, #8fa3bd); }
.bar-state {
  display: inline-flex; align-items: center; gap: 4px;
  margin-left: auto; font-size: 12px; color: #35d07f;
}

.bar-temp {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 8px; border-radius: 8px;
  background: var(--v2-surface-2, #1b2534); border: 1px solid var(--v2-border, #26344a);
}
.temp-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 6px; cursor: pointer;
  background: #26344a; color: var(--v2-text, #e8eef7); border: none;
}
.temp-btn:hover:not(:disabled) { background: var(--v2-accent, #4da3ff); color: #04101d; }
.temp-btn:disabled { opacity: .35; cursor: not-allowed; }
.temp-val { font-size: 20px; font-weight: 300; min-width: 54px; text-align: center; color: var(--v2-text, #e8eef7); }
.temp-val i { font-size: 11px; font-style: normal; opacity: .55; }

.bar-seg {
  display: flex; gap: 2px; padding: 2px; border-radius: 8px;
  background: var(--v2-surface-2, #1b2534); border: 1px solid var(--v2-border, #26344a);
}
.seg {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px; border-radius: 6px; cursor: pointer; border: none;
  font-size: 12px; background: transparent; color: var(--v2-text-dim, #8fa3bd);
  white-space: nowrap;
}
.seg:hover:not(:disabled) { color: var(--v2-text, #e8eef7); background: #26344a; }
.seg.on { background: var(--v2-accent, #4da3ff); color: #04101d; font-weight: 600; }
.seg:disabled { opacity: .35; cursor: not-allowed; }

/* ---- 按钮 ---- */
.hv-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 13px; border-radius: 8px; cursor: pointer;
  font-size: 13px; font-weight: 500; white-space: nowrap;
  background: var(--v2-surface-2, #1b2534);
  border: 1px solid var(--v2-border, #26344a);
  color: var(--v2-text, #e8eef7);
}
.hv-btn:hover:not(:disabled) { border-color: var(--v2-accent, #4da3ff); }
.hv-btn:disabled { opacity: .35; cursor: not-allowed; }
.hv-btn.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
.hv-btn.danger { background: #3a2226; border-color: #6b2b32; color: #ff8f8f; }
.hv-btn.warn { border-color: #b8860055; color: #e8b339; }
.hv-btn.ghost.active { background: var(--v2-accent, #4da3ff); border-color: var(--v2-accent, #4da3ff); color: #04101d; }
.hv-btn.tiny { padding: 5px 9px; font-size: 12px; }

/* 1440 及以下: 6 列会挤, 降到 5 列 (22 台 = 5 行, 仍不滚动) */
@media (max-width: 1600px) {
  .hv-grid { grid-template-columns: repeat(5, 1fr); }
  .bar-names { display: none; }
}
@media (max-width: 1280px) {
  .hv-grid { grid-template-columns: repeat(4, 1fr); }
  .cell-temp { font-size: 22px; }
}
</style>
