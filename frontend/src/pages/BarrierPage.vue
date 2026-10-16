<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowLeft, CarFront, DoorOpen, DoorClosed, RefreshCw, AlertTriangle, ShieldCheck, Ban,
  Plus, Trash2, LogIn, LogOut, Users, Truck, User, History, Search,
  Clock,
} from 'lucide-vue-next';
import { useActivePolling } from '@/composables/useActivePolling';
import { wsClient, type WsConnectionState } from '@/services/websocket.service';
import type { WsEvent } from '@/types/api';
import {
  lprService, LPR_GROUPS,
  type LprDevice, type LprPassRecord, type LprWhitelist, type LprStats,
} from '@/services/lpr.service';
import { usePermissionStore } from '@/stores/permission';

const router = useRouter();
const perm = usePermissionStore();
function goBack(): void { router.push({ name: 'dashboard' }); }

const tab = ref<'live' | 'wl' | 'log'>('live');
const loading = ref(false);
const devices = ref<LprDevice[]>([]);
const recent = ref<LprPassRecord[]>([]);
const stats = ref<LprStats>({ todayIn: 0, todayOut: 0, onsite: 0, visitor: 0, abnormal: 0, autoReleased: 0, totalToday: 0 });
const whitelist = ref<LprWhitelist[]>([]);
// 道闸操作忙态, key=`${deviceId}:open` | `${deviceId}:close`
const busyGate = ref<Set<string>>(new Set());
function gateKey(d: LprDevice): string { return String(d.id); }

// 白名单表单
const wlPlate = ref('');
const wlGroup = ref('staff');
const wlRemark = ref('');
const wlOverdue = ref('');
const savingWl = ref(false);

// 记录查询
const records = ref<LprPassRecord[]>([]);
const recordTotal = ref(0);
const queryPlate = ref('');
const RECORD_STEP = 100;

function snap(url: string | null): string { return lprService.snapUrl(url); }
const groupIcon: Record<string, typeof User> = { staff: Users, visitor: User, freight: Truck, black: Ban };
function groupLabel(g: string): string { return LPR_GROUPS.find((x) => x.value === g)?.label ?? g; }

function pad(n: number): string { return String(n).padStart(2, '0'); }
function mdhm(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const releaseMeta: Record<string, { text: string; cls: string }> = {
  auto: { text: '自动放行', cls: 'rel-auto' },
  manual: { text: '手动开闸', cls: 'rel-manual' },
  deny: { text: '拒绝', cls: 'rel-deny' },
  none: { text: '未放行', cls: 'rel-none' },
};
function relOf(r: string): { text: string; cls: string } {
  return releaseMeta[r] ?? releaseMeta.none;
}
function isAbnormal(r: LprPassRecord): boolean {
  return r.isFake === 1 || r.isDanger === 1 || r.releaseResult === 'deny';
}
function gateCls(d: LprDevice): string {
  if (!d.online) return 'gate-offline';
  // 展示态统一用后端合成的 gateState（真实上报优先，GPIO 场景走指令态，无信息默认关）
  if (d.gateState === 1) return 'gate-open';
  if (d.gateState === 2) return 'gate-mid';
  return 'gate-closed';
}

async function loadDevices(): Promise<void> {
  try { devices.value = await lprService.devices(); } catch { /* 静默, 由连接态兜底 */ }
}
async function loadRecent(): Promise<void> {
  try { recent.value = await lprService.recent(30); } catch { /* 静默 */ }
}
async function loadStats(): Promise<void> {
  try { stats.value = await lprService.stats(); } catch { /* 静默 */ }
}
async function loadWhitelist(): Promise<void> {
  try { whitelist.value = await lprService.whitelist(); } catch { /* 静默 */ }
}
async function refreshAll(): Promise<void> {
  loading.value = true;
  await Promise.all([loadDevices(), loadRecent(), loadStats()]);
  loading.value = false;
}

async function setGate(d: LprDevice, action: 'open' | 'close'): Promise<void> {
  const key = gateKey(d);
  busyGate.value.add(key); busyGate.value = new Set(busyGate.value);
  const isOpen = action === 'open';
  try {
    const r = isOpen
      ? await lprService.openGate({ deviceId: d.id })
      : await lprService.closeGate({ deviceId: d.id });
    const verb = isOpen ? '开闸' : '关闸';
    ElMessage.success(r.delivered ? `${verb}指令已下发` : `相机当前未连接，已排队，下次通讯时${verb}`);
    await loadDevices();
  } catch (e) {
    ElMessage.error((e as Error).message || (isOpen ? '开闸失败' : '关闸失败'));
  } finally {
    busyGate.value.delete(key); busyGate.value = new Set(busyGate.value);
  }
}

/**
 * 单按钮 toggle：当前为关→发开闸(抬杆)，当前为开→发关闸(落杆)，动作中(2)忽略。
 * GPIO 开关量道闸无真实杆位，按钮态依据后端合成的 gateState（指令态/真实态）。
 */
async function toggleGate(d: LprDevice): Promise<void> {
  if (!d.enabled || d.gateState === 2) return;
  const action: 'open' | 'close' = d.gateState === 1 ? 'close' : 'open';
  await setGate(d, action);
}

async function saveWhitelist(): Promise<void> {
  const plate = wlPlate.value.trim().toUpperCase().replace(/\s+/g, '');
  if (!plate) { ElMessage.warning('请输入车牌号'); return; }
  savingWl.value = true;
  try {
    await lprService.saveWhitelist({
      plate,
      groupName: wlGroup.value,
      isBlack: wlGroup.value === 'black',
      remark: wlRemark.value.trim() || null,
      overdueTime: wlOverdue.value ? new Date(wlOverdue.value).toISOString() : undefined,
    });
    ElMessage.success('已保存白名单');
    wlPlate.value = ''; wlRemark.value = ''; wlOverdue.value = '';
    await loadWhitelist();
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败（白名单维护需管理员）');
  } finally {
    savingWl.value = false;
  }
}
async function removeWhitelist(w: LprWhitelist): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除白名单车牌 ${w.plate}？`, '删除', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
    });
  } catch { return; }
  try {
    await lprService.removeWhitelist(w.id);
    ElMessage.success('已删除');
    await loadWhitelist();
  } catch (e) { ElMessage.error((e as Error).message || '删除失败'); }
}

async function loadRecords(append = false): Promise<void> {
  try {
    const res = await lprService.records({
      plate: queryPlate.value.trim() || undefined,
      limit: RECORD_STEP,
      offset: append ? records.value.length : 0,
    });
    records.value = append ? [...records.value, ...res.list] : res.list;
    recordTotal.value = res.total;
  } catch (e) { ElMessage.error((e as Error).message || '查询失败'); }
}
function searchRecords(): void { void loadRecords(false); }
const hasMoreRecords = computed(() => records.value.length < recordTotal.value);

function switchTab(t: 'live' | 'wl' | 'log'): void {
  tab.value = t;
  if (t === 'wl' && whitelist.value.length === 0) void loadWhitelist();
  if (t === 'log' && records.value.length === 0) void loadRecords(false);
}

// ---- 实时: WS 推送 + 断线轮询兜底 (切走即停, 不阻塞路由) ----
let unsubWs: (() => void) | null = null;
let unsubState: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function handleEvent(e: WsEvent): void {
  if (e.type === 'lpr_pass') { void loadRecent(); void loadStats(); void loadDevices(); }
  else if (e.type === 'lpr_gate_status') { void loadDevices(); }
}
function handleState(s: WsConnectionState): void {
  if (s === 'open') stopPoll();
  else startPollTimer();
}
function startPollTimer(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => { void loadDevices(); void loadStats(); void loadRecent(); }, 15_000);
}
function stopPoll(): void { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function start(): void {
  void refreshAll();
  if (!unsubWs) unsubWs = wsClient.on(handleEvent);
  if (!unsubState) unsubState = wsClient.onState(handleState);
  if (wsClient.getState() !== 'open') startPollTimer();
}
function stop(): void {
  stopPoll();
  unsubWs?.(); unsubWs = null;
  unsubState?.(); unsubState = null;
}
useActivePolling(start, stop);
</script>

<template>
  <div class="barrier-page" :class="{ 'device-readonly': !perm.canEdit }">
    <header class="topbar">
      <button class="icon-btn" aria-label="返回" @click="goBack"><ArrowLeft :size="20" /></button>
      <h1 class="title"><CarFront :size="20" class="title-icon" />道闸<span v-if="!perm.canEdit" class="device-readonly-chip">只读</span></h1>
      <button class="icon-btn" aria-label="刷新" @click="refreshAll"><RefreshCw :size="18" :class="{ spin: loading }" /></button>
    </header>

    <section class="kpi-grid">
      <div class="kpi"><LogIn :size="16" class="kpi-ic in" /><div class="kpi-num">{{ stats.todayIn }}</div><div class="kpi-label">今日进</div></div>
      <div class="kpi"><LogOut :size="16" class="kpi-ic out" /><div class="kpi-num">{{ stats.todayOut }}</div><div class="kpi-label">今日出</div></div>
      <div class="kpi"><CarFront :size="16" class="kpi-ic" /><div class="kpi-num">{{ stats.onsite }}</div><div class="kpi-label">在场</div></div>
      <div class="kpi" :class="{ alarm: stats.abnormal > 0 }"><AlertTriangle :size="16" class="kpi-ic" /><div class="kpi-num">{{ stats.abnormal }}</div><div class="kpi-label">异常</div></div>
    </section>

    <nav class="tabs">
      <button :class="{ active: tab === 'live' }" @click="switchTab('live')"><DoorOpen :size="16" />实时</button>
      <button :class="{ active: tab === 'wl' }" @click="switchTab('wl')"><ShieldCheck :size="16" />白名单</button>
      <button :class="{ active: tab === 'log' }" @click="switchTab('log')"><History :size="16" />记录</button>
    </nav>

    <!-- 实时 -->
    <section v-if="tab === 'live'" class="panel">
      <h2 class="section-title">通道与道闸</h2>
      <div v-if="devices.length === 0" class="empty">暂无相机通道，等待设备心跳上报或在后台添加</div>
      <article v-for="d in devices" :key="d.id" class="device-card">
        <div class="device-main">
          <div class="device-head">
            <span class="dot" :class="d.online ? 'on' : 'off'"></span>
            <span class="device-name">{{ d.deviceName }}</span>
            <span class="dir-chip" v-if="d.passDirection === 'in'"><LogIn :size="12" />入口</span>
            <span class="dir-chip out" v-else-if="d.passDirection === 'out'"><LogOut :size="12" />出口</span>
          </div>
          <div class="device-meta">
            <span
              :class="['gate-badge', gateCls(d)]"
              :title="d.online ? (d.gateStateSource === 'device' ? '道闸真实状态' : '按最近一次开/关指令推断；若用遥控器或手动操作请以现场为准') : ''"
            >{{ d.online ? d.gateStateLabel : '离线' }}</span>
            <span class="state-note" v-if="d.online && d.gateStateSource === 'command'">指令态</span>
            <span class="conn-badge" v-if="d.online && d.gateStateSource === 'device' && d.gateConnected === false">道闸未连接</span>
            <span class="meta-text" v-if="d.location">{{ d.location }}</span>
            <span class="meta-text" v-if="d.lastPlate">最近 {{ d.lastPlate }}</span>
          </div>
        </div>
        <div class="gate-actions">
          <button
            :class="['gate-btn', d.gateState === 1 ? 'close' : 'open']"
            :disabled="busyGate.has(gateKey(d)) || !d.enabled || d.gateState === 2"
            :title="d.gateState === 1 ? `远程关闸（落杆，继电器 IO${d.closeGateIoEffective}）` : `远程开闸（抬杆，继电器 IO${d.gateIo}）`"
            @click="toggleGate(d)"
          >
            <DoorClosed v-if="d.gateState === 1" :size="16" />
            <DoorOpen v-else :size="16" />
            <template v-if="busyGate.has(gateKey(d))">执行中</template>
            <template v-else-if="d.gateState === 2">动作中</template>
            <template v-else>{{ d.gateState === 1 ? '关闸' : '开闸' }}</template>
          </button>
        </div>
      </article>

      <h2 class="section-title mt">门岗实时事件</h2>
      <div v-if="recent.length === 0" class="empty">暂无过车记录</div>
      <article v-for="r in recent" :key="r.id" :class="['pass-card', { abnormal: isAbnormal(r) }]">
        <div class="pass-pic">
          <img v-if="r.picSmallUrl" :src="snap(r.picSmallUrl)" alt="抓拍" loading="lazy" />
          <CarFront v-else :size="24" />
        </div>
        <div class="pass-body">
          <div class="pass-line1">
            <span class="plate">{{ r.license }}</span>
            <span v-if="r.passDirection === 'in'" class="dir-tag in"><LogIn :size="12" />进</span>
            <span v-else-if="r.passDirection === 'out'" class="dir-tag out"><LogOut :size="12" />出</span>
            <span v-if="r.isOffline" class="off-tag">补传</span>
          </div>
          <div class="pass-line2">
            <span v-if="r.plateColorLabel">{{ r.plateColorLabel }}</span>
            <span v-if="r.plateTypeLabel">{{ r.plateTypeLabel }}</span>
            <span v-if="r.carTypeLabel">{{ r.carTypeLabel }}</span>
            <span v-if="r.triggerTypeLabel" class="dim">{{ r.triggerTypeLabel }}</span>
          </div>
          <div class="pass-line3" v-if="isAbnormal(r)">
            <AlertTriangle :size="12" class="warn-ic" />
            <span v-if="r.isFake === 1">疑似伪牌</span>
            <span v-if="r.isDanger === 1">危险车辆</span>
            <span v-if="r.releaseResult === 'deny'">黑名单拦截</span>
          </div>
        </div>
        <div class="pass-right">
          <span :class="['rel-badge', relOf(r.releaseResult).cls]">{{ relOf(r.releaseResult).text }}</span>
          <span class="pass-time">{{ mdhm(r.eventTime) }}</span>
        </div>
      </article>
    </section>

    <!-- 白名单 -->
    <section v-else-if="tab === 'wl'" class="panel">
      <div class="wl-form">
        <input v-model="wlPlate" class="input" placeholder="车牌号，如 鲁Q12345" maxlength="10" />
        <select v-model="wlGroup" class="input sm">
          <option v-for="g in LPR_GROUPS" :key="g.value" :value="g.value">{{ g.label }}</option>
        </select>
        <input v-model="wlRemark" class="input" placeholder="备注（单位/姓名，可选）" />
        <input v-model="wlOverdue" type="datetime-local" class="input sm" title="过期时间（可选）" />
        <button class="primary-btn" :disabled="savingWl" @click="saveWhitelist"><Plus :size="16" />添加</button>
      </div>
      <div v-if="whitelist.length === 0" class="empty">暂无白名单，添加后命中车牌将自动抬杆</div>
      <article v-for="w in whitelist" :key="w.id" :class="['wl-card', { black: w.isBlack }]">
        <component :is="groupIcon[w.groupName] ?? User" :size="18" class="wl-ic" />
        <div class="wl-main">
          <div class="wl-plate">{{ w.plate }}<span class="wl-group">{{ groupLabel(w.groupName) }}</span></div>
          <div class="wl-meta">
            <span v-if="w.remark">{{ w.remark }}</span>
            <span v-if="w.overdueTime" class="dim"><Clock :size="11" />{{ mdhm(w.overdueTime) }} 到期</span>
            <span v-else class="dim">长期有效</span>
          </div>
        </div>
        <button class="ghost-danger" aria-label="删除" @click="removeWhitelist(w)"><Trash2 :size="16" /></button>
      </article>
    </section>

    <!-- 记录 -->
    <section v-else class="panel">
      <div class="search-bar">
        <Search :size="16" class="search-ic" />
        <input v-model="queryPlate" class="input grow" placeholder="按车牌搜索" @keyup.enter="searchRecords" />
        <button class="primary-btn sm" @click="searchRecords">查询</button>
      </div>
      <div v-if="records.length === 0" class="empty">暂无过车记录</div>
      <article v-for="r in records" :key="r.id" :class="['pass-card', { abnormal: isAbnormal(r) }]">
        <div class="pass-pic">
          <img v-if="r.picSmallUrl" :src="snap(r.picSmallUrl)" alt="抓拍" loading="lazy" />
          <CarFront v-else :size="24" />
        </div>
        <div class="pass-body">
          <div class="pass-line1">
            <span class="plate">{{ r.license }}</span>
            <span v-if="r.passDirection === 'in'" class="dir-tag in"><LogIn :size="12" />进</span>
            <span v-else-if="r.passDirection === 'out'" class="dir-tag out"><LogOut :size="12" />出</span>
          </div>
          <div class="pass-line2">
            <span v-if="r.plateColorLabel">{{ r.plateColorLabel }}</span>
            <span v-if="r.plateTypeLabel">{{ r.plateTypeLabel }}</span>
            <span v-if="r.carTypeLabel">{{ r.carTypeLabel }}</span>
            <span v-if="r.serialno" class="dim">{{ r.serialno }}</span>
          </div>
        </div>
        <div class="pass-right">
          <span :class="['rel-badge', relOf(r.releaseResult).cls]">{{ relOf(r.releaseResult).text }}</span>
          <span class="pass-time">{{ mdhm(r.eventTime) }}</span>
        </div>
      </article>
      <button v-if="hasMoreRecords" class="more-btn" @click="loadRecords(true)">加载更多</button>
      <div v-if="records.length > 0" class="list-foot">共 {{ recordTotal }} 条</div>
    </section>
  </div>
</template>

<style scoped>
.barrier-page {
  min-height: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: var(--v2-sp-3) var(--v2-sp-3) calc(20px + env(safe-area-inset-bottom));
  box-sizing: border-box;
  overflow-x: hidden;
  color: var(--v2-text-1);
}
.topbar { display: flex; align-items: center; gap: var(--v2-sp-2); margin-bottom: var(--v2-sp-3); }
.title { flex: 1; display: flex; align-items: center; gap: var(--v2-sp-2); margin: 0; font-size: var(--v2-fs-md, 16px); font-weight: 700; }
.title-icon { color: var(--v2-primary); }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: var(--v2-r-md);
  border: 1px solid var(--v2-border-soft); background: var(--v2-surf-1);
  color: var(--v2-text-2); cursor: pointer; min-height: 40px;
}
.icon-btn:active { background: var(--v2-surf-1-hover); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--v2-sp-2); margin-bottom: var(--v2-sp-3); }
.kpi {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg); padding: var(--v2-sp-3) var(--v2-sp-1);
}
.kpi.alarm .kpi-num { color: var(--v2-danger); }
.kpi-ic { color: var(--v2-text-3); }
.kpi-ic.in { color: var(--v2-success); } .kpi-ic.out { color: var(--v2-primary); }
.kpi-num { font-size: 22px; font-weight: 800; line-height: 1.1; }
.kpi-label { font-size: var(--v2-fs-xs, 12px); color: var(--v2-text-3); }

.tabs { display: flex; gap: var(--v2-sp-1); background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); border-radius: var(--v2-r-lg); padding: 4px; margin-bottom: var(--v2-sp-3); }
.tabs button {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 44px; border: 0; border-radius: var(--v2-r-md);
  background: transparent; color: var(--v2-text-2); font-size: var(--v2-fs-sm, 14px); font-weight: 600; cursor: pointer;
}
.tabs button.active { background: var(--v2-primary-soft); color: var(--v2-primary); }

.panel { display: flex; flex-direction: column; gap: var(--v2-sp-2); }
.section-title { margin: 0; font-size: var(--v2-fs-sm, 14px); color: var(--v2-text-2); font-weight: 700; }
.section-title.mt { margin-top: var(--v2-sp-3); }
.empty { padding: var(--v2-sp-4); text-align: center; color: var(--v2-text-3); font-size: var(--v2-fs-sm, 14px); background: var(--v2-surf-1); border: 1px dashed var(--v2-border-soft); border-radius: var(--v2-r-lg); }

.device-card {
  display: flex; align-items: center; justify-content: space-between; gap: var(--v2-sp-3);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg); padding: var(--v2-sp-3) var(--v2-sp-4);
}
.device-main { min-width: 0; flex: 1; }
.device-head { display: flex; align-items: center; gap: var(--v2-sp-2); flex-wrap: wrap; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.dot.on { background: var(--v2-success); box-shadow: 0 0 0 3px var(--v2-success-soft); }
.dot.off { background: var(--v2-text-3); }
.device-name { font-weight: 700; font-size: var(--v2-fs-md, 16px); }
.dir-chip { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--v2-success-soft); color: var(--v2-success); }
.dir-chip.out { background: var(--v2-primary-soft); color: var(--v2-primary); }
.device-meta { display: flex; align-items: center; gap: var(--v2-sp-2); margin-top: 6px; flex-wrap: wrap; }
.meta-text { font-size: var(--v2-fs-xs, 12px); color: var(--v2-text-3); }
.gate-badge { font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; }
.gate-closed { background: var(--v2-ov-2); color: var(--v2-text-2); }
.gate-open { background: var(--v2-warning-soft); color: var(--v2-warning); }
.gate-mid { background: var(--v2-primary-soft); color: var(--v2-primary); }
.gate-offline { background: var(--v2-ov-1); color: var(--v2-text-3); }
.conn-badge { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: var(--v2-warning-soft); color: var(--v2-warning); }
.state-note { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--v2-ov-1); color: var(--v2-text-3); }
.gate-actions { flex: none; display: flex; flex-direction: row; align-items: center; gap: 8px; }
.gate-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px;
  min-width: 96px; padding: 0 18px; border: 0; border-radius: var(--v2-r-md);
  font-weight: 700; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.gate-btn.open { background: var(--v2-accent-fill); color: var(--v2-on-primary); }
.gate-btn.close { background: var(--v2-surf-2); color: var(--v2-text-1); border: 1px solid var(--v2-border-strong); }
.gate-btn:disabled { opacity: .5; cursor: not-allowed; }

.pass-card {
  display: flex; align-items: center; gap: var(--v2-sp-3);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg); padding: var(--v2-sp-3);
}
.pass-card.abnormal { border-color: color-mix(in srgb, var(--v2-danger) 45%, var(--v2-border-soft)); }
.pass-pic {
  flex: none; width: 56px; height: 56px; border-radius: var(--v2-r-sm, 8px);
  background: var(--v2-surf-3); color: var(--v2-text-3);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.pass-pic img { width: 100%; height: 100%; object-fit: cover; }
.pass-body { flex: 1; min-width: 0; }
.pass-line1 { display: flex; align-items: center; gap: var(--v2-sp-2); flex-wrap: wrap; }
.plate { font-size: var(--v2-fs-md, 16px); font-weight: 800; letter-spacing: .5px; }
.dir-tag { display: inline-flex; align-items: center; gap: 2px; font-size: 11px; padding: 1px 7px; border-radius: 999px; }
.dir-tag.in { background: var(--v2-success-soft); color: var(--v2-success); }
.dir-tag.out { background: var(--v2-primary-soft); color: var(--v2-primary); }
.off-tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--v2-ov-2); color: var(--v2-text-3); }
.pass-line2 { display: flex; gap: var(--v2-sp-2); margin-top: 4px; font-size: var(--v2-fs-xs, 12px); color: var(--v2-text-2); flex-wrap: wrap; }
.pass-line2 .dim, .dim { color: var(--v2-text-3); }
.pass-line3 { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: var(--v2-fs-xs, 12px); color: var(--v2-danger); }
.pass-right { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.rel-badge { font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
.rel-auto { background: var(--v2-success-soft); color: var(--v2-success); }
.rel-manual { background: var(--v2-primary-soft); color: var(--v2-primary); }
.rel-deny { background: var(--v2-danger-soft); color: var(--v2-danger); }
.rel-none { background: var(--v2-ov-1); color: var(--v2-text-3); }
.pass-time { font-size: 11px; color: var(--v2-text-3); white-space: nowrap; }

.wl-form { display: flex; gap: var(--v2-sp-2); flex-wrap: wrap; }
.input {
  flex: 1 1 140px; min-width: 0; min-height: 44px; padding: 0 var(--v2-sp-3);
  border-radius: var(--v2-r-md); border: 1px solid var(--v2-border-strong);
  background: var(--v2-surf-2); color: var(--v2-text-1); font-size: var(--v2-fs-sm, 14px); box-sizing: border-box;
}
.input.sm { flex: 0 1 auto; }
.input:focus { outline: none; border-color: var(--v2-primary); }
.primary-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 44px; padding: 0 var(--v2-sp-4); border: 0; border-radius: var(--v2-r-md);
  background: var(--v2-accent-fill); color: var(--v2-on-primary); font-weight: 700; cursor: pointer;
}
.primary-btn.sm { min-height: 40px; padding: 0 var(--v2-sp-3); }
.primary-btn:disabled { opacity: .55; cursor: not-allowed; }
.wl-card { display: flex; align-items: center; gap: var(--v2-sp-3); background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); border-radius: var(--v2-r-lg); padding: var(--v2-sp-3) var(--v2-sp-4); }
.wl-card.black { border-color: color-mix(in srgb, var(--v2-danger) 40%, var(--v2-border-soft)); }
.wl-ic { color: var(--v2-primary); flex: none; }
.wl-card.black .wl-ic { color: var(--v2-danger); }
.wl-main { flex: 1; min-width: 0; }
.wl-plate { font-weight: 800; font-size: var(--v2-fs-md, 16px); display: flex; align-items: center; gap: var(--v2-sp-2); }
.wl-group { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; background: var(--v2-primary-soft); color: var(--v2-primary); }
.wl-card.black .wl-group { background: var(--v2-danger-soft); color: var(--v2-danger); }
.wl-meta { display: flex; gap: var(--v2-sp-2); margin-top: 3px; font-size: var(--v2-fs-xs, 12px); color: var(--v2-text-2); flex-wrap: wrap; }
.ghost-danger { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: var(--v2-r-md); border: 1px solid var(--v2-border-soft); background: transparent; color: var(--v2-danger); cursor: pointer; }

.search-bar { display: flex; align-items: center; gap: var(--v2-sp-2); }
.search-ic { color: var(--v2-text-3); flex: none; }
.input.grow { flex: 1; }
.more-btn { width: 100%; min-height: 44px; border-radius: var(--v2-r-md); border: 1px solid var(--v2-border-strong); background: var(--v2-surf-1); color: var(--v2-text-2); font-weight: 600; cursor: pointer; }
.list-foot { text-align: center; font-size: 12px; color: var(--v2-text-3); padding: var(--v2-sp-2); }

@media (max-width: 420px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
