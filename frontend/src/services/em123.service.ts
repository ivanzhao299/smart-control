import { api, http } from './http';

/**
 * em123 贝林智慧能源平台 —— PWA 能源管理后台一期（只读）。
 *
 * 大屏聚合: overview / tree（公开，与运营大屏共用）。
 * 后台管理（仅 admin）: arrears 欠费 / charges 缴费流水 / controlRecords 控制记录 /
 *                       exportXlsx 一键导出 / readout 只读召测。
 * 不做任何写操作（拉合闸/改名/充值/退费等都在二期以后逐项授权）。
 */

export type Em123MeterType = 'E' | 'W';

/** 单块表视图（下钻明细，字段对齐后端 Em123MeterView）。 */
export interface Em123MeterView {
  meterNo: string;
  type: Em123MeterType;
  name: string;
  zone: string | null;
  areaGroup: string | null;
  building: string | null;
  buildingName: string;
  room: string | null;
  kind: 'master' | 'household';
  tag: string | null;
  modelName: string | null;
  multiply: number;
  readingValue: number;
  reading: number;
  readingTime: string | null;
  today: number;
  month: number;
  money: number;
  arrears: boolean;
  online: boolean;
  cutOff: boolean;
  alarm: string | null;
}

export interface Em123Group {
  key: string;
  name: string;
  zone: string | null;
  kind: 'master' | 'household' | 'mixed';
  meterCount: number;
  online: number;
  offline: number;
  arrears: number;
  cutOff: number;
  masterReading: number;
  householdReading: number;
  masterToday: number;
  householdToday: number;
  masterMonth: number;
  householdMonth: number;
  today: number;
  month: number;
  meters: Em123MeterView[];
}

export interface Em123TypeSummary {
  type: Em123MeterType;
  unit: string;
  totalMeters: number;
  online: number;
  offline: number;
  arrears: number;
  cutOff: number;
  masterCount: number;
  householdCount: number;
  today: number;
  month: number;
  totalReading: number;
  master: { count: number; today: number; month: number; totalReading: number };
  household: { count: number; today: number; month: number; totalReading: number };
  monthDiff: number;
  zones: unknown[];
  groups: Em123Group[];
  daySeries: { date: string; value: number }[];
  monthSeries: { month: string; value: number }[];
  latestDate: string | null;
}

export interface Em123Overview {
  enabled: boolean;
  ok: boolean;
  loading: boolean;
  stale: boolean;
  updatedAt: string | null;
  error: string | null;
  electric: Em123TypeSummary | null;
  water: Em123TypeSummary | null;
  load?: unknown;
  transformers?: unknown;
}

/** 缴费流水行（平台原始字段）。 */
export interface Em123ChargeRow {
  recordId?: number;
  createTime?: string;
  houseName?: string;
  userName?: string;
  meterNo?: string;
  orderNo?: string;
  tradeNo?: string | null;
  oldMoney?: number;
  chargeMoney?: number;
  newMoney?: number;
  chargeWay?: string;
  chargeMode?: string;
  chargeStatus?: number;
  createBy?: string;
  remark?: string | null;
  [key: string]: unknown;
}

/** 控制记录行（平台原始字段）。 */
export interface Em123ControlRow {
  recordId?: number;
  createTime?: string;
  updateTime?: string;
  houseName?: string;
  meterNo?: string;
  meterType?: string;
  controlCode?: string;
  controlName?: string;
  returnFlag?: string;
  createBy?: string;
  controlHex?: string;
  controlOrder?: string;
  returnOrder?: string;
  remark?: string | null;
  [key: string]: unknown;
}

export interface Em123Paged<T> {
  rows: T[];
  total: number;
}

/** 欠费结果：分户欠费 与 关口总表透支 两个口径分开。 */
export interface Em123Arrears {
  type: Em123MeterType;
  household: { count: number; amount: number; list: Em123MeterView[] };
  master: { count: number; amount: number; list: Em123MeterView[] };
}

export interface Em123ListQuery {
  pageNum?: number;
  pageSize?: number;
  beginTime?: string;
  endTime?: string;
  meterNo?: string;
  houseName?: string;
  chargeMode?: string;
  chargeWay?: string;
  status?: string;
  controlType?: string;
  [key: string]: string | number | undefined;
}

// ============ 二/三期：写操作类型 ============

/** 平台原始行（字段动态，弱类型）。 */
export type Em123RawRow = Record<string, unknown>;

/** 写操作结果（平台 code=0 成功；未确认由后端 409 抛出）。 */
export interface Em123WriteResult {
  ok: boolean;
  code?: number;
  msg?: string;
  raw?: unknown;
  beforeBalance?: number;
  afterBalance?: number;
}

/** 按表号回显的"改名/档案/收银"上下文。 */
export interface Em123MeterContext {
  meterType: Em123MeterType;
  meter: {
    meterId: number;
    meterNo: string;
    meterType: string;
    houseId: number | null;
    houseName: string | null;
    userId: number | null;
    multiply: number;
    priceId: number | null;
    priceName: string | null;
    meterModel?: string | null;
    modelName?: string | null;
    chargeMoney: number;
    meterFlag: string | null;
    connType: string | null;
    deviceImei: string | null;
    alarmId?: number | null;
    alarmName?: string | null;
    remark?: string | null;
  };
  house: {
    houseId: number;
    houseName: string;
    fullName?: string | null;
    parentId?: number | null;
    remark?: string | null;
  } | null;
  user: {
    userId: number;
    userName: string;
    userPhone?: string | null;
    userNumber?: string | null;
    houseIds?: unknown;
    houseId?: unknown;
    houseName?: string | null;
    remark?: string | null;
  } | null;
}

/** 退费表单回显（系统生成的 refundNo/seleNo 等 hidden 必须原样回填）。 */
export interface Em123RefundForm {
  recordId: string;
  hidden: Record<string, string>;
  chargeMoney: number | null;
  houseId: number | string | null;
  meterId: number | string | null;
  userId: number | string | null;
  houseName: string | null;
  meterNo: string | null;
  userName: string | null;
}

/** 多费率设置回显：费率方案（rateId）下拉。 */
export interface Em123SetRateForm {
  meterId: string;
  meterNo: string;
  houseName: string;
  currentPriceName: string | null;
  rateOptions: { value: string; label: string }[];
}

/** 写操作留痕（对账）。 */
export interface Em123WriteLog {
  id: number;
  bizType: string;
  meterType: string | null;
  meterNo: string | null;
  meterId: string | null;
  houseId: string | null;
  houseName: string | null;
  userName: string | null;
  amount: number;
  beforeBalance: number | null;
  afterBalance: number | null;
  reason: string | null;
  payloadBefore: string | null;
  payloadAfter: string | null;
  platformCode: number | null;
  platformMsg: string | null;
  status: string;
  operatorId: number | null;
  operatorName: string | null;
  operatorRole: string | null;
  createdAt: string;
}

export type Em123ControlAction = 'wattoff' | 'watton' | 'settime';

/** 写操作业务类型 → 中文。 */
export function writeBizTypeLabel(t?: string): string {
  const map: Record<string, string> = {
    house_rename: '住房改名',
    user_rename: '业主改名',
    meter_edit: '表档案',
    charge_cash: '现金充值',
    charge_supplement: '补量',
    refund: '退费',
    reduction: '减免',
    control_off: '拉闸断电',
    control_on: '合闸送电',
    settime: '表计校时',
    setrate: '多费率设置',
  };
  return (t && map[t]) || t || '—';
}

// ============ 展示辅助（平台字典 → 中文） ============

/** 缴费方式：现金/补量（物业人工录入） vs 微信在线（业主自助，汇付）。 */
export function chargeModeLabel(mode?: string, way?: string): string {
  if (mode === 'wxpay' || way === 'huifupay') return '微信在线';
  if (mode === 'cash' || way === 'pc') return '现金/补量';
  return mode || way || '—';
}

/** 缴费状态：chargeStatus=1 成功。 */
export function chargeStatusLabel(status?: number): { text: string; ok: boolean } {
  return status === 1 ? { text: '成功', ok: true } : { text: '失败/未完成', ok: false };
}

/** 控制结果：returnFlag=1 成功。 */
export function controlResultLabel(flag?: string): { text: string; ok: boolean } {
  return String(flag ?? '') === '1' ? { text: '成功', ok: true } : { text: '失败/无应答', ok: false };
}

function todayStr(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const em123Service = {
  /** 大屏聚合总览（电/水）。 */
  overview: () => api.get<Em123Overview>('/em123/overview'),

  /** 分区→楼栋→逐表下钻树。 */
  tree: (type: Em123MeterType) =>
    api.get<Em123TypeSummary>('/em123/tree', { params: { type } }),

  /** 欠费/透支明细（仅 admin）。 */
  arrears: (type: Em123MeterType) =>
    api.get<Em123Arrears>('/em123/arrears', { params: { type } }),

  /** 缴费流水分页（仅 admin）。 */
  charges: (q: Em123ListQuery) =>
    api.get<Em123Paged<Em123ChargeRow>>('/em123/charges', { params: q }),

  /** 控制记录分页（仅 admin）。 */
  controlRecords: (q: Em123ListQuery) =>
    api.get<Em123Paged<Em123ControlRow>>('/em123/control-records', { params: q }),

  /** 只读召测（仅触发一次抄表，不改状态；仅 admin）。入参 meterNo + type。 */
  readout: (meterNo: string, type: Em123MeterType) =>
    api.post<{ code?: number; msg?: string }>('/em123/readout', { meterNo, type }),

  /**
   * 一键导出平台真实 xlsx（后端两步代理，返回 Blob 后浏览器下载）。
   * @param kind meter=表档案 / charge=缴费流水 / usage=用量报表
   */
  async exportXlsx(
    kind: 'meter' | 'charge' | 'usage',
    params: { meterType?: Em123MeterType; beginTime?: string; endTime?: string; chargeMode?: string } = {},
  ): Promise<void> {
    const { data: blob } = await http.request<Blob>(
      'GET',
      '/em123/export',
      undefined,
      { params: { kind, ...params }, responseType: 'blob', timeout: 60_000 },
    );
    const t = todayStr();
    const nameMap: Record<string, string> = {
      meter: `贝林表档案_${params.meterType === 'W' ? '水表' : '电表'}_${t}.xlsx`,
      charge: `贝林缴费流水_${t}.xlsx`,
      usage: `贝林用量报表_${t}.xlsx`,
    };
    downloadBlob(blob, nameMap[kind]);
  },

  // ============ 二/三期：写操作（全部走后端代理，后端二次校验+留痕） ============

  /** 住房（客户名）实时列表。 */
  houses: (keyword?: string, limit = 100) =>
    api.get<Em123RawRow[]>('/em123/houses', { params: { keyword, limit } }),

  /** 业主（户名）实时列表。 */
  users: (q: Record<string, string | number>) =>
    api.get<Em123Paged<Em123RawRow>>('/em123/users', { params: q }),

  /** 按表号回显改名/档案/收银上下文。 */
  meterContext: (type: Em123MeterType, meterNo: string) =>
    api.get<Em123MeterContext>('/em123/meter-context', { params: { type, meterNo } }),

  /** 退费表单回显。 */
  refundForm: (recordId: string | number) =>
    api.get<Em123RefundForm>(`/em123/refund-form/${recordId}`),

  /** 住房（客户名）改名。 */
  renameHouse: (body: {
    houseId: string | number;
    houseName: string;
    fullName?: string;
    parentId?: string | number;
    remark?: string;
  }) => api.post<Em123WriteResult>('/em123/house/rename', body),

  /** 业主（户名/电话）改名。 */
  renameUser: (body: {
    userId: string | number;
    userName: string;
    userPhone?: string;
    remark?: string;
  }) => api.post<Em123WriteResult>('/em123/user/rename', body),

  /** 表档案维护（倍率/价格/型号/备注）。 */
  editMeter: (body: {
    meterType: Em123MeterType;
    meterNo: string;
    fields: Record<string, string | number>;
  }) => api.post<Em123WriteResult>('/em123/meter/edit', body),

  /** 现金/补量录入（大额需 confirm）。 */
  charge: (body: {
    meterType: Em123MeterType;
    meterNo: string;
    mode: 'cash' | 'replienish';
    amount: number;
    remark?: string;
    confirm?: boolean;
  }) => api.post<Em123WriteResult>('/em123/charge', body),

  /** 退费（不得超原额；现金单强制现金退费）。 */
  refund: (body: {
    recordId: string | number;
    refundMoney: number;
    refundMode?: '0' | '1';
    remark?: string;
    confirm?: boolean;
  }) => api.post<Em123WriteResult>('/em123/refund', body),

  /** 减免（按该表所属住房核销应收，金额为正、大额二次确认）。 */
  reduction: (body: {
    meterType: Em123MeterType;
    meterNo: string;
    reductionMoney: number;
    reason?: string;
    confirm?: boolean;
  }) => api.post<Em123WriteResult>('/em123/reduction', body),

  /** 远程控制：拉闸/合闸/校时（仅 admin，拉合闸须户名+原因）。 */
  control: (body: {
    action: Em123ControlAction;
    meterType: Em123MeterType;
    meterNo: string;
    reason?: string;
    confirmName?: string;
  }) => api.post<Em123WriteResult>('/em123/control', body),

  /** 多费率设置回显（费率方案下拉）。 */
  setrateForm: (meterType: Em123MeterType, meterNo: string) =>
    api.get<Em123SetRateForm>('/em123/setrate-form', { params: { meterType, meterNo } }),

  /** 多费率设置下发（仅 admin，选方案 + 住房名强确认 + 原因）。 */
  setRate: (body: {
    meterType: Em123MeterType;
    meterNo: string;
    rateId: string;
    reason?: string;
    confirmName?: string;
  }) => api.post<Em123WriteResult>('/em123/setrate', body),

  /** 写操作对账清单。 */
  writeLogs: (q: {
    pageNum?: number;
    pageSize?: number;
    bizType?: string;
    meterNo?: string;
    operator?: string;
    startDate?: string;
    endDate?: string;
  }) => api.get<Em123Paged<Em123WriteLog>>('/em123/write-logs', { params: q }),
};
