<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { usePermissionStore } from '@/stores/permission';
import {
  em123Service,
  chargeModeLabel,
  chargeStatusLabel,
  controlResultLabel,
  writeBizTypeLabel,
  type Em123MeterType,
  type Em123TypeSummary,
  type Em123Group,
  type Em123MeterView,
  type Em123ChargeRow,
  type Em123ControlRow,
  type Em123Arrears,
  type Em123MeterContext,
  type Em123RefundForm,
  type Em123WriteLog,
  type Em123ControlAction,
} from '@/services/em123.service';

// 水电前台 PWA：总览/缴费流水/欠费/控制记录（一期只读）+ 操作对账（二三期写留痕）。
type TabKey = 'overview' | 'charges' | 'arrears' | 'control' | 'writeLogs';
const tabs: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '水电总览' },
  { key: 'charges', label: '缴费流水' },
  { key: 'arrears', label: '欠费清单' },
  { key: 'control', label: '控制记录' },
  { key: 'writeLogs', label: '操作对账' },
];
const activeTab = ref<TabKey>('overview');

// 原子权限点门控（二三期）：物业改名/档案 energy:rename，财务现金/退费 energy:recharge/refund，
// 远程拉合闸 energy:control 仅 admin（不授任何角色）。
const perm = usePermissionStore();
const canReadout = computed(() => perm.hasPermission('energy:readout'));
const canExport = computed(() => perm.hasPermission('energy:export'));
const canRename = computed(() => perm.hasPermission('energy:rename'));
const canRecharge = computed(() => perm.hasPermission('energy:recharge'));
const canRefund = computed(() => perm.hasPermission('energy:refund'));
const canControl = computed(() => perm.hasPermission('energy:control'));

// 金额管控（后端为最终硬校验，前端仅用于提前提示，默认值与后端一致）。
const CASH_LIMIT = 30000;
const LARGE_AMOUNT = 5000;

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

// ==================== 二/三期：写操作弹窗 ====================
type ModalKind = 'cash' | 'profile' | 'control' | 'refund' | 'reduction' | 'setrate';
const modal = reactive({
  kind: null as ModalKind | null,
  submitting: false,
  meterType: 'E' as Em123MeterType,
  meterNo: '',
  name: '',
  recordId: '' as string | number,
  ctx: null as Em123MeterContext | null,
  refundForm: null as Em123RefundForm | null,
  // 现金 / 补量
  cashMode: 'cash' as 'cash' | 'replienish',
  amount: '',
  remark: '',
  confirm: false,
  // 档案 / 改名
  houseName: '',
  userName: '',
  userPhone: '',
  multiply: '',
  // 远程控制
  controlAction: 'wattoff' as Em123ControlAction,
  reason: '',
  confirmName: '',
  // 退费
  refundMoney: '',
  refundMode: '1' as '0' | '1',
  refundRemark: '',
  refundConfirm: false,
  // 减免
  reductionMoney: '',
  reductionReason: '',
  reductionConfirm: false,
  // 多费率
  setrateOptions: [] as { value: string; label: string }[],
  setrateId: '',
  setrateCurrent: '',
  setrateReason: '',
  setrateConfirmName: '',
});

function resetModal(): void {
  modal.kind = null;
  modal.submitting = false;
  modal.ctx = null;
  modal.refundForm = null;
  modal.amount = '';
  modal.remark = '';
  modal.confirm = false;
  modal.houseName = '';
  modal.userName = '';
  modal.userPhone = '';
  modal.multiply = '';
  modal.reason = '';
  modal.confirmName = '';
  modal.refundMoney = '';
  modal.refundMode = '1';
  modal.refundRemark = '';
  modal.refundConfirm = false;
  modal.reductionMoney = '';
  modal.reductionReason = '';
  modal.reductionConfirm = false;
  modal.setrateOptions = [];
  modal.setrateId = '';
  modal.setrateCurrent = '';
  modal.setrateReason = '';
  modal.setrateConfirmName = '';
}
function closeModal(): void {
  resetModal();
}

/** 现金/补量收银。 */
async function openCash(m: Em123MeterView): Promise<void> {
  resetModal();
  modal.kind = 'cash';
  modal.meterType = m.type;
  modal.meterNo = m.meterNo;
  modal.name = m.name;
  try {
    modal.ctx = await em123Service.meterContext(m.type, m.meterNo);
  } catch (e) {
    showToast(`回显表信息失败：${(e as Error).message}`);
  }
}

/** 改名 / 档案。 */
async function openProfile(m: Em123MeterView): Promise<void> {
  resetModal();
  modal.kind = 'profile';
  modal.meterType = m.type;
  modal.meterNo = m.meterNo;
  modal.name = m.name;
  try {
    const ctx = await em123Service.meterContext(m.type, m.meterNo);
    modal.ctx = ctx;
    modal.houseName = ctx.house?.houseName ?? ctx.meter.houseName ?? '';
    modal.userName = ctx.user?.userName ?? '';
    modal.userPhone = ctx.user?.userPhone ?? '';
    modal.multiply = String(ctx.meter.multiply ?? '1');
  } catch (e) {
    showToast(`回显档案失败：${(e as Error).message}`);
  }
}

/** 远程控制（拉闸/合闸/校时）。 */
async function openControl(m: Em123MeterView, action: Em123ControlAction): Promise<void> {
  resetModal();
  modal.kind = 'control';
  modal.meterType = m.type;
  modal.meterNo = m.meterNo;
  modal.name = m.name;
  modal.controlAction = action;
  try {
    modal.ctx = await em123Service.meterContext(m.type, m.meterNo);
  } catch (e) {
    showToast(`回显表信息失败：${(e as Error).message}`);
  }
}

/** 退费（从缴费成功单进入）。 */
async function openRefund(row: Em123ChargeRow): Promise<void> {
  if (row.recordId == null) return;
  resetModal();
  modal.kind = 'refund';
  modal.recordId = row.recordId;
  modal.name = `${row.userName || '—'} · ${row.houseName || ''}`;
  try {
    const f = await em123Service.refundForm(row.recordId);
    modal.refundForm = f;
    modal.refundMoney = String(f.chargeMoney ?? '');
    // 现金单（chargeWay=pc，无交易号）只能现金退费
    const hasTrade = Boolean(f.hidden.tradeNo || f.hidden.saleTradeNo);
    modal.refundMode = hasTrade ? '0' : '1';
  } catch (e) {
    showToast(`回显退费表单失败：${(e as Error).message}`);
  }
}

/** 减免（从表行进入，按该表所属住房核销应收）。 */
async function openReduction(m: Em123MeterView): Promise<void> {
  resetModal();
  modal.kind = 'reduction';
  modal.meterType = m.type;
  modal.meterNo = m.meterNo;
  modal.name = m.name;
  try {
    modal.ctx = await em123Service.meterContext(m.type, m.meterNo);
  } catch (e) {
    showToast(`回显表信息失败：${(e as Error).message}`);
  }
}

async function submitCash(): Promise<void> {
  const amount = Number(modal.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast('请输入大于 0 的金额');
    return;
  }
  if (amount > CASH_LIMIT) {
    showToast(`单笔不能超过 ${CASH_LIMIT} 元，请核对或走线下`);
    return;
  }
  if (amount >= LARGE_AMOUNT && !modal.confirm) {
    showToast(`大额（≥${LARGE_AMOUNT} 元）请先勾选二次确认`);
    return;
  }
  const tip = modal.cashMode === 'replienish'
    ? `确认向【${modal.name}】补量 ${amount} 度？提交后不可撤销。`
    : `确认为【${modal.name}】录入现金 ${amount.toFixed(2)} 元？提交后不可撤销。`;
  if (!window.confirm(tip)) return;
  modal.submitting = true;
  try {
    await em123Service.charge({
      meterType: modal.meterType,
      meterNo: modal.meterNo,
      mode: modal.cashMode,
      amount,
      remark: modal.remark.trim(),
      confirm: true,
    });
    showToast(modal.cashMode === 'replienish' ? '补量已录入' : '现金已录入');
    closeModal();
    void loadTree(modal.meterType);
    void loadTodayCharge();
  } catch (e) {
    showToast(`提交失败：${(e as Error).message}`);
  } finally {
    modal.submitting = false;
  }
}

async function submitProfile(): Promise<void> {
  const ctx = modal.ctx;
  if (!ctx) return;
  if (!modal.houseName.trim()) {
    showToast('客户名（住房名）不能为空');
    return;
  }
  const tasks: Promise<unknown>[] = [];
  const done: string[] = [];
  // 客户名（住房）
  if (ctx.house && modal.houseName.trim() !== (ctx.house.houseName ?? ctx.meter.houseName ?? '')) {
    tasks.push(em123Service.renameHouse({
      houseId: ctx.house.houseId,
      houseName: modal.houseName.trim(),
      fullName: ctx.house.fullName ?? modal.houseName.trim(),
      parentId: ctx.house.parentId ?? undefined,
    }));
    done.push('客户名');
  }
  // 业主户名 / 电话
  if (ctx.user && (modal.userName.trim() !== ctx.user.userName || modal.userPhone.trim() !== (ctx.user.userPhone ?? ''))) {
    if (!modal.userName.trim()) {
      showToast('业主户名不能为空');
      return;
    }
    tasks.push(em123Service.renameUser({
      userId: ctx.user.userId,
      userName: modal.userName.trim(),
      userPhone: modal.userPhone.trim(),
    }));
    done.push('业主户名/电话');
  }
  // 倍率
  const mul = Number(modal.multiply);
  if (modal.multiply !== '' && Number.isFinite(mul) && mul > 0 && mul !== Number(ctx.meter.multiply ?? 1)) {
    tasks.push(em123Service.editMeter({
      meterType: modal.meterType,
      meterNo: modal.meterNo,
      fields: { multiply: mul },
    }));
    done.push('倍率');
  }
  if (tasks.length === 0) {
    showToast('没有检测到改动');
    return;
  }
  if (!window.confirm(`确认保存以下修改：${done.join('、')}？`)) return;
  modal.submitting = true;
  try {
    const results = await Promise.allSettled(tasks);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      showToast(`部分失败：${(failed[0] as PromiseRejectedResult).reason?.message ?? '请核对'}`);
    } else {
      showToast('档案已保存');
      closeModal();
      void loadTree(modal.meterType);
    }
  } finally {
    modal.submitting = false;
  }
}

async function submitControl(): Promise<void> {
  const action = modal.controlAction;
  const expectName = String(modal.ctx?.meter.houseName ?? '').trim();
  if (action === 'wattoff' || action === 'watton') {
    if (modal.reason.trim().length < 2) {
      showToast('请填写操作原因（至少 2 个字）');
      return;
    }
    if (modal.confirmName.trim() !== expectName) {
      showToast(`请准确输入住房名进行确认（应为「${expectName}」）`);
      return;
    }
  }
  const label = action === 'wattoff' ? '拉闸断电' : action === 'watton' ? '合闸送电' : '表计校时';
  const danger = action === 'wattoff'
    ? `\n\n⚠ 拉闸将立即停止对【${expectName}】供电！请确认已现场核实。`
    : '';
  if (!window.confirm(`确认对【${expectName}】执行【${label}】？${danger}`)) return;
  modal.submitting = true;
  try {
    await em123Service.control({
      action,
      meterType: modal.meterType,
      meterNo: modal.meterNo,
      reason: modal.reason.trim(),
      confirmName: modal.confirmName.trim(),
    });
    showToast(`${label}指令已下发`);
    closeModal();
    void loadTree(modal.meterType);
  } catch (e) {
    showToast(`控制失败：${(e as Error).message}`);
  } finally {
    modal.submitting = false;
  }
}

async function submitRefund(): Promise<void> {
  const f = modal.refundForm;
  if (!f) return;
  const money = Number(modal.refundMoney);
  if (!Number.isFinite(money) || money <= 0) {
    showToast('请输入大于 0 的退费金额');
    return;
  }
  if (f.chargeMoney != null && money > Number(f.chargeMoney)) {
    showToast(`退费金额不能超过原充值 ${f.chargeMoney} 元`);
    return;
  }
  if (money >= LARGE_AMOUNT && !modal.refundConfirm) {
    showToast(`大额退费（≥${LARGE_AMOUNT} 元）请先勾选二次确认`);
    return;
  }
  if (!window.confirm(`确认对【${modal.name}】退费 ${money.toFixed(2)} 元？提交后不可撤销。`)) return;
  modal.submitting = true;
  try {
    await em123Service.refund({
      recordId: modal.recordId,
      refundMoney: money,
      refundMode: modal.refundMode,
      remark: modal.refundRemark.trim(),
      confirm: true,
    });
    showToast('退费已提交');
    closeModal();
    void loadCharges();
  } catch (e) {
    showToast(`退费失败：${(e as Error).message}`);
  } finally {
    modal.submitting = false;
  }
}

async function submitReduction(): Promise<void> {
  const money = Number(modal.reductionMoney);
  if (!Number.isFinite(money) || money <= 0) {
    showToast('请输入大于 0 的减免金额');
    return;
  }
  if (!modal.reductionReason.trim()) {
    showToast('请填写减免原因，便于对账留痕');
    return;
  }
  if (money >= LARGE_AMOUNT && !modal.reductionConfirm) {
    showToast(`大额减免（≥${LARGE_AMOUNT} 元）请先勾选二次确认`);
    return;
  }
  if (!window.confirm(`确认对【${modal.name}】减免 ${money.toFixed(2)} 元？提交后不可撤销。`)) return;
  modal.submitting = true;
  try {
    await em123Service.reduction({
      meterType: modal.meterType,
      meterNo: modal.meterNo,
      reductionMoney: money,
      reason: modal.reductionReason.trim(),
      confirm: true,
    });
    showToast('减免已提交');
    closeModal();
    void loadTree(modal.meterType);
  } catch (e) {
    showToast(`减免失败：${(e as Error).message}`);
  } finally {
    modal.submitting = false;
  }
}

// 多费率设置（仅 admin，高危）
async function openSetRate(m: Em123MeterView): Promise<void> {
  resetModal();
  modal.kind = 'setrate';
  modal.meterType = m.type;
  modal.meterNo = m.meterNo;
  modal.name = m.name;
  modal.submitting = true;
  try {
    const f = await em123Service.setrateForm(m.type, m.meterNo);
    modal.setrateOptions = f.rateOptions || [];
    modal.setrateId = f.rateOptions?.[0]?.value ?? '';
    modal.setrateCurrent = f.currentPriceName ?? '';
  } catch (e) {
    showToast(`费率方案读取失败：${(e as Error).message}`);
    closeModal();
  } finally {
    modal.submitting = false;
  }
}

async function submitSetRate(): Promise<void> {
  if (!modal.setrateId) {
    showToast('请选择费率方案');
    return;
  }
  if (!modal.setrateReason.trim() || modal.setrateReason.trim().length < 2) {
    showToast('请填写原因（至少 2 个字）');
    return;
  }
  if (modal.setrateConfirmName.trim() !== modal.name) {
    showToast(`请准确输入住房名进行确认（应为「${modal.name}」）`);
    return;
  }
  const label = modal.setrateOptions.find((o) => o.value === modal.setrateId)?.label ?? modal.setrateId;
  if (!window.confirm(`确认将【${modal.name}】切换为费率方案「${label}」？该操作影响计费。`)) return;
  modal.submitting = true;
  try {
    await em123Service.setRate({
      meterType: modal.meterType,
      meterNo: modal.meterNo,
      rateId: modal.setrateId,
      reason: modal.setrateReason.trim(),
      confirmName: modal.setrateConfirmName.trim(),
    });
    showToast('多费率设置已下发');
    closeModal();
    void loadTree(modal.meterType);
  } catch (e) {
    showToast(`多费率设置失败：${(e as Error).message}`);
  } finally {
    modal.submitting = false;
  }
}

// ==================== 操作对账（写留痕） ====================
const writeLogPage = ref(1);
const writeLogPages = ref(1);
const writeLogRows = ref<Em123WriteLog[]>([]);
const writeLogTotal = ref(0);
const loadingWriteLogs = ref(false);
const writeLogFilter = reactive({ bizType: '', meterNo: '', range: '30' });
const writeLogPageSize = 20;

async function loadWriteLogs(): Promise<void> {
  loadingWriteLogs.value = true;
  try {
    const q: {
      pageNum: number; pageSize: number; bizType?: string; meterNo?: string;
      startDate?: string; endDate?: string;
    } = { pageNum: writeLogPage.value, pageSize: writeLogPageSize };
    if (writeLogFilter.bizType) q.bizType = writeLogFilter.bizType;
    if (writeLogFilter.meterNo.trim()) q.meterNo = writeLogFilter.meterNo.trim();
    if (writeLogFilter.range) {
      q.startDate = daysAgoStr(Number(writeLogFilter.range) - 1);
      q.endDate = todayStr();
    }
    const r = await em123Service.writeLogs(q);
    writeLogRows.value = r.rows;
    writeLogTotal.value = r.total;
    writeLogPages.value = Math.max(1, Math.ceil(r.total / writeLogPageSize));
  } catch (e) {
    showToast(`操作对账查询失败：${(e as Error).message}`);
  } finally {
    loadingWriteLogs.value = false;
  }
}
function applyWriteLogFilter(): void {
  writeLogPage.value = 1;
  void loadWriteLogs();
}

function switchTab(k: TabKey): void {
  activeTab.value = k;
  if (k === 'charges' && chargeRows.value.length === 0) void loadCharges();
  if (k === 'control' && controlRows.value.length === 0) void loadControls();
  if (k === 'arrears' && !arrearsData.value[arrearsType.value]) void loadArrears(arrearsType.value);
  if (k === 'writeLogs' && writeLogRows.value.length === 0) void loadWriteLogs();
}

onMounted(() => {
  void loadTree('E');
  void loadTree('W');
  void loadArrears('E');
  void loadArrears('W');
  void loadTodayCharge();
});
</script>

<template>
  <section class="v2-page energy-page">
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
        <button
          v-if="canExport"
          class="btn ghost"
          :disabled="!!exporting"
          @click="doExport('meter', { meterType: overviewType })"
        >
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
                <button
                  v-if="canReadout"
                  class="btn small readout"
                  :disabled="readoutLoading.has(m.meterNo)"
                  @click="doReadout(m)"
                >
                  {{ readoutLoading.has(m.meterNo) ? '召测中…' : '召测' }}
                </button>
              </div>
              <div v-if="canRecharge || canRefund || canRename || canControl" class="meter-actions">
                <button v-if="canRecharge" class="btn small act-cash" @click="openCash(m)">收银</button>
                <button v-if="canRefund" class="btn small act-reduction" @click="openReduction(m)">减免</button>
                <button v-if="canRename" class="btn small act-profile" @click="openProfile(m)">改名/档案</button>
                <template v-if="canControl">
                  <button class="btn small act-off" @click="openControl(m, 'wattoff')">拉闸</button>
                  <button class="btn small act-on" @click="openControl(m, 'watton')">合闸</button>
                  <button class="btn small act-time" @click="openControl(m, 'settime')">校时</button>
                  <button class="btn small act-rate" @click="openSetRate(m)">多费率</button>
                </template>
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
        <button v-if="canExport" class="btn primary" :disabled="!!exporting" @click="exportCharge">导出 Excel</button>
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
        <div v-if="canRefund && r.chargeStatus === 1" class="rec-actions">
          <button class="btn small act-refund" @click="openRefund(r)">退费</button>
        </div>
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
        <div v-if="canRecharge || canRefund || canControl" class="rec-actions">
          <button v-if="canRecharge" class="btn small act-cash" @click="openCash(m)">收银</button>
          <button v-if="canRefund" class="btn small act-reduction" @click="openReduction(m)">减免</button>
          <button v-if="canControl" class="btn small act-off" @click="openControl(m, 'wattoff')">拉闸</button>
          <button v-if="canControl" class="btn small act-on" @click="openControl(m, 'watton')">合闸</button>
        </div>
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

      <div class="list-head">
        共 {{ controlTotal }} 条控制记录
        <span v-if="canControl" class="subtle"> · 远程拉闸/合闸在「水电总览」逐表下钻中</span>
      </div>
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

    <!-- ============ 操作对账（写留痕） ============ -->
    <section v-if="activeTab === 'writeLogs'" class="pane">
      <div class="filters">
        <select v-model="writeLogFilter.bizType" @change="applyWriteLogFilter">
          <option value="">全部类型</option>
          <option value="house_rename">住房改名</option>
          <option value="user_rename">业主改名</option>
          <option value="meter_edit">表档案</option>
          <option value="charge_cash">现金充值</option>
          <option value="charge_supplement">补量</option>
          <option value="refund">退费</option>
          <option value="reduction">减免</option>
          <option value="control_off">拉闸</option>
          <option value="control_on">合闸</option>
          <option value="settime">校时</option>
          <option value="setrate">多费率设置</option>
        </select>
        <select v-model="writeLogFilter.range" @change="applyWriteLogFilter">
          <option value="">全部时间</option>
          <option value="7">近 7 天</option>
          <option value="30">近 30 天</option>
          <option value="90">近 90 天</option>
        </select>
        <input v-model="writeLogFilter.meterNo" class="input" placeholder="按表号查询" @keyup.enter="applyWriteLogFilter" />
        <button class="btn ghost" @click="applyWriteLogFilter">查询</button>
      </div>

      <div class="list-head">共 {{ writeLogTotal }} 条写操作记录（成功/失败均留痕，可用于每日对账）</div>
      <div v-if="loadingWriteLogs" class="empty">加载中…</div>
      <div v-else-if="writeLogRows.length === 0" class="empty">暂无写操作记录</div>
      <div v-for="w in writeLogRows" :key="w.id" class="rec-card" :class="{ 'subtle-card': w.status === 'failed' }">
        <div class="rec-top">
          <div class="rec-title">
            {{ writeBizTypeLabel(w.bizType) }}
            <span class="rec-sub">{{ w.houseName || w.meterNo || '' }}</span>
          </div>
          <div class="rec-amount" :class="w.status === 'failed' ? 'muted' : ''">
            {{ w.amount ? fmtMoney(w.amount) : '—' }}
          </div>
        </div>
        <div class="rec-tags">
          <span class="badge" :class="w.status === 'success' ? 'badge-ok' : 'badge-fail'">
            {{ w.status === 'success' ? '成功' : '失败' }}
          </span>
          <span class="rec-time">{{ w.createdAt }}</span>
        </div>
        <div v-if="w.beforeBalance != null || w.afterBalance != null" class="rec-foot">
          余额 {{ fmtMoney(w.beforeBalance) }} → {{ fmtMoney(w.afterBalance) }}
        </div>
        <div v-if="w.reason" class="rec-foot">原因 {{ w.reason }}</div>
        <div v-if="w.status === 'failed' && w.platformMsg" class="rec-foot subtle">平台提示 {{ w.platformMsg }}</div>
        <div class="rec-foot subtle">操作人 {{ w.operatorName || '—' }}（{{ w.operatorRole || '—' }}）· 表号 {{ w.meterNo || '—' }}</div>
      </div>

      <div class="pager">
        <button class="btn ghost" :disabled="writeLogPage <= 1" @click="writeLogPage--; loadWriteLogs()">上一页</button>
        <span class="pager-info">第 {{ writeLogPage }} / {{ writeLogPages }} 页</span>
        <button class="btn ghost" :disabled="writeLogPage >= writeLogPages" @click="writeLogPage++; loadWriteLogs()">下一页</button>
      </div>
    </section>

    <!-- ============ 写操作弹窗 ============ -->
    <div v-if="modal.kind" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">
            {{ modal.kind === 'cash' ? '现金 / 补量收银' :
               modal.kind === 'profile' ? '改名 / 档案维护' :
               modal.kind === 'control' ? '远程控制' :
               modal.kind === 'setrate' ? '多费率设置' :
               modal.kind === 'reduction' ? '欠费减免' : '退费' }}
          </span>
          <button class="modal-close" @click="closeModal" aria-label="关闭">×</button>
        </div>

        <div class="modal-body">
          <!-- 现金 / 补量 -->
          <template v-if="modal.kind === 'cash'">
            <div class="m-target">
              <div class="mt-name">{{ modal.name }}</div>
              <div class="mt-sub">表号 {{ modal.meterNo }} · 当前余额 {{ fmtMoney(modal.ctx?.meter.chargeMoney) }} 元</div>
            </div>
            <label class="m-label">录入方式</label>
            <select v-model="modal.cashMode" class="m-input">
              <option value="cash">现金支付</option>
              <option value="replienish">补量（度数）</option>
            </select>
            <label class="m-label">{{ modal.cashMode === 'replienish' ? '补量度数' : '金额（元）' }}</label>
            <input
              v-model="modal.amount"
              class="m-input"
              type="number"
              inputmode="decimal"
              :placeholder="modal.cashMode === 'replienish' ? '输入补量度数' : '输入金额'"
            />
            <label class="m-label">备注（可选）</label>
            <input v-model="modal.remark" class="m-input" placeholder="如：线下现金收取" />
            <div class="m-hint">
              单笔上限 {{ CASH_LIMIT }} 元；金额 ≥ {{ LARGE_AMOUNT }} 元须勾选下方二次确认。
            </div>
            <label class="m-check">
              <input v-model="modal.confirm" type="checkbox" />
              <span>我已核对金额与收款，确认录入（大额二次确认）</span>
            </label>
          </template>

          <!-- 改名 / 档案 -->
          <template v-if="modal.kind === 'profile'">
            <div class="m-target">
              <div class="mt-name">{{ modal.name }}</div>
              <div class="mt-sub">表号 {{ modal.meterNo }}</div>
            </div>
            <label class="m-label">客户名（住房名）</label>
            <input v-model="modal.houseName" class="m-input" placeholder="如：A5栋-2楼电表" />
            <label class="m-label">业主户名</label>
            <input v-model="modal.userName" class="m-input" placeholder="业主姓名" />
            <label class="m-label">业主电话</label>
            <input v-model="modal.userPhone" class="m-input" type="tel" inputmode="numeric" placeholder="联系电话" />
            <label class="m-label">倍率</label>
            <input v-model="modal.multiply" class="m-input" type="number" step="0.01" />
            <div class="m-hint">只提交有改动的字段；客户名/户名/电话/倍率均会记录前后值与操作人。</div>
          </template>

          <!-- 远程控制 -->
          <template v-if="modal.kind === 'control'">
            <div class="m-target">
              <div class="mt-name">{{ modal.ctx?.meter.houseName || modal.name }}</div>
              <div class="mt-sub">
                表号 {{ modal.meterNo }} ·
                当前 {{ modal.ctx?.meter.meterFlag === '1' ? '合闸(供电)' : '拉闸(断电)' }}
              </div>
            </div>
            <div class="m-danger">
              {{ modal.controlAction === 'wattoff' ? '拉闸将立即停止供电，请现场核实该户可断电。' :
                 modal.controlAction === 'watton' ? '合闸将恢复供电。' :
                 '校时将把表计时钟与平台同步。' }}
            </div>
            <template v-if="modal.controlAction === 'wattoff' || modal.controlAction === 'watton'">
              <label class="m-label">操作原因（必填）</label>
              <input v-model="modal.reason" class="m-input" placeholder="如：欠费催缴断电 / 缴费后恢复" />
              <label class="m-label">请输入住房名确认（必须逐字一致）</label>
              <input v-model="modal.confirmName" class="m-input" :placeholder="modal.ctx?.meter.houseName ?? ''" />
            </template>
            <div v-else class="m-hint">确认无误后点下方按钮执行校时。</div>
          </template>

          <!-- 退费 -->
          <template v-if="modal.kind === 'refund'">
            <div class="m-target">
              <div class="mt-name">{{ modal.name }}</div>
              <div class="mt-sub">
                原充值 {{ fmtMoney(modal.refundForm?.chargeMoney) }} 元 · 表号 {{ modal.refundForm?.meterNo }}
              </div>
            </div>
            <label class="m-label">退费金额（元）</label>
            <input v-model="modal.refundMoney" class="m-input" type="number" inputmode="decimal" />
            <label class="m-label">退费方式</label>
            <select v-model="modal.refundMode" class="m-input" :disabled="modal.refundMode === '1'">
              <option value="0">原路退回</option>
              <option value="1">现金退费</option>
            </select>
            <label class="m-label">备注（可选）</label>
            <input v-model="modal.refundRemark" class="m-input" placeholder="退费原因" />
            <div class="m-hint">
              退费不得超过原充值；现金单（无在线交易号）只能现金退费。金额 ≥ {{ LARGE_AMOUNT }} 元须勾选二次确认。
            </div>
            <label class="m-check">
              <input v-model="modal.refundConfirm" type="checkbox" />
              <span>我已核对原单与退费金额，确认退费（大额二次确认）</span>
            </label>
          </template>

          <template v-if="modal.kind === 'reduction'">
            <div class="m-target">
              <div class="mt-name">{{ modal.name }}</div>
              <div class="mt-sub">
                表号 {{ modal.meterNo }} · 当前余额 {{ fmtMoney(modal.ctx?.meter.chargeMoney) }} 元
              </div>
            </div>
            <label class="m-label">减免金额（元）</label>
            <input v-model="modal.reductionMoney" class="m-input" type="number" inputmode="decimal" placeholder="核销的应收金额" />
            <label class="m-label">减免原因（必填）</label>
            <input v-model="modal.reductionReason" class="m-input" placeholder="如：滞纳金减免 / 协商减免 / 抄表差错" />
            <div class="m-hint">
              减免按该表所属住房核销应收金额，金额为正、≥ {{ LARGE_AMOUNT }} 元须勾选二次确认，操作会记录前后值与操作人。
            </div>
            <label class="m-check">
              <input v-model="modal.reductionConfirm" type="checkbox" />
              <span>我已核对该户欠费与减免金额，确认减免（大额二次确认）</span>
            </label>
          </template>

          <template v-if="modal.kind === 'setrate'">
            <div class="m-target">
              <div class="mt-name">{{ modal.name }}</div>
              <div class="mt-sub">
                表号 {{ modal.meterNo }} · 当前费率 {{ modal.setrateCurrent || '—' }}
              </div>
            </div>
            <label class="m-label">费率方案</label>
            <select v-model="modal.setrateId" class="m-input" :disabled="modal.submitting || modal.setrateOptions.length === 0">
              <option value="" disabled>请选择费率方案</option>
              <option v-for="o in modal.setrateOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <div class="m-danger">
              多费率设置会改变该表计费口径（尖峰平谷费率），仅管理员可操作，误改将影响收费。
            </div>
            <label class="m-label">原因（必填，至少 2 字）</label>
            <input v-model="modal.setrateReason" class="m-input" placeholder="如：切换尖峰平谷费率" />
            <label class="m-label">请输入住房名进行二次确认</label>
            <input v-model="modal.setrateConfirmName" class="m-input" :placeholder="`应为「${modal.name}」`" />
            <div class="m-hint">须逐字输入住房名「{{ modal.name }}」并填写原因，操作记录前后值与操作人。</div>
          </template>
        </div>

        <div class="modal-foot">
          <button class="btn ghost" @click="closeModal">取消</button>
          <button
            v-if="modal.kind === 'cash'"
            class="btn primary"
            :disabled="modal.submitting"
            @click="submitCash"
          >
            {{ modal.submitting ? '提交中…' : '确认录入' }}
          </button>
          <button
            v-if="modal.kind === 'profile'"
            class="btn primary"
            :disabled="modal.submitting"
            @click="submitProfile"
          >
            {{ modal.submitting ? '保存中…' : '保存' }}
          </button>
          <button
            v-if="modal.kind === 'control'"
            class="btn"
            :class="modal.controlAction === 'wattoff' ? 'btn-danger' : 'btn primary'"
            :disabled="modal.submitting"
            @click="submitControl"
          >
            {{ modal.submitting ? '下发中…' : '执行' }}
          </button>
          <button
            v-if="modal.kind === 'refund'"
            class="btn primary"
            :disabled="modal.submitting"
            @click="submitRefund"
          >
            {{ modal.submitting ? '提交中…' : '确认退费' }}
          </button>
          <button
            v-if="modal.kind === 'reduction'"
            class="btn primary"
            :disabled="modal.submitting"
            @click="submitReduction"
          >
            {{ modal.submitting ? '提交中…' : '确认减免' }}
          </button>
          <button
            v-if="modal.kind === 'setrate'"
            class="btn btn-danger"
            :disabled="modal.submitting"
            @click="submitSetRate"
          >
            {{ modal.submitting ? '下发中…' : '确认下发' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </section>
</template>

<style scoped>
.energy-page {
  padding: var(--v2-sp-5);
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

/* ===== 二/三期：写操作按钮与弹窗 ===== */
.meter-actions {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--v2-border-soft);
}
.rec-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.act-cash {
  color: #047857;
  border-color: #a7f3d0;
  background: #ecfdf5;
}
.act-profile {
  color: #1d4ed8;
  border-color: #bfdbfe;
  background: #eff6ff;
}
.act-refund {
  color: #b45309;
  border-color: #fde68a;
  background: #fffbeb;
}
.act-reduction {
  color: #0f766e;
  border-color: #99f6e4;
  background: #f0fdfa;
}
.act-off {
  color: #b91c1c;
  border-color: #fecaca;
  background: #fef2f2;
}
.act-on {
  color: #047857;
  border-color: #a7f3d0;
  background: #ecfdf5;
}
.act-time {
  color: #6d28d9;
  border-color: #ddd6fe;
  background: #f5f3ff;
}
.act-rate {
  color: #b45309;
  border-color: #fde68a;
  background: #fffbeb;
}
.btn-danger {
  background: var(--v2-danger, #dc2626);
  border-color: var(--v2-danger, #dc2626);
  color: #fff;
}

/* 弹窗 */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;
  padding: 0;
}
@media (min-width: 640px) {
  .modal-mask {
    align-items: center;
    padding: 20px;
  }
}
.modal {
  width: 100%;
  max-width: 480px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  background: var(--v2-surf-1, #fff);
  border-radius: 18px 18px 0 0;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
@media (min-width: 640px) {
  .modal {
    border-radius: 18px;
  }
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--v2-border-soft);
}
.modal-title {
  font-size: 16px;
  font-weight: 700;
}
.modal-close {
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  font-size: 24px;
  line-height: 1;
  color: var(--v2-text-3);
  cursor: pointer;
}
.modal-body {
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.m-target {
  background: var(--v2-inset-bg, #f8fafc);
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 8px;
}
.mt-name {
  font-size: 15px;
  font-weight: 700;
}
.mt-sub {
  font-size: 13px;
  color: var(--v2-text-3);
  margin-top: 4px;
}
.m-label {
  font-size: 13px;
  color: var(--v2-text-2);
  margin-top: 10px;
}
.m-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--v2-border-soft);
  border-radius: 10px;
  font-size: 16px;
  background: var(--v2-inset-bg, #fff);
  color: var(--v2-text-1);
}
.m-hint {
  font-size: 12px;
  color: var(--v2-text-3);
  line-height: 1.6;
  margin-top: 8px;
}
.m-danger {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  font-size: 13px;
  line-height: 1.5;
}
.m-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.5;
}
.m-check input {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  flex-shrink: 0;
}
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid var(--v2-border-soft);
}
.modal-foot .btn {
  min-height: 44px;
  flex: 1;
}
.modal-foot .btn.ghost {
  flex: 0 0 96px;
}
</style>
