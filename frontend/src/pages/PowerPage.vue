<script setup lang="ts">
import { computed, ref } from 'vue';
import { useActivePolling } from '@/composables/useActivePolling';
import { ElMessage, ElMessageBox } from 'element-plus';
import { haptics } from '@/services/haptics';
import { useRouter } from 'vue-router';
import { wsClient, type WsConnectionState } from '@/services/websocket.service';
import type { WsEvent } from '@/types/api';
import {
  ArrowLeft, Zap, Power, X, RefreshCw, Activity, Gauge, Lightbulb, Plug,
  MonitorPlay, Snowflake, Volume2, ChevronDown, Thermometer, Droplet,
  AlertTriangle, ShieldCheck, Clock,
} from 'lucide-vue-next';
import {
  powerCircuitsService,
  powerDomainsService,
  powerFloorsService,
  powerSchedulesService,
  type PowerCircuitView,
  type BreakerMeasurements,
  type PowerDomainView,
  type PowerFloorView,
} from '@/services/power-circuits.service';
import { usePermissionStore } from '@/stores/permission';
// 自动开关时间配置抽屉 —— 与后台「自动开关 / 硬件接线」页共用同一组件、同一接口；
// 前台电源页只做入口复用，后台配置页保持不动。
import PowerScheduleDrawer from '@/components/admin/PowerScheduleDrawer.vue';

const ICON_MAP: Record<string, typeof Zap> = {
  Zap, Lightbulb, Plug, MonitorPlay, Snowflake, Volume2,
};
function iconFor(name: string | null): typeof Zap {
  if (name && ICON_MAP[name]) return ICON_MAP[name];
  return Zap;
}

/** 4G 断路器 (华普云平台, gatewayCode 以 CB4G- 开头) vs 485 空开 */
function is4gBreaker(c: PowerCircuitView): boolean {
  return !!c.gatewayCode?.startsWith('CB4G-');
}

/** 易微联云开关 (gatewayCode 以 EWE- 开头): 仅合/分闸, 无电压电流遥测,
 *  不显示实时读数与空开详情 (点进去是一整排 0, 误导)。 */
function isCloudBreaker(c: PowerCircuitView): boolean {
  return !!c.gatewayCode?.startsWith('EWE-');
}

/** 有真实电力遥测的断路器 (485 / 4G / 华普云) 才显示 inline 读数与空开详情。 */
function hasReadings(c: PowerCircuitView): boolean {
  return c.isBreaker && !isCloudBreaker(c);
}

const circuits = ref<PowerCircuitView[]>([]);
const domains = ref<PowerDomainView[]>([]);
/** 分区字典（启用，后端按角色域过滤）；tab 名/排序以此为准，回路实际值兜底。 */
const floors = ref<PowerFloorView[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const busyIds = ref<Set<number>>(new Set());

// 域中文名兜底（后端 power-domains 字典优先；字典未就绪时用内置）。
const BUILTIN_DOMAIN_NAME: Record<string, string> = { hall: '展厅', park: '园区' };
function domainName(code: string): string {
  const d = domains.value.find((x) => x.code === code);
  return d?.name ?? BUILTIN_DOMAIN_NAME[code] ?? code;
}

async function loadCircuits(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    // 域字典与回路并行（后端都按角色域过滤，operator 只见展厅、config 只见园区）。
    const [rows, domainRows, floorRows] = await Promise.all([
      powerCircuitsService.list(),
      powerDomainsService.list().catch(() => [] as PowerDomainView[]),
      powerFloorsService.list().catch(() => [] as PowerFloorView[]),
    ]);
    circuits.value = rows;
    domains.value = domainRows;
    floors.value = floorRows;
    // 域 tab 校正：当前域不在可见范围则回到第一个域（多域角色才会出现域切换）。
    const doms = domainOptions.value;
    if (!doms.includes(domainTab.value) && doms.length > 0) {
      domainTab.value = doms[0];
    }
    const floorCodes = floorOptions.value;
    // 'all' 与有效楼层都保留; 只有未初始化('')或失效楼层才落首选楼层(时序器页)。
    if (floorTab.value !== 'all' && !floorCodes.includes(floorTab.value) && floorCodes.length > 0) {
      floorTab.value = preferredFloor.value;
    }
    // 自动开关"下次动作"展示 (定时/日落/日出) — 2026-10-01 4G 断路器
    void loadNextRuns();
  } catch (err) {
    loadError.value = (err as Error).message;
    ElMessage.error(`加载电源回路失败: ${loadError.value}`);
  } finally {
    loading.value = false;
  }
}

// ============ 自动开关 (定时 + 日落/日出) 下次动作展示 ============
// 只读: 每回路显示"下次 xx: HH:mm"; 配置在管理端 (PowerCircuitsAdmin)
const nextRunMap = ref<Record<number, { action: string; at: string }>>({});
async function loadNextRuns(): Promise<void> {
  const ids = circuits.value.map((c) => c.id);
  const next: Record<number, { action: string; at: string }> = {};
  // 串行轻量拉取, 失败静默 (展示性功能, 不阻塞电源页)
  for (const id of ids) {
    try {
      const r = await powerSchedulesService.nextRun(id);
      if (r) next[id] = { action: r.action, at: r.at };
    } catch { /* 静默 */ }
  }
  nextRunMap.value = next;
}
function fmtNextAt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
const NEXT_ACTION_LABEL: Record<string, string> = { on: '开', off: '关' };
/** 紧凑卡用的下次动作时间: 今天只显示 HH:MM, 跨天显示 M/D HH:MM (省卡片宽度) */
function fmtNextShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

// ============ 域 tab（第五轮：展厅 hall / 园区 park，可扩展新楼栋）============
// 后端已按角色域过滤：admin/hardware 拿到两域（显示域切换），operator 仅展厅、
// config 仅园区（单域，不显示域切换）。不提供"跨域全部"，一键通断只作用于当前域。
const domainTab = ref<string>('hall');
const domainOptions = computed<string[]>(() => {
  const set = new Set<string>();
  for (const c of circuits.value) set.add(c.domainCode);
  const order = (code: string): number => {
    const idx = domains.value.findIndex((d) => d.code === code);
    if (idx >= 0) return idx;
    if (code === 'hall') return 0;
    if (code === 'park') return 1;
    return 99;
  };
  return Array.from(set).sort((a, b) => order(a) - order(b));
});
/** 当前域内回路 —— 所有"全部/整层/时序"批量动作都限定在当前域，杜绝跨域全场断电。 */
const domainCircuits = computed(() => circuits.value.filter((c) => c.domainCode === domainTab.value));
function switchDomain(code: string): void {
  if (domainTab.value === code) return;
  domainTab.value = code;
  // 切域后优先落在时序器所在楼层 (最常用); 没有时序器则落第一个楼层
  floorTab.value = preferredFloor.value;
}

// 楼层 tab（仅基于当前域；首次加载自动落时序器所在楼层, 但不写死楼层名）
const floorTab = ref<string>(''); // ''=未初始化, 首次 loadCircuits 时落 preferredFloor; 'all' 合法保留
const floorOptions = computed<string[]>(() => {
  const dc = domainTab.value;
  const actual = Array.from(new Set(domainCircuits.value.map((c) => c.floor)));
  // 启用字典且该分区当前有回路：按 sortOrder 排序；tab 值仍为 code。
  const dict = floors.value
    .filter((f) => f.domainCode === dc && f.enabled && actual.includes(f.code))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f) => f.code);
  // 孤儿 / 停用兜底：字典缺失但回路实际存在，追加在后，保证 tab 不丢。
  for (const code of actual) if (!dict.includes(code)) dict.push(code);
  return dict;
});
/** 分区中文名：字典优先，回退回路自带 floorName，再回退 code。 */
function floorName(code: string, domainCode?: string): string {
  const dc = domainCode ?? domainTab.value;
  const f = floors.value.find((x) => x.domainCode === dc && x.code === code);
  if (f?.name) return f.name;
  const c = circuits.value.find((x) => x.domainCode === dc && x.floor === code);
  return c?.floorName || code;
}
/** 该域的首选楼层: 含时序器回路(audio-seq)的第一个楼层, 否则第一个楼层, 再否则 'all'。 */
const preferredFloor = computed<string>(() => {
  const seqFloor = floorOptions.value.find((f) =>
    domainCircuits.value.some((c) => c.floor === f && c.category === 'audio-seq'));
  return seqFloor ?? floorOptions.value[0] ?? 'all';
});
const filteredCircuits = computed(() => {
  if (floorTab.value === 'all') return domainCircuits.value;
  return domainCircuits.value.filter((c) => c.floor === floorTab.value);
});

/**
 * 渲染分组: 时序器回路按"设备(gatewayCode)"各自成组(每组带独立开关机按钮),
 * 其余普通回路(断路器/继电器/插座…)归一个普通组。这样两台时序器天然分开、
 * 互不混控, 且不依赖固定楼层名 (不写死 '音响'/'时序器')。
 */
interface RenderGroup {
  key: string;
  kind: 'seq' | 'plain';
  gatewayCode: string | null;
  gatewayName: string | null;
  rows: PowerCircuitView[];
}
const renderGroups = computed<RenderGroup[]>(() => {
  const seqGroups: RenderGroup[] = [];
  const seqMap = new Map<string, RenderGroup>();
  const plain: PowerCircuitView[] = [];
  for (const c of filteredCircuits.value) {
    if (c.category === 'audio-seq' && c.gatewayCode) {
      let g = seqMap.get(c.gatewayCode);
      if (!g) {
        g = {
          key: `seq:${c.gatewayCode}`,
          kind: 'seq',
          gatewayCode: c.gatewayCode,
          gatewayName: c.gatewayName,
          rows: [],
        };
        seqMap.set(c.gatewayCode, g);
        seqGroups.push(g);
      }
      g.rows.push(c);
    } else {
      plain.push(c);
    }
  }
  const out: RenderGroup[] = [];
  // 普通回路在前 (1F/2F 等楼层), 时序器设备组紧随其后, 保持 floor 自然顺序
  if (plain.length > 0) {
    out.push({ key: 'plain', kind: 'plain', gatewayCode: null, gatewayName: null, rows: plain });
  }
  for (const g of seqGroups) {
    if (g.rows.length > 0) out.push(g);
  }
  return out;
});

/** 组标题: 时序器用硬件名, 缺名时回退网关 code, 再不行用通用名。 */
function seqGroupTitle(g: RenderGroup): string {
  return g.gatewayName || g.gatewayCode || '电源时序器';
}

// 总览

// 单回路 on/off；返回是否成功；silent=true 时不弹单条错误 (批量调用统一汇总)
async function dispatchOne(c: PowerCircuitView, op: 'on' | 'off', silent = false): Promise<boolean> {
  const want = op === 'on';
  const prevOn = c.reading.on;
  // 已处于目标态: 幂等, 不重复下发 (后端也有同样保护, 这里提前省一次请求)
  if (prevOn === want) return true;
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
    return true;
  } catch (err) {
    const idx = circuits.value.findIndex((x) => x.id === c.id);
    if (idx >= 0) circuits.value[idx] = { ...circuits.value[idx], reading: { ...circuits.value[idx].reading, on: prevOn } };
    if (!silent) ElMessage.error(`${c.name} ${want ? '通电' : '断电'}失败: ${(err as Error).message}`);
    return false;
  } finally {
    busyIds.value.delete(c.id);
  }
}

// ============ 时序器 (按设备独立开/关机, 各带 gatewayCode) ============
// 全开/全关走该台时序 (EPO b3 / SEQ55 0D): 设备按各路设定延时依次通断, 保护功放。
// 两台各自独立, 不提供"全部时序器一起开/关" (业主 2026-10-18 明确要求)。
// 同一时刻只允许一台时序开关机, 用一个 busy 锁 (避免两套功放回路同时拉浪涌)。
const seqBusyGw = ref<string | null>(null);
async function seqAll(on: boolean, gatewayCode: string | null): Promise<void> {
  if (!gatewayCode) {
    ElMessage.warning('请指定要操作的时序器设备');
    return;
  }
  if (seqBusyGw.value || seqWindowGw.value) return;
  seqBusyGw.value = gatewayCode;
  try {
    if (on) await powerCircuitsService.seqAllOn(gatewayCode);
    else await powerCircuitsService.seqAllOff(gatewayCode);
    ElMessage.success(on ? '时序开机已下发, 各路按延时依次上电' : '时序关机已下发, 各路按延时依次断电');
    // 窗口期高频轮询(WS 推送的兜底): 逐路点亮 + 组头进度, 见 startSeqWindow
    startSeqWindow(gatewayCode, on);
  } catch (err) {
    ElMessage.error(`时序${on ? '开' : '关'}机失败: ${(err as Error).message}`);
  } finally {
    seqBusyGw.value = null;
  }
}

// ============ 时序动作窗口期 (逐路回显 + 进度, 两台口径一致) ============
// 设备按各路延时逐路通断(约 1~15s), 窗口期内每 1.5s 读一次快照(只读本后端快照,
// 不直接碰串口), 配合后端 WS 逐路广播, 让 8 路卡片一路一路点亮, 状态一眼可见;
// 同时组头显示"时序开机中 N/8"。窗口期 ~20s 覆盖整个时序动作, 结束后恢复正常。
const seqWindowGw = ref<string | null>(null);
const seqWindowOn = ref(true);
const seqWindowCount = ref(0);
let seqWindowTimer: ReturnType<typeof setInterval> | null = null;
let seqWindowStopTimer: ReturnType<typeof setTimeout> | null = null;
const SEQ_WINDOW_TICK_MS = 1_500;
const SEQ_WINDOW_TOTAL_MS = 20_000;

function startSeqWindow(gatewayCode: string, on: boolean): void {
  stopSeqWindow();
  seqWindowGw.value = gatewayCode;
  seqWindowOn.value = on;
  seqWindowCount.value = 0;
  const tick = async (): Promise<void> => {
    try {
      const rows = await powerCircuitsService.listFresh();
      circuits.value = rows;
      // 该台已到达目标态的路数, 驱动组头进度 N/8
      let n = 0;
      for (const c of rows) {
        if (c.gatewayCode === gatewayCode && c.reading.on === on) n += 1;
      }
      seqWindowCount.value = n;
    } catch { /* 静默: 下一 tick 自然刷新 */ }
  };
  void tick();
  seqWindowTimer = setInterval(() => { void tick(); }, SEQ_WINDOW_TICK_MS);
  seqWindowStopTimer = setTimeout(() => {
    stopSeqWindow();
    // 窗口结束: 绕过缓存直读最终稳态, 避免窗口期内非 fresh list 的陈旧快照回退
    void powerCircuitsService
      .listFresh()
      .then((rows) => { circuits.value = rows; })
      .catch(() => { void loadCircuits(); });
  }, SEQ_WINDOW_TOTAL_MS);
}
function stopSeqWindow(): void {
  if (seqWindowTimer) { clearInterval(seqWindowTimer); seqWindowTimer = null; }
  if (seqWindowStopTimer) { clearTimeout(seqWindowStopTimer); seqWindowStopTimer = null; }
  seqWindowGw.value = null;
}

// ============ 行内改名 (每一路名称业主可自定义) ============
// script setup 里的局部指令: <input v-focus> 挂载即聚焦 (动态插入的输入框 autofocus 不可靠)
const vFocus = { mounted: (el: HTMLElement) => el.focus() };
const renamingId = ref<number | null>(null);
const renameDraft = ref('');
function startRename(c: PowerCircuitView): void {
  renamingId.value = c.id;
  renameDraft.value = c.name;
}
async function commitRename(c: PowerCircuitView): Promise<void> {
  const name = renameDraft.value.trim();
  renamingId.value = null;
  if (!name || name === c.name) return;
  try {
    const updated = await powerCircuitsService.rename(c.id, name);
    const idx = circuits.value.findIndex((x) => x.id === c.id);
    if (idx >= 0) circuits.value[idx] = updated;
    ElMessage.success('已改名');
  } catch (err) {
    ElMessage.error(`改名失败: ${(err as Error).message}`);
  }
}

// 空开专属详情 (三相分相 + 温度 + 漏电 + 报警) — 只对 isBreaker 回路, 点开才拉
const expandedId = ref<number | null>(null);
const breakerDetail = ref<Record<number, BreakerMeasurements>>({});
const breakerLoading = ref<Set<number>>(new Set());

async function toggleBreaker(c: PowerCircuitView): Promise<void> {
  haptics.tap(); // A2: 开关下发

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
  const want = op === 'on';
  const verb = want ? '通电' : '断电';
  // 幂等: 已处于目标态的跳过, 只下发需要变化的
  const pending = targets.filter((c) => c.reading.on !== want);
  const skipped = targets.length - pending.length;
  if (pending.length === 0) {
    ElMessage.success(`${verb}: ${skipped} 路均已处于该状态, 无需操作`);
    return;
  }
  let okCount = 0;
  let failCount = 0;
  for (const c of pending) {
    const ok = await dispatchOne(c, op, true); // 静默, 末尾统一汇总
    if (ok) okCount += 1;
    else failCount += 1;
  }
  const skipPart = skipped > 0 ? `, ${skipped} 路已在该状态跳过` : '';
  if (failCount === 0) ElMessage.success(`${verb}完成: ${okCount} 路成功${skipPart}`);
  else ElMessage.warning(`${verb}: ${okCount} 路成功, ${failCount} 路失败${skipPart}`);
}

/** 全场/整层通断电必须二次确认 (2026-07-25 生产级整改, 同空调页口径):
 *  "全部断电"是全系统后果最重的一键 — 切断全场供电, 误碰不可接受。 */
async function confirmPower(scope: string, count: number, on: boolean): Promise<boolean> {
  try {
    await ElMessageBox.confirm(
      `确定${on ? '通电' : '断电'}${scope}共 ${count} 路?将逐路下发。`,
      on ? '通电确认' : '断电确认',
      { type: 'warning', confirmButtonText: on ? '通电' : '断电', cancelButtonText: '取消' },
    );
    return true;
  } catch { return false; }
}
/** "全部"不含时序回路 —— 那 8 路只能走时序开/关机 (b3), 逐路 b2 会绕开功放保护；
 *  且只统计当前域（第五轮）：展厅/园区一键互不越界。 */
const nonSeqCircuits = computed(() => domainCircuits.value.filter((c) => c.category !== 'audio-seq'));
async function allOn(): Promise<void> {
  if (!(await confirmPower(`${domainName(domainTab.value)}全部楼层`, nonSeqCircuits.value.length, true))) return;
  ElMessage.info(`${domainName(domainTab.value)}全部通电 — 逐路下发 (${nonSeqCircuits.value.length} 路, 时序回路请用时序开机)`);
  await dispatchMany(nonSeqCircuits.value, 'on');
}
async function allOff(): Promise<void> {
  if (!(await confirmPower(`${domainName(domainTab.value)}全部楼层`, nonSeqCircuits.value.length, false))) return;
  ElMessage.warning(`${domainName(domainTab.value)}全部断电 — 逐路下发 (${nonSeqCircuits.value.length} 路, 时序回路请用时序关机)`);
  await dispatchMany(nonSeqCircuits.value, 'off');
}
/** 当前楼层 tab 内的"普通回路"(排除时序器) — 本层通/断电只动这些;
 *  时序器回路只能走组头专用的时序开机/关机 (b3/0D 功放保护), 不允许逐路 b2。 */
const floorPlainRows = computed(() =>
  filteredCircuits.value.filter((c) => c.category !== 'audio-seq'));
async function floorOn(): Promise<void> {
  if (floorPlainRows.value.length === 0) return;
  const label = floorName(floorTab.value);
  if (!(await confirmPower(label, floorPlainRows.value.length, true))) return;
  ElMessage.info(`${label} 通电 — 逐路下发 (${floorPlainRows.value.length} 路)`);
  await dispatchMany(floorPlainRows.value, 'on');
}
async function floorOff(): Promise<void> {
  if (floorPlainRows.value.length === 0) return;
  const label = floorName(floorTab.value);
  if (!(await confirmPower(label, floorPlainRows.value.length, false))) return;
  ElMessage.warning(`${label} 断电 — 逐路下发 (${floorPlainRows.value.length} 路)`);
  await dispatchMany(floorPlainRows.value, 'off');
}

// 实时刷新 — 每 10 秒拉一次最新读数 (服务端读数缓存 10s, 轮询基本走缓存, 不打爆云)
let refreshTimer: ReturnType<typeof setInterval> | null = null;
function startRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
  if (document.hidden) return; // C3: 页面在后台不打设备

    if (!loading.value && busyIds.value.size === 0 && !seqWindowGw.value) {
      void powerCircuitsService.list().then((rows) => {
        circuits.value = rows;
      }).catch(() => { /* 静默 */ });
      // 展开着的空开详情也顺带刷新 (三相/温度实时变化)
      if (expandedId.value != null) void loadBreaker(expandedId.value);
    }
  }, 10_000);
}
function stopRefresh(): void {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

const router = useRouter();
const perm = usePermissionStore();
function goBack(): void { router.push({ name: 'dashboard' }); }

// ============ 自动开关时间配置（前台直接配置，复用后台抽屉）============
// 入口仅对"智能断路器 + 有 power-timing 写权限"的角色显示：admin/config/hardware。
// operator（仅展厅域、无定时权限）不显示；config 只在园区、admin/hardware 全域。
// 与后台 AutoSwitchAdmin 列表口径一致（c.isBreaker），不按回路名硬编码，未来新增
// 楼栋/区域的断路器自动带入口。
const schedRef = ref<InstanceType<typeof PowerScheduleDrawer> | null>(null);
const canSchedule = computed<boolean>(() => perm.canWriteModule('power-timing'));
// 电源页是否可操作（单路手动通断 + 定时），用于整页只读 gate：
// canExecute（admin/operator）并上 power-timing 写（admin/hardware/config）= admin/operator/hardware/config。
// 这两个纯后台角色第六轮起落地前台电源页（不再自动进后台）。可见回路与能否写某一域由后端按
// 角色域强制（hardware 全域、config 仅园区、operator 仅展厅），前端只决定是否进只读；
// viewer 不在并集 → 整页只读。批量全部/楼层/时序/改名仍仅 admin（canEdit 单独 gate）。
const canControlPower = computed<boolean>(() => perm.canExecute || perm.canWriteModule('power-timing'));
function openSchedule(c: PowerCircuitView): void {
  schedRef.value?.open(c);
}
/** 抽屉里增删改/启停后静默刷新回路与"下次动作"（不触发整页 loading，避免卡片闪动）。 */
async function onScheduleChanged(): Promise<void> {
  try {
    const rows = await powerCircuitsService.list();
    circuits.value = rows;
    await loadNextRuns();
  } catch { /* 静默：下次轮询自然刷新 */ }
}

// 2026-07-27 切页卡顿根治: keep-alive 下 onUnmounted 不触发, 轮询切走后永续后台
// 运行。改 useActivePolling — 在本页才刷新, 切走即停; 回页立即 loadCircuits。
// 2026-10-01 彻底版: 优先走 WS 推送 (后台 10s 预采集, power_reading), WS 在线
// 零轮询; 断线才用 10s setInterval 兜底。
let unsubWs: (() => void) | null = null;
let unsubState: (() => void) | null = null;

function handlePowerReading(e: WsEvent): void {
  if (e.type !== 'power_reading') return;
  const idx = circuits.value.findIndex(
    (c) => c.id === e.circuitId || (e.code !== '' && c.code === e.code),
  );
  if (idx < 0) return;
  circuits.value[idx] = { ...circuits.value[idx], reading: { ...e.reading } };
  // 窗口期内: WS 实时点亮某路，立即同步组头进度 N/8，避免 chip 等下一个 tick 滞后约 1.5s
  if (seqWindowGw.value && circuits.value[idx].gatewayCode === seqWindowGw.value) {
    let n = 0;
    for (const c of circuits.value) {
      if (c.gatewayCode === seqWindowGw.value && c.reading.on === seqWindowOn.value) n += 1;
    }
    seqWindowCount.value = n;
  }
}

function handleWsState(s: WsConnectionState): void {
  if (s === 'open') stopRefresh(); // WS 在线: 推送即可, 停轮询
  else startRefresh(); // 断线/连接中: 轮询兜底
}

function startPolling(): void {
  void loadCircuits();
  if (!unsubWs) unsubWs = wsClient.on(handlePowerReading);
  if (!unsubState) unsubState = wsClient.onState(handleWsState); // 注册即按当前态决定
}
function stopPolling(): void {
  stopRefresh();
  stopSeqWindow();
  unsubWs?.(); unsubWs = null;
  unsubState?.(); unsubState = null;
}
useActivePolling(startPolling, stopPolling);
</script>

<template>
  <section class="v2-page" :class="{ 'device-readonly': !canControlPower }">
    <!-- 页面头部 -->
    <header class="v2-page-head">
      <div class="back-row">
        <button class="v2-back-btn" @click="goBack" title="返回首页">
          <ArrowLeft :size="18" :stroke-width="2" />
        </button>
        <div class="title-block">
          <div class="title"><Zap :size="18" :stroke-width="1.8" /> 电源管理<span v-if="!canControlPower" class="device-readonly-chip">只读</span></div>
        </div>
        <!-- 域一级切换（第五轮）：仅多域角色 admin/hardware 显示；单域角色锁定唯一域。
             一键通断只作用于当前域，不提供跨域"全部"。 -->
        <div v-if="domainOptions.length > 1" class="v2-tabs v2-domain-tabs">
          <button
            v-for="d in domainOptions"
            :key="d"
            class="v2-tab domain-tab"
            :class="{ active: domainTab === d }"
            @click="switchDomain(d)"
          >{{ domainName(d) }}</button>
        </div>
        <div class="v2-tabs">
          <button
            v-for="f in floorOptions"
            :key="f"
            class="v2-tab"
            :class="{ active: floorTab === f }"
            @click="floorTab = f"
          >{{ floorName(f) }}</button>
          <button class="v2-tab" :class="{ active: floorTab === 'all' }" @click="floorTab = 'all'">全部</button>
        </div>
        <!-- 手机端: 刷新并入楼层 tab 行右侧(见 .refresh-mobile), 避免另起一行把卡片下推;
             桌面端隐藏此按钮, 仍用右侧操作组里的那颗刷新 -->
        <button class="v2-quick refresh-mobile" @click="loadCircuits" :disabled="loading" title="刷新">
          <RefreshCw :size="14" :stroke-width="2" />
        </button>
      </div>
      <div class="quick-actions">
        <button class="v2-quick refresh-desktop" @click="loadCircuits" :disabled="loading" title="重新加载">
          <RefreshCw :size="14" :stroke-width="2" />
        </button>
        <!-- 时序开/关机按钮已下移到各"设备组"组头 —— 两台时序器各自独立,
             顶部不再放"全部时序器一起开/关"的全局按钮 (业主 2026-10-18 要求)。 -->
        <!-- 楼层 tab = 本层通/断电 (只动普通回路; 纯时序器楼层无普通回路 → 自动隐藏);
             全部 tab = 全部通/断电 (已跳过时序回路, 那 8 路必须走时序保护)。 -->
        <button
          v-if="perm.canEdit && floorTab !== 'all' && floorPlainRows.length > 0"
          class="v2-quick primary"
          @click="floorOn"
          :disabled="loading || floorPlainRows.length === 0"
        >
          <Power :size="14" :stroke-width="2" /> {{ floorName(floorTab) }} 通电
        </button>
        <button
          v-if="perm.canEdit && floorTab !== 'all' && floorPlainRows.length > 0"
          class="v2-quick danger"
          @click="floorOff"
          :disabled="loading || floorPlainRows.length === 0"
        >
          <X :size="14" :stroke-width="2" /> {{ floorName(floorTab) }} 断电
        </button>
        <button v-if="perm.canEdit && floorTab === 'all'" class="v2-quick primary" @click="allOn" :disabled="loading || domainCircuits.length === 0" :title="domainName(domainTab) + '全部通电 (仅当前区域, 时序回路走时序开机)'">
          <Power :size="14" :stroke-width="2" /> {{ domainName(domainTab) }} 全部通电
        </button>
        <button v-if="perm.canEdit && floorTab === 'all'" class="v2-quick danger" @click="allOff" :disabled="loading || domainCircuits.length === 0" :title="domainName(domainTab) + '全部断电 (仅当前区域, 时序回路走时序关机)'">
          <X :size="14" :stroke-width="2" /> {{ domainName(domainTab) }} 全部断电
        </button>
      </div>
    </header>

    <!-- 总览卡已删 (2026-07-25 业主: 没什么用途, 腾空间) -->

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

    <!-- 回路网格: 按设备分组渲染。时序器每台一个"设备组"(组头带独立开机/关机按钮),
         普通回路归一个普通组; 卡片 markup 只写一份, 两组复用。 -->
    <div v-else class="render-stack">
      <div v-for="g in renderGroups" :key="g.key" class="render-group">
        <!-- 时序器设备组头: 设备名 + 该台独立时序开机/关机 (两台互不混控) -->
        <div v-if="g.kind === 'seq'" class="seq-device-head">
          <div class="seq-device-name">
            <Power :size="16" :stroke-width="2" />
            <span class="seq-device-title">{{ seqGroupTitle(g) }}</span>
            <span class="seq-device-count">{{ g.rows.length }} 路</span>
            <!-- 时序动作窗口期: 进度提示 N/8, 开机绿色 / 关机琥珀, 旋转图标一眼可见 -->
            <span
              v-if="seqWindowGw === g.gatewayCode"
              class="seq-window-chip"
              :class="seqWindowOn ? 'on' : 'off'"
            >
              <RefreshCw :size="12" :stroke-width="2.4" class="spin" />
              时序{{ seqWindowOn ? '开机' : '关机' }}中 {{ seqWindowCount }}/{{ g.rows.length }}
            </span>
          </div>
          <div v-if="perm.canEdit" class="seq-device-actions">
            <button
              class="v2-quick primary"
              :disabled="seqBusyGw !== null || seqWindowGw !== null"
              title="各路按设定延时依次上电, 保护功放"
              @click="seqAll(true, g.gatewayCode)"
            >
              <Power :size="14" :stroke-width="2" /> 时序开机
            </button>
            <button
              class="v2-quick danger"
              :disabled="seqBusyGw !== null || seqWindowGw !== null"
              title="先开的后关, 按延时依次断电"
              @click="seqAll(false, g.gatewayCode)"
            >
              <Power :size="14" :stroke-width="2" /> 时序关机
            </button>
          </div>
        </div>
        <!-- 组内卡片网格: 时序器组一行两卡 (seq-grid, 8 路一屏放全), 普通组自适应 -->
        <div class="circuit-grid" :class="{ 'seq-grid': g.kind === 'seq' }">
          <div
            v-for="c in g.rows"
            :key="c.id"
            class="circuit-card"
            :class="{ on: c.reading.on, breaker: c.isBreaker, cloud: isCloudBreaker(c), seq: c.category === 'audio-seq' }"
          >
        <!-- 行 1：图标 + 名称(总闸) + 规格 + 定时 + 开关 -->
        <div class="cc-row1">
          <div class="cc-ico"><component :is="iconFor(c.icon)" :size="20" :stroke-width="1.8" /></div>
          <div class="cc-meta">
            <div class="cc-name">
              <!-- 行内改名: 点名字直接编辑 (业主自定义每一路名称), 回车/失焦保存 -->
              <input
                v-if="renamingId === c.id"
                v-model="renameDraft"
                class="rename-input"
                maxlength="32"
                @keyup.enter="commitRename(c)"
                @blur="commitRename(c)"
                @keyup.esc="renamingId = null"
                v-focus
              />
              <!-- 回路改名走 zones 写权限（仅 admin）；operator 可单路开关但不能改名。 -->
              <span
                v-else
                class="name-text"
                :class="{ 'name-renamable': perm.canEdit }"
                :title="perm.canEdit ? '点击改名' : c.name"
                @click="perm.canEdit && startRename(c)"
              >{{ c.name }}</span>
              <span v-if="hasReadings(c)" class="breaker-badge" title="智能断路器 · 远程物理总闸">总闸</span>
            </div>
            <!-- 规格行: 时序器每路无独立额定规格, 不显示 -->
            <div v-if="c.category !== 'audio-seq'" class="cc-sub">{{ c.floorName || c.floor }} · {{ c.ratedVoltage }}V {{ c.ratedCurrent }}A</div>
          </div>
          <!-- 自动开关时间配置入口（手动开关正左侧）：仅智能断路器(含云开关) + 有权限角色可见。
               已设启用规则(有下次动作)时主题色高亮 + 右上角蓝点。 -->
          <button
            v-if="c.isBreaker && canSchedule"
            class="schedule-btn"
            :class="{ set: !!nextRunMap[c.id] }"
            @click="openSchedule(c)"
            :title="nextRunMap[c.id] ? '编辑自动开关时间' : '设置自动开关时间'"
          >
            <Clock :size="17" :stroke-width="2" />
          </button>
          <button
            class="v2-toggle"
            :class="{ on: c.reading.on }"
            :disabled="busyIds.has(c.id)"
            @click="dispatchOne(c, c.reading.on ? 'off' : 'on')"
            :title="c.reading.on ? '断电' : '通电'"
          ></button>
        </div>

        <!-- 行 2：状态 + 自动下次动作 + 一行 inline 读数 / 云开关标 / 通道 + 详情 -->
        <div class="cc-row2">
          <span class="cc-state" :class="c.reading.on ? 'on' : 'off'">
            <i class="dot"></i>{{ c.reading.on ? '已通电' : '已断电' }}
          </span>
          <!-- 自动开关下次动作 (定时/日落/日出), 紧凑显示"关 22:00" -->
          <span
            v-if="nextRunMap[c.id]"
            class="cc-auto"
            :class="nextRunMap[c.id].action"
            :title="'自动开关: 下次' + (nextRunMap[c.id].action === 'on' ? '通电' : '断电') + ' ' + fmtNextAt(nextRunMap[c.id].at)"
          >
            <Clock :size="11" :stroke-width="2.2" />{{ NEXT_ACTION_LABEL[nextRunMap[c.id].action] }} {{ fmtNextShort(nextRunMap[c.id].at) }}
          </span>
          <!-- 有遥测的断路器: 一行读数(电流/功率/累计, 电压在详情) + 详情 -->
          <template v-if="hasReadings(c)">
            <span class="cc-read v2-inter">
              <b>{{ c.reading.current.toFixed(2) }}</b>A · <b>{{ Math.round(c.reading.power) }}</b>W · <b>{{ c.reading.energy.toFixed(1) }}</b>kWh
            </span>
            <button
              class="detail-toggle"
              :class="{ open: expandedId === c.id }"
              @click="toggleBreaker(c)"
              :title="expandedId === c.id ? '收起空开详情' : '展开空开详情'"
            >
              详情 <ChevronDown :size="13" :stroke-width="2.2" />
            </button>
          </template>
          <!-- 云开关无遥测: 只标类型, 不显示读数/详情 -->
          <span v-else-if="isCloudBreaker(c)" class="cc-kind cloud">云开关</span>
          <!-- 普通继电器 / 时序器: 通道号 -->
          <span v-else-if="c.relayChannel != null" class="cc-kind">CH {{ c.relayChannel }}</span>
        </div>

        <!-- 空开专属详情: 三相分相(含电压) + 温度 + 漏电 + 报警; 云开关无遥测不展开 -->
        <div v-if="hasReadings(c) && expandedId === c.id" class="breaker-detail">
          <div class="bd-title">{{ is4gBreaker(c) ? '4G' : '485' }} 智能断路器 · 实时遥测（电压 / 三相 / 温度 / 漏电）</div>
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
      </div>
    </div>

    <!-- 自动开关时间配置：复用后台抽屉（无定时写权限的角色不渲染卡片入口） -->
    <PowerScheduleDrawer ref="schedRef" @changed="onScheduleChanged" />
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
  font-size: 20px;
  font-weight: 700;
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

/* 域一级切换（第五轮）：比楼层 tab 更醒目，用主色实底 + 轻微辉光，区分两个层级 */
.v2-domain-tabs {
  margin-left: 0;
  position: relative;
}
.v2-domain-tabs .domain-tab {
  font-weight: 700;
  letter-spacing: 1px;
  padding: 5px 18px;
}
.v2-domain-tabs .domain-tab.active {
  background: var(--v2-primary);
  color: #fff;
  box-shadow: 0 0 0 1px var(--v2-primary), 0 2px 10px -2px var(--v2-primary);
}
@media (max-width: 720px) {
  .v2-domain-tabs .domain-tab { padding: 5px 14px; }
}

.quick-actions { display: flex; gap: var(--v2-sp-2); }
/* 手机端专用的刷新按钮(并入楼层 tab 行), 桌面端隐藏 */
.refresh-mobile { display: none; }
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
  color: var(--v2-text-1);
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
/* 时序回路 (简洁开关卡) 任何宽度都两列起步, 手机 8 路一屏放全 */
.circuit-grid.seq-grid { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 1280px) { .circuit-grid.seq-grid { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 720px) {
  .circuit-grid.seq-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .circuit-grid.seq-grid .circuit-card { padding: 10px 12px; gap: 6px; }
  .circuit-grid.seq-grid .cc-ico { display: none; }
  .circuit-grid.seq-grid .cc-row2 { padding-left: 0; }
  .circuit-grid.seq-grid .cc-name { font-size: 13px; }
  .circuit-grid.seq-grid .cc-state { font-size: 11px; }
}

/* ============ 设备分组: 每台时序器独立成组, 组头带独立开/关机 ============ */
.render-stack {
  display: flex;
  flex-direction: column;
  gap: var(--v2-sp-4);
}
.render-group {
  display: flex;
  flex-direction: column;
  gap: var(--v2-sp-3);
}
.seq-device-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--v2-sp-3);
  flex-wrap: wrap;
  padding: 10px 14px;
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1);
}
.seq-device-name {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--v2-text-1);
  font-size: 15px;
  font-weight: 600;
}
.seq-device-title { line-height: 1.2; }
.seq-device-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--v2-text-2);
  background: var(--v2-surf-2);
  border-radius: 999px;
  padding: 2px 9px;
}
/* 时序动作窗口期进度 chip: 开机绿 / 关机琥珀, 旋转图标, 一眼可见 */
.seq-window-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.3px;
  padding: 2px 10px;
  border-radius: 999px;
  white-space: nowrap;
}
.seq-window-chip.on {
  color: #5FCB9B;
  background: rgba(63, 191, 135, 0.14);
  border: 1px solid rgba(63, 191, 135, 0.4);
}
.seq-window-chip.off {
  color: #F0B35C;
  background: rgba(244, 180, 80, 0.12);
  border: 1px solid rgba(244, 180, 80, 0.4);
}
.seq-window-chip .spin { animation: seqWinSpin 0.9s linear infinite; }
@keyframes seqWinSpin { to { transform: rotate(360deg); } }
.seq-device-actions {
  display: flex;
  gap: 8px;
}
@media (max-width: 720px) {
  .seq-device-head { padding: 8px 10px; gap: 8px; }
  .seq-device-actions { width: 100%; }
  .seq-device-actions .v2-quick { flex: 1; justify-content: center; }
}

@media (max-width: 600px)  {
  .v2-page { padding: var(--v2-sp-3); gap: var(--v2-sp-3); }
  .v2-overview { padding: var(--v2-sp-3); gap: var(--v2-sp-2); grid-template-columns: 1fr 1fr; }
  .ov-value { font-size: 18px; }
  .ov-ico { width: 32px; height: 32px; }
  .circuit-card { padding: 10px 12px; gap: 7px; }
  .cc-ico { width: 32px; height: 32px; border-radius: 9px; }
  .cc-row2 { padding-left: 42px; }
  .cc-name { font-size: 14px; }
  .cc-sub { font-size: 10px; }
  .cc-read { font-size: 10.5px; }
  .quick-actions { flex-wrap: wrap; }
  /* 刷新按钮并入楼层 tab 行: 隐藏右侧操作组里的那颗, 显示 back-row 内的那颗并推到行尾 */
  .quick-actions .refresh-desktop { display: none; }
  .refresh-mobile {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    align-self: center;
    margin-left: auto;
    width: 38px;
    height: 38px;
  }
  .schedule-btn { width: 36px; height: 36px; }
  .v2-toggle { width: 44px; height: 26px; }
  .v2-toggle::after { width: 22px; height: 22px; }
  .v2-toggle.on::after { transform: translateX(18px); }
}

.circuit-card {
  position: relative;
  padding: 10px 12px;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
  transition: transform 0.22s ease, background-color 0.22s ease,
    border-color 0.22s ease, box-shadow 0.22s ease;
}
/* hover：边框加深；轻微上浮与阴影由 design-tokens 全站统一控制。
   不再使用旧的紫色发光顶线与白色投影（中性 indigo 体系下显脏、不统一）。 */
.circuit-card:hover {
  border-color: var(--v2-border-strong);
}
/* 通电卡: 品类青绿状态光 (2026-07-25 D1) —— 之前是中性白光, 通电/断电只差
   一点亮度, 扫一眼分不出。改成左光条 + 低饱和青绿辉光, "活着"一眼可见。 */
.circuit-card.on {
  border-color: color-mix(in srgb, var(--v2-live-power) 35%, var(--v2-border-soft));
  background: linear-gradient(135deg, var(--v2-live-power-glow), transparent 60%), var(--v2-surf-1);
  box-shadow:
    inset 3px 0 0 var(--v2-live-power),
    inset 0 1px 0 var(--v2-card-hairline),
    0 8px 32px -8px var(--v2-live-power-glow) !important;
}

/* ============ 行 1：图标 + 名称(总闸) + 规格 + 定时 + 开关 ============ */
.cc-row1 { display: flex; align-items: center; gap: 10px; }
.cc-ico {
  width: 36px; height: 36px;
  border-radius: 10px;
  background: var(--v2-purple-soft);
  color: var(--v2-text-2);
  display: grid; place-items: center;
  flex-shrink: 0;
  transition: all 0.22s ease;
}
.circuit-card.on .cc-ico {
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
}
.cc-meta { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cc-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--v2-text-1);
  letter-spacing: 0.2px;
  min-width: 0;
}
/* 行内改名: 名字可点; 超长省略号 */
.cc-name .name-text {
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cc-name .name-text:hover { text-decoration: underline dotted; text-underline-offset: 3px; }
.rename-input {
  width: 100%;
  max-width: 180px;
  font-size: 14px;
  font-weight: 600;
  color: var(--v2-text-1);
  background: var(--v2-bg-2, rgba(0,0,0,0.2));
  border: 1px solid var(--v2-primary);
  border-radius: 6px;
  padding: 2px 8px;
  outline: none;
}
.cc-sub {
  font-size: 11px;
  color: var(--v2-text-3);
  letter-spacing: 0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

/* 自动开关时间配置入口（时钟按钮，位于手动开关正左侧；紧凑卡尺寸） */
.schedule-btn {
  position: relative;
  width: 36px; height: 36px;
  flex-shrink: 0;
  display: grid; place-items: center;
  padding: 0;
  border-radius: var(--v2-r-md);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-2);
  color: var(--v2-text-2);
  cursor: pointer;
  transition: color .2s ease, border-color .2s ease, background-color .2s ease, box-shadow .2s ease, transform .1s ease;
}
.schedule-btn:hover { color: var(--v2-primary); border-color: var(--v2-primary); }
.schedule-btn:active { transform: scale(0.94); }
/* 已设启用规则：主题色高亮 + 右上角蓝点（与卡片"自动关 xx:xx"chip 同源于 nextRunMap） */
.schedule-btn.set {
  color: var(--v2-primary);
  border-color: color-mix(in srgb, var(--v2-primary) 55%, var(--v2-border-soft));
  background: var(--v2-primary-soft);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--v2-primary) 30%, transparent),
    0 0 14px -2px color-mix(in srgb, var(--v2-primary) 50%, transparent);
}
.schedule-btn.set::after {
  content: '';
  position: absolute; top: 5px; right: 5px;
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--v2-primary);
  box-shadow: 0 0 6px color-mix(in srgb, var(--v2-primary) 80%, transparent);
}

/* ============ 行 2：状态 + 自动动作 + 一行读数/类型 + 详情 ============ */
.cc-row2 {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 46px; /* 对齐行 1 名称（图标 36 + gap 10） */
  min-height: 20px;
}
.cc-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--v2-text-3);
  white-space: nowrap;
  flex-shrink: 0;
}
.cc-state .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex: 0 0 auto;
}
.cc-state.off .dot { opacity: 0.5; }
.cc-state.on { color: var(--v2-success, #3FBF87); }
.cc-state.on .dot {
  box-shadow: 0 0 6px rgba(107, 255, 185, 0.9);
  animation: statePulse 2s ease-in-out infinite;
}
@keyframes statePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* 自动下次动作小标签（定时/日落/日出），紧凑显示 "关 22:00" */
.cc-auto {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-ov-1);
  color: var(--v2-text-2);
  white-space: nowrap;
  flex-shrink: 0;
}
.cc-auto.on  { background: rgba(63, 191, 135, 0.14); color: #5FCB9B; border-color: rgba(63, 191, 135, 0.38); }
.cc-auto.off { background: rgba(244, 180, 80, 0.12); color: #F0B35C; border-color: rgba(244, 180, 80, 0.38); }

/* 一行 inline 读数：电流 / 功率 / 累计（电压移到空开详情） */
.cc-read {
  margin-left: auto;
  font-size: 11px;
  color: var(--v2-text-3);
  letter-spacing: 0.2px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cc-read b { color: var(--v2-text-1); font-weight: 600; }
.circuit-card.on .cc-read { color: var(--v2-text-2); }

/* 类型小标：云开关 / 通道号（无遥测回路，靠右） */
.cc-kind {
  margin-left: auto;
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-ov-1);
  color: var(--v2-text-3);
  white-space: nowrap;
  flex-shrink: 0;
}
.cc-kind.cloud {
  border-color: rgba(56, 189, 248, 0.35);
  background: rgba(56, 189, 248, 0.12);
  color: #38bdf8;
}

/* ============ 空开专属: 总闸标记 + 详情面板 ============ */
/* 空开断路器卡不套琥珀描边（旧 warning-soft 在深色背景上显一圈脏线，曾被反复要求清理）：
   断电卡靠底色差 + 顶部内高光 + 下沉阴影分层，边框仍占 1px 但置透明，不引起布局跳动；
   通电卡(.on) 不受此规则影响，保留 .circuit-card.on 的青绿描边与左光条作为“活着”的状态信号。 */
.circuit-card.breaker:not(.on),
.circuit-card.breaker:not(.on):hover { border-color: transparent; }
.breaker-badge {
  display: inline-block;
  flex-shrink: 0;
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
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
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
.bd-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--v2-text-3);
  display: flex;
  align-items: center;
  gap: 6px;
}
.bd-title::before {
  content: '';
  width: 4px; height: 12px;
  border-radius: 2px;
  background: var(--v2-primary);
  flex: 0 0 auto;
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
