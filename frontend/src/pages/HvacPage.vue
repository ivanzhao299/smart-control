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
import { computed, nextTick, onMounted, onBeforeUnmount, ref, type Component } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, Snowflake, Flame, Wind, Sparkles, Droplet,
  Power, Minus, Plus, Thermometer, Pencil, Check, FolderPlus, Trash2, Layers,
  AlertTriangle, RefreshCw,
} from 'lucide-vue-next';
import {
  hvacService, type HvacFan, type HvacIndoor, type HvacMode, type HvacZone,
} from '@/services/hvac.service';

const router = useRouter();
function goBack(): void { void router.push('/'); }

/**
 * 内机状态 — **来自真机寄存器**, 由 GET /hvac/states 轮询.
 *
 * known=false = 这一轮没读到 (网关超时 / 内机离线)。必须跟"关机"区分开:
 * 把读不到画成关机, 会让人以为空调停了而实际在跑, 比不显示更糟。
 */
interface IndoorState {
  known: boolean;
  on: boolean;
  temperature: number;
  mode: HvacMode;
  fan: HvacFan;
  /** 实测室温 (设定温度是 temperature, 这个是屋里实际多少度) */
  roomTemp?: number;
  online: boolean;
  faultCode: number;
}
interface IndoorRow extends HvacIndoor {
  state: IndoorState;
}

/** 状态轮询间隔 — 2 次 Modbus 往返约 0.2-1s, 5s 一轮既跟手又不压网关 */
const POLL_MS = 5000;

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

/** 还没读到真机状态时的占位 —— known=false, 界面显示"未知"而不是"关机" */
function unknownState(): IndoorState {
  return { known: false, on: false, temperature: 24, mode: 'auto', fan: 'auto', online: false, faultCode: 0 };
}

async function loadAll(): Promise<void> {
  loading.value = true;
  try {
    const [ind, zs] = await Promise.all([hvacService.listIndoors(), hvacService.listZones()]);
    const prev = new Map(indoors.value.map((i) => [i.idx, i.state]));
    indoors.value = ind.map((i) => ({ ...i, state: prev.get(i.idx) ?? unknownState() }));
    zones.value = zs;
    const alive = new Set(ind.map((i) => i.idx));
    selected.value = new Set([...selected.value].filter((x) => alive.has(x)));
  } catch (err) {
    ElMessage.error('加载空调数据失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

const lastPollAt = ref<Date | null>(null);
const pollFailed = ref(false);
let pollTimer: ReturnType<typeof setTimeout> | null = null;

/** 拉一次真机状态并合并进卡片 */
async function pollStates(): Promise<void> {
  try {
    const list = await hvacService.listStates();
    const byIdx = new Map(list.map((s) => [s.idx, s]));
    for (const row of indoors.value) {
      const s = byIdx.get(row.idx);
      if (!s || !s.known) {
        // 这一轮没读到: 只把 known 打掉, 保留上次的值给界面做灰显, 不要清成 0
        row.state.known = false;
        row.state.online = false;
        continue;
      }
      row.state = {
        known: true,
        on: s.on,
        temperature: s.temperature,
        mode: s.mode,
        fan: s.fan,
        roomTemp: s.roomTemp,
        online: s.online,
        faultCode: s.faultCode,
      };
    }
    lastPollAt.value = new Date();
    pollFailed.value = false;
  } catch {
    // 轮询失败不弹窗 —— 每 5s 弹一次没法用; 顶栏显示"状态读取失败"即可
    pollFailed.value = true;
  }
}

/** setTimeout 递归而非 setInterval: 避免上一轮没回来就发下一轮, 把网关压垮 */
function schedulePoll(): void {
  pollTimer = setTimeout(async () => {
    await pollStates();
    schedulePoll();
  }, POLL_MS);
}

onMounted(async () => {
  await loadAll();
  await pollStates();
  schedulePoll();
});
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer);
});

// ============ 视图 ============

const visibleIndoors = computed(() =>
  floorTab.value === 'all' ? indoors.value : indoors.value.filter((i) => i.floor === floorTab.value),
);

/** 当前楼层下的组 + "未分组" 兜底 (未分组不是错误, 是编组过程中的正常状态) */
/**
 * 快选条上显示哪些分区.
 *
 * ⚠️ 这里**不能**过滤掉空分区 (2026-07-16 业主报"新建编组后没保存"的真因):
 * 原来是 `zs.filter(z => 有内机属于它)` —— 新建的分区一台内机都没有, 于是刚建完
 * 就被过滤掉、界面上根本不出现, 看着就像没存 (其实后端存得好好的)。更糟的是这
 * 构成死锁: 要往组里放内机得先点那个组, 而组因为空又不显示 -> 永远放不进去。
 *
 * 现在: 空分区照常显示 (数量标 0), 这样才点得到、才能往里放内机。
 */
const visibleZones = computed(() =>
  floorTab.value === 'all' ? zones.value : zones.value.filter((z) => z.floor === floorTab.value),
);
const ungroupedCount = computed(() => visibleIndoors.value.filter((i) => !i.zoneCode).length);

const zoneNameOf = computed(() => {
  const m = new Map(zones.value.map((z) => [z.code, z.name]));
  return (code: string | null): string => (code ? m.get(code) ?? '?' : '未分组');
});

const selectedRows = computed(() => indoors.value.filter((i) => selected.value.has(i.idx)));
const selectedIdxs = computed(() => selectedRows.value.map((i) => i.idx));

const overview = computed(() => {
  const list = visibleIndoors.value;
  // 只统计真读到状态的 —— 未知的既不算开也不算关, 单独报出来
  const known = list.filter((i) => i.state.known);
  const on = known.filter((i) => i.state.on);
  const rt = known.map((i) => i.state.roomTemp).filter((t): t is number => typeof t === 'number');
  return {
    onCount: on.length,
    knownCount: known.length,
    unknownCount: list.length - known.length,
    total: list.length,
    faultCount: known.filter((i) => i.state.faultCode > 0).length,
    // 显示实测室温均值 (设定温度是人设的, 室温才是现场真实情况)
    avgRoomT: rt.length ? Math.round((rt.reduce((s, t) => s + t, 0) / rt.length) * 10) / 10 : null,
    zoneCount: visibleZones.value.length,
  };
});

/**
 * 控制条显示的值: 只看**读到状态**的那些选中项, 一致就显示该值, 不一致显示 null
 * (界面上不高亮任何一个). 未知的不参与 —— 拿占位值凑数会显示出一个假的共识.
 */
function commonOf<K extends keyof IndoorState>(key: K): IndoorState[K] | null {
  const rows = selectedRows.value.filter((r) => r.state.known);
  if (!rows.length) return null;
  const first = rows[0].state[key];
  return rows.every((r) => r.state[key] === first) ? first : null;
}
const selMode = computed(() => commonOf('mode'));
const selFan = computed(() => commonOf('fan'));
const selOn = computed(() => commonOf('on'));
const selTemp = computed(() => {
  const rows = selectedRows.value.filter((r) => r.state.known);
  if (!rows.length) return 24;
  return Math.round(rows.reduce((s, r) => s + r.state.temperature, 0) / rows.length);
});

// ============ 选择 ============

function toggleOne(idx: number): void {
  const s = new Set(selected.value);
  if (s.has(idx)) s.delete(idx); else s.add(idx);
  selected.value = s;
}
/**
 * 快选一律是**切换**, 不是覆盖 (2026-07-16 业主: "对内机全选状态没有反选功能").
 *
 * 原来 selectAll/selectZone 都是无条件 `selected = 这一组`, 再点一次结果不变 ——
 * 全选之后没有任何办法取消, 只能一台台点掉。现在: 该组已经全选中就取消掉它们,
 * 否则并入选中集合。并入而不是覆盖, 这样"前厅 + 会议室"可以叠加选。
 */
function toggleMany(idxs: number[]): void {
  if (idxs.length === 0) return;
  const s = new Set(selected.value);
  const allOn = idxs.every((i) => s.has(i));
  for (const i of idxs) {
    if (allOn) s.delete(i); else s.add(i);
  }
  selected.value = s;
}
function selectAll(): void { toggleMany(visibleIndoors.value.map((i) => i.idx)); }
function selectNone(): void { selected.value = new Set(); }
/** 反选: 当前可见范围内, 选中的变未选、未选的变选中 */
function invertSelection(): void {
  const s = new Set<number>();
  for (const i of visibleIndoors.value) {
    if (!selected.value.has(i.idx)) s.add(i.idx);
  }
  // 可见范围外的选中项保持不动, 免得切了楼层 tab 就把别处的选择清掉
  for (const idx of selected.value) {
    if (!visibleIndoors.value.some((i) => i.idx === idx)) s.add(idx);
  }
  selected.value = s;
}
function selectFloor(f: '1F' | '2F'): void {
  toggleMany(indoors.value.filter((i) => i.floor === f).map((i) => i.idx));
}
function selectZone(code: string | null): void {
  toggleMany(visibleIndoors.value.filter((i) => i.zoneCode === code).map((i) => i.idx));
}
function isZoneSelected(code: string | null): boolean {
  const members = visibleIndoors.value.filter((i) => i.zoneCode === code).map((i) => i.idx);
  return members.length > 0 && members.every((m) => selected.value.has(m));
}
/** 可见内机是否已全选 —— 给"全部"按钮显示选中态用 */
const allSelected = computed(() =>
  visibleIndoors.value.length > 0 && visibleIndoors.value.every((i) => selected.value.has(i.idx)),
);

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
  // 先乐观改, 让按钮跟手 (中弘网关下发到状态寄存器更新有延迟, 干等会像卡死)
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
    // 关键: 复读真机, 用寄存器的真相覆盖掉刚才的乐观猜测.
    // 命令下发到网关刷新状态寄存器有延迟, 立刻读会读到旧值, 所以等一下再读。
    setTimeout(() => { void pollStates(); }, 1200);
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
    setTimeout(() => { void pollStates(); }, 1200);
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
const fanLabel = (f: HvacFan): string => fans.find((x) => x.value === f)?.label ?? f;
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
        <span><b>{{ overview.onCount }}</b>/{{ overview.knownCount }} 运行</span>
        <span v-if="overview.avgRoomT !== null" title="实测室温均值">
          <Thermometer :size="13" /> {{ overview.avgRoomT }}°C
        </span>
        <span><Layers :size="13" /> {{ overview.zoneCount }} 组</span>
        <span v-if="overview.faultCount" class="warn"><AlertTriangle :size="13" /> {{ overview.faultCount }} 故障</span>
        <span v-if="overview.unknownCount" class="dim" title="本轮未读到状态的内机">
          {{ overview.unknownCount }} 台未知
        </span>
        <span class="poll" :class="{ bad: pollFailed }" :title="pollFailed ? '状态读取失败' : '最近一次读取时间'">
          <RefreshCw :size="12" />
          {{ pollFailed ? '读取失败' : (lastPollAt ? lastPollAt.toLocaleTimeString('zh-CN', { hour12: false }) : '读取中') }}
        </span>
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
      <button class="hv-chip" :class="{ on: allSelected }" @click="selectAll">
        全部 {{ visibleIndoors.length }}
      </button>
      <button v-if="floorTab === 'all'" class="hv-chip" @click="selectFloor('1F')">一楼</button>
      <button v-if="floorTab === 'all'" class="hv-chip" @click="selectFloor('2F')">二楼</button>
      <button class="hv-chip" title="选中的变未选, 未选的变选中" @click="invertSelection">反选</button>
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
        :class="{
          sel: selected.has(row.idx),
          running: row.state.known && row.state.on,
          unknown: !row.state.known,
          fault: row.state.known && row.state.faultCode > 0,
        }"
        @click="toggleOne(row.idx)"
      >
        <div class="cell-head">
          <!-- 选中态: 一个明确的复选框, 选了就打勾变蓝, 不靠边框深浅去猜 -->
          <span class="cell-check" :class="{ on: selected.has(row.idx) }">
            <Check v-if="selected.has(row.idx)" :size="16" :stroke-width="3" />
          </span>
          <span class="cell-tag">{{ row.floor }}-{{ row.idx }}</span>
          <span v-if="row.state.known && row.state.faultCode > 0" class="cell-fault" :title="'故障码 ' + row.state.faultCode">
            <AlertTriangle :size="14" /> {{ row.state.faultCode }}
          </span>
          <span
            class="cell-dot"
            :class="{ on: row.state.known && row.state.on, unknown: !row.state.known }"
            :title="!row.state.known ? '未读到状态' : (row.state.on ? '运行中' : '已关机')"
          >{{ !row.state.known ? '未知' : (row.state.on ? '运行' : '关') }}</span>
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
              <Pencil :size="15" />
            </span>
          </template>
        </div>

        <!-- 中段占满剩余高度, 温度居中放大 —— 卡片再大也不留空洞 -->
        <div class="cell-body">
          <span v-if="!row.state.known" class="cell-unknown">未读到状态</span>
          <template v-else-if="row.state.on">
            <span class="cell-temp" :class="'m-' + row.state.mode">{{ row.state.temperature }}<i>°C</i></span>
            <span v-if="row.state.roomTemp !== undefined" class="cell-room" title="实测室温">
              室温 {{ row.state.roomTemp }}°
            </span>
          </template>
          <template v-else>
            <span class="cell-off">关机</span>
            <span v-if="row.state.roomTemp !== undefined" class="cell-room">室温 {{ row.state.roomTemp }}°</span>
          </template>
        </div>

        <div class="cell-foot">
          <span v-if="!row.state.known" class="cell-mode dim">—</span>
          <span v-else class="cell-mode" :class="row.state.on ? 'm-' + row.state.mode : 'dim'">
            <component :is="modeIcon(row.state.mode)" :size="15" /> {{ modeLabel(row.state.mode) }}
            <i class="cell-fan">· {{ fanLabel(row.state.fan) }}</i>
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
.hv-head { display: flex; align-items: center; gap: 14px; flex: 0 0 auto; }
.hv-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 18px; font-weight: 600; color: var(--v2-text, #e8eef7); white-space: nowrap;
}

/* 楼层切换 —— 分段控件 (原来没定义, 吃的是浏览器默认按钮 = "80 年代按钮") */
.v2-tabs {
  display: inline-flex; gap: 4px; padding: 4px; flex: 0 0 auto;
  background: var(--v2-surface-2, #1b2534);
  border: 1px solid var(--v2-border, #26344a);
  border-radius: 12px;
}
.v2-tab {
  padding: 9px 22px; border-radius: 9px; border: none; cursor: pointer;
  font-size: 16px; font-weight: 500; line-height: 1;
  background: transparent; color: var(--v2-text-dim, #8fa3bd);
  transition: background .15s, color .15s;
}
.v2-tab:hover { color: var(--v2-text, #e8eef7); background: #26344a; }
.v2-tab.active {
  background: var(--v2-accent, #4da3ff); color: #04101d; font-weight: 700;
  box-shadow: 0 2px 10px #4da3ff55;
}
.hv-stats {
  display: flex; align-items: center; gap: 14px; margin-left: auto;
  font-size: 12px; color: var(--v2-text-dim, #8fa3bd);
}
.hv-stats span { display: inline-flex; align-items: center; gap: 4px; }
.hv-stats b { color: var(--v2-accent, #4da3ff); font-size: 14px; }
.hv-stats .warn { color: #e8b339; }
.hv-stats .dim { color: #6d7f98; }
.hv-stats .poll { color: #55637a; font-variant-numeric: tabular-nums; }
.hv-stats .poll.bad { color: #ff7875; }
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
  display: flex; flex-direction: column;
  padding: 12px 16px; text-align: left; cursor: pointer;
  min-height: 0; overflow: hidden;
  background: var(--v2-surface, #141c28);
  border: 2px solid var(--v2-border, #26344a);
  border-radius: 14px;
  transition: border-color .12s, background .12s, box-shadow .12s;
}
.hv-cell:hover { border-color: #3f5a80; }
/* 运行卡片: 有色底 + 左侧彩条, 关机卡片纯深灰 —— 开关机一眼可辨 */
.hv-cell.running {
  background: linear-gradient(160deg, #123049, #141c28);
  border-color: #2b4a63;
  box-shadow: inset 3px 0 0 #38a9e0;
}
/* 未知: 斜纹底 + 虚线框 —— 一眼跟"关机"区分开, 不靠颜色深浅 */
.hv-cell.unknown {
  border-style: dashed;
  border-color: #3c4a5e;
  background: repeating-linear-gradient(45deg, #141c28, #141c28 7px, #171f2c 7px, #171f2c 14px);
}
.hv-cell.fault { border-color: #a9541f; }
/* 选中态: 粗蓝边 + 蓝底 + 外发光, 三重冗余 —— 现场大屏斜着看也一眼分得清选没选 */
.hv-cell.sel {
  border-color: var(--v2-accent, #4da3ff);
  background: linear-gradient(160deg, #16375a, #12233a);
  box-shadow: 0 0 0 2px var(--v2-accent, #4da3ff), 0 6px 18px #0a1a2e88;
}

/* ---- 头部: 复选框 + 编号 + 运行徽标 ---- */
.cell-head { display: flex; align-items: center; gap: 8px; }
.cell-check {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; flex: 0 0 auto; border-radius: 6px;
  border: 2px solid #46566e; background: transparent; color: #04101d;
  transition: background .12s, border-color .12s;
}
.cell-check.on { background: var(--v2-accent, #4da3ff); border-color: var(--v2-accent, #4da3ff); }
.cell-tag { font-size: 14px; font-weight: 600; color: var(--v2-text-dim, #8fa3bd); letter-spacing: .3px; }
.cell-fault {
  display: inline-flex; align-items: center; gap: 3px; margin-left: auto;
  font-size: 13px; font-weight: 600; color: #ff9a52;
}
/* 运行状态做成文字徽标, 不是小圆点 —— 远处也读得出"运行/关/未知" */
.cell-dot {
  margin-left: auto; padding: 3px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 600; line-height: 1;
  background: #223044; color: #8fa3bd; flex: 0 0 auto;
}
.cell-dot.on { background: #17432b; color: #4fe08a; }
.cell-dot.unknown { background: transparent; border: 1px dashed #55637a; color: #8598b0; }
.cell-fault + .cell-dot { margin-left: 6px; }

/* ---- 名字 (可改) ---- */
.cell-name { display: flex; align-items: center; gap: 6px; margin-top: 8px; min-height: 28px; }
.cell-name-text {
  font-size: 21px; font-weight: 600; color: var(--v2-text, #e8eef7); line-height: 1.1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cell-edit { opacity: 0; padding: 3px; border-radius: 5px; color: var(--v2-text-dim, #8fa3bd); flex: 0 0 auto; }
.hv-cell:hover .cell-edit { opacity: .7; }
.cell-edit:hover { opacity: 1 !important; background: #ffffff22; }
.cell-name-input {
  width: 100%; font-size: 21px; font-weight: 600; padding: 2px 6px;
  color: var(--v2-text, #e8eef7); background: #0b1220;
  border: 2px solid var(--v2-accent, #4da3ff); border-radius: 6px; outline: none;
}

/* ---- 中段: 撑满剩余高度, 温度居中放大, 卡片再大也不空 ---- */
.cell-body {
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column; justify-content: center; gap: 4px;
}
.cell-temp { font-size: 46px; font-weight: 400; color: #eaf2ff; line-height: 1; letter-spacing: -1px; }
.cell-temp i { font-size: 20px; font-style: normal; opacity: .6; margin-left: 2px; }
.cell-room { font-size: 15px; color: #8ba0bd; }
/* 关机灰、运行彩 —— 灰/彩对比让开关机一眼可辨 */
.cell-off { font-size: 30px; font-weight: 300; color: #5b6b83; line-height: 1; }
.cell-unknown { font-size: 20px; color: #6d7f98; font-style: italic; }

/* 温度 / 模式标签按空调模式配色 */
.cell-temp.m-cool, .cell-mode.m-cool { color: #38d6ff; }   /* 制冷 冰蓝 */
.cell-temp.m-heat, .cell-mode.m-heat { color: #ff8a4d; }   /* 制热 暖橙 */
.cell-temp.m-fan,  .cell-mode.m-fan  { color: #4ce0be; }   /* 送风 青绿 */
.cell-temp.m-auto, .cell-mode.m-auto { color: #7db6ff; }   /* 自动 蓝 */
.cell-temp.m-dry,  .cell-mode.m-dry  { color: #9d8bff; }   /* 除湿 紫 */
.cell-temp.m-cool { text-shadow: 0 0 20px #38d6ff44; }
.cell-temp.m-heat { text-shadow: 0 0 20px #ff8a4d44; }

/* ---- 底部: 模式/风速 + 分区 ---- */
.cell-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.cell-mode {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 15px; font-weight: 500; color: #6db4ff; white-space: nowrap;
}
.cell-mode.dim { color: #55637a; }
.cell-fan { font-style: normal; opacity: .7; }
.cell-zone {
  font-size: 14px; color: var(--v2-text-dim, #8fa3bd);
  max-width: 55%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ---- 控制条 ---- */
/* 控制条: 触摸屏用, 按钮做大做够点得着 (目标高度 ~48px) */
.hv-bar {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 16px;
  padding: 12px 16px;
  background: var(--v2-surface, #141c28);
  border: 1px solid var(--v2-border, #26344a);
  border-radius: 14px;
}
.hv-bar.empty { opacity: .62; }
.bar-sel {
  display: flex; align-items: baseline; gap: 6px; min-width: 150px; max-width: 240px;
  font-size: 14px; color: var(--v2-text-dim, #8fa3bd);
}
.bar-sel b { font-size: 20px; color: var(--v2-accent, #4da3ff); }
.bar-names {
  font-size: 12px; color: #6d7f98;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bar-ctrl, .bar-group { display: flex; align-items: center; gap: 12px; flex-wrap: nowrap; }
.bar-group { flex-wrap: wrap; }
.bar-hint { font-size: 14px; color: var(--v2-text-dim, #8fa3bd); }
.bar-state {
  display: inline-flex; align-items: center; gap: 5px;
  margin-left: auto; font-size: 14px; color: #35d07f;
}

.bar-temp {
  display: flex; align-items: center; gap: 10px;
  padding: 5px 10px; border-radius: 12px;
  background: var(--v2-surface-2, #1b2534); border: 1px solid var(--v2-border, #26344a);
}
.temp-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; border-radius: 10px; cursor: pointer;
  background: #2a3a52; color: var(--v2-text, #e8eef7); border: none;
}
.temp-btn:hover:not(:disabled) { background: var(--v2-accent, #4da3ff); color: #04101d; }
.temp-btn:active:not(:disabled) { transform: scale(.94); }
.temp-btn:disabled { opacity: .35; cursor: not-allowed; }
.temp-val { font-size: 28px; font-weight: 400; min-width: 80px; text-align: center; color: var(--v2-text, #e8eef7); }
.temp-val i { font-size: 15px; font-style: normal; opacity: .55; }

.bar-seg {
  display: flex; gap: 3px; padding: 3px; border-radius: 12px;
  background: var(--v2-surface-2, #1b2534); border: 1px solid var(--v2-border, #26344a);
}
.seg {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 11px 16px; border-radius: 9px; cursor: pointer; border: none;
  font-size: 15px; font-weight: 500; background: transparent; color: var(--v2-text-dim, #8fa3bd);
  white-space: nowrap;
}
.seg:hover:not(:disabled) { color: var(--v2-text, #e8eef7); background: #26344a; }
.seg.on { background: var(--v2-accent, #4da3ff); color: #04101d; font-weight: 700; }
.seg:active:not(:disabled) { transform: scale(.96); }
.seg:disabled { opacity: .35; cursor: not-allowed; }

/* ---- 按钮 ---- */
.hv-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 16px; border-radius: 10px; cursor: pointer;
  font-size: 15px; font-weight: 500; white-space: nowrap;
  background: var(--v2-surface-2, #1b2534);
  border: 1px solid var(--v2-border, #26344a);
  color: var(--v2-text, #e8eef7);
}
.hv-btn:hover:not(:disabled) { border-color: var(--v2-accent, #4da3ff); }
.hv-btn:active:not(:disabled) { transform: scale(.97); }
.hv-btn:disabled { opacity: .35; cursor: not-allowed; }
.hv-btn.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
.hv-btn.danger { background: #3a2226; border-color: #6b2b32; color: #ff8f8f; }
.hv-btn.warn { border-color: #b8860055; color: #e8b339; }
.hv-btn.ghost.active { background: var(--v2-accent, #4da3ff); border-color: var(--v2-accent, #4da3ff); color: #04101d; }
.hv-btn.tiny { padding: 8px 14px; font-size: 14px; }

/* 控制条里的主/次动作按钮 (开/关) 是主操作, 再放大一档, 点得爽 */
.bar-ctrl .hv-btn.primary,
.bar-ctrl .hv-btn.danger {
  padding: 12px 26px; font-size: 17px; font-weight: 700; border-radius: 12px;
}

/* 1600 及以下: 6 列会挤, 降到 5 列 (22 台 = 5 行, 行高 ~170px). 温度收到 40px
   刚好在 5 行时不裁切, 而 10 台 (2 行) 时卡片高、40px 居中依然大气. */
@media (max-width: 1600px) {
  .hv-grid { grid-template-columns: repeat(5, 1fr); }
  .bar-names { display: none; }
  .cell-temp { font-size: 40px; }
  .cell-temp i { font-size: 18px; }
  .cell-off { font-size: 27px; }
}
/* 更窄: 4 列 → 22 台 6 行, 行更矮, 再收一档字, 保证不滚动 */
@media (max-width: 1280px) {
  .hv-grid { grid-template-columns: repeat(4, 1fr); }
  .hv-cell { padding: 10px 12px; }
  .cell-name-text { font-size: 18px; }
  .cell-temp { font-size: 32px; }
  .cell-off { font-size: 22px; }
  .cell-mode, .cell-zone, .cell-room { font-size: 13px; }
}
</style>
