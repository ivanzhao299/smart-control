import { api } from './http';

/**
 * 运营大屏「业务数字文档」——与 backend park-ops-metrics.controller、
 * frontend/public/park-ops/ops-data-model.mjs 三处对齐。
 *
 * 权威数据为 SQLite 版本文档，不再写 JSON 文件：
 *   GET /api/park-ops-metrics 保持大屏公开读取契约；编辑器走管理员 /editor 版本接口。
 * 人/车(people/vehicles)语义为「AI 实时数的基线」: 大屏显示 = 基线 + 各门净增。
 */
export interface ParkOpsMetricsDoc {
  version: 1;
  source: string;
  updatedAt: string;
  placeholderKeys: string[];
  metrics: Record<string, number | null>;
  content: Record<string, string | string[]>;
}

export interface FieldMeta {
  key: string;
  label: string;
  unit: string;
  digits: number;
  /** 展示时是否加「约」前缀 */
  approx: boolean;
  group: string;
}

/** 与 ops-data-model.mjs fields 保持一致的字段表 (用于表单分组/单位/整数约束) */
export const FIELDS: FieldMeta[] = [
  { key: 'plannedLand', label: '总规划用地', unit: '亩', digits: 0, approx: true, group: '总体规划' },
  { key: 'plannedFloor', label: '规划总建筑面积', unit: '万㎡', digits: 0, approx: true, group: '总体规划' },
  { key: 'plannedInvestment', label: '计划总投资', unit: '亿元', digits: 0, approx: true, group: '总体规划' },
  { key: 'builtLand', label: '已建成部分占地', unit: '亩', digits: 0, approx: false, group: '一期、二期已建成' },
  { key: 'builtFloor', label: '已建成建筑面积', unit: '万㎡', digits: 2, approx: false, group: '一期、二期已建成' },
  { key: 'builtCountedFloor', label: '已建成计容建筑面积', unit: '万㎡', digits: 2, approx: false, group: '一期、二期已建成' },
  { key: 'signedTenants', label: '累计签约入驻企业', unit: '家', digits: 0, approx: false, group: '招商运营' },
  { key: 'occupancy', label: '入驻率', unit: '%', digits: 0, approx: true, group: '招商运营' },
  { key: 'annualOutput', label: '本年度产值', unit: '亿元', digits: 2, approx: false, group: '年度经营' },
  { key: 'annualTax', label: '本年度税收', unit: '万元', digits: 0, approx: false, group: '年度经营' },
  { key: 'people', label: '当前在园人员(AI基线)', unit: '人', digits: 0, approx: false, group: '人员管理' },
  { key: 'visitors', label: '今日访客', unit: '人', digits: 0, approx: false, group: '人员管理' },
  { key: 'servicePeople', label: '施工 / 服务人员', unit: '人', digits: 0, approx: false, group: '人员管理' },
  { key: 'peoplePasses', label: '今日人员累计通行', unit: '次', digits: 0, approx: false, group: '人员管理' },
  { key: 'vehicles', label: '当前在场车辆(AI基线)', unit: '辆', digits: 0, approx: false, group: '车辆管理' },
  { key: 'vehiclePasses', label: '今日车辆通行', unit: '次', digits: 0, approx: false, group: '车辆管理' },
  { key: 'freightVehicles', label: '货运车辆', unit: '辆', digits: 0, approx: false, group: '车辆管理' },
  { key: 'parkingRate', label: '停车位占用率', unit: '%', digits: 0, approx: false, group: '车辆管理' },
  { key: 'camerasOnline', label: '摄像头在线', unit: '路', digits: 0, approx: false, group: '视频安防' },
  { key: 'camerasOffline', label: '摄像头离线', unit: '路', digits: 0, approx: false, group: '视频安防' },
  { key: 'cameraRate', label: '摄像头在线率', unit: '%', digits: 1, approx: false, group: '视频安防' },
  { key: 'cameraPoints', label: '重点监控点位', unit: '个', digits: 0, approx: false, group: '视频安防' },
  { key: 'safetyAlerts', label: '重大安全告警', unit: '起', digits: 0, approx: false, group: '消防管理' },
  { key: 'fireRate', label: '消防设备在线率', unit: '%', digits: 1, approx: false, group: '消防管理' },
  { key: 'inspections', label: '今日巡检点位', unit: '个', digits: 0, approx: false, group: '消防管理' },
  { key: 'hazards', label: '一般隐患整改中', unit: '项', digits: 0, approx: false, group: '消防管理' },
  { key: 'outputTarget', label: '年度产值目标完成率', unit: '%', digits: 0, approx: false, group: '经营与载体' },
  { key: 'taxTarget', label: '年度税收目标完成率', unit: '%', digits: 0, approx: false, group: '经营与载体' },
  { key: 'activity', label: '重点企业生产活跃度', unit: '%', digits: 0, approx: false, group: '经营与载体' },
  { key: 'aboveScale', label: '规上企业占比', unit: '%', digits: 0, approx: false, group: '经营与载体' },
  { key: 'highTech', label: '高新技术企业占比', unit: '%', digits: 0, approx: false, group: '经营与载体' },
  { key: 'usedFloor', label: '已使用产业空间', unit: '万㎡', digits: 1, approx: false, group: '经营与载体' },
  { key: 'availableFloor', label: '可招商空间', unit: '万㎡', digits: 1, approx: false, group: '经营与载体' },
  { key: 'standardRate', label: '标准厂房使用率', unit: '%', digits: 0, approx: false, group: '经营与载体' },
  { key: 'gardenRate', label: '花园式厂房使用率', unit: '%', digits: 0, approx: false, group: '经营与载体' },
  { key: 'officeRate', label: '研发办公使用率', unit: '%', digits: 0, approx: false, group: '经营与载体' },
  ...[4, 5, 6, 7, 8, 9].map((m) => ({ key: `outputMonth${m}`, label: `${m}月产值`, unit: '亿元', digits: 2, approx: false, group: '月度产值' })),
  ...[4, 5, 6, 7, 8, 9].map((m) => ({ key: `safetyMonth${m}`, label: `${m}月安全趋势`, unit: '项', digits: 0, approx: false, group: '安全趋势' })),
  { key: 'industryManufacturing', label: '智能制造', unit: '%', digits: 0, approx: false, group: '产业结构(合计100%)' },
  { key: 'industryEquipment', label: '高端装备', unit: '%', digits: 0, approx: false, group: '产业结构(合计100%)' },
  { key: 'industryMaterials', label: '新材料', unit: '%', digits: 0, approx: false, group: '产业结构(合计100%)' },
  { key: 'industryElectronics', label: '电子信息', unit: '%', digits: 0, approx: false, group: '产业结构(合计100%)' },
  { key: 'industryServices', label: '数字服务', unit: '%', digits: 0, approx: false, group: '产业结构(合计100%)' },
  { key: 'workPending', label: '待处理工单', unit: '项', digits: 0, approx: false, group: '服务工单' },
  { key: 'workProgress', label: '处理中工单', unit: '项', digits: 0, approx: false, group: '服务工单' },
  { key: 'workCompleted', label: '已完成工单', unit: '项', digits: 0, approx: false, group: '服务工单' },
];

export const INDUSTRY_KEYS = ['industryManufacturing', 'industryEquipment', 'industryMaterials', 'industryElectronics', 'industryServices'];
/** 离散整数单位 (与大屏 validate 一致) */
const INT_UNITS = new Set(['人', '次', '辆', '路', '个', '起', '项', '家']);

export interface CopyFieldMeta { key: string; label: string; isList: boolean }
export const COPY_FIELDS: CopyFieldMeta[] = [
  { key: 'stage', label: '建设状态', isList: false },
  { key: 'focus', label: '产业方向', isList: false },
  { key: 'construction', label: '重点建设内容', isList: false },
  { key: 'flexibility', label: '空间使用说明', isList: false },
  { key: 'serviceSummary', label: '综合服务说明', isList: false },
  { key: 'occupancyNote', label: '入驻率统计说明', isList: false },
  { key: 'awards', label: '项目荣誉（每行一项）', isList: true },
  { key: 'factoryTypes', label: '厂房类型（每行一项）', isList: true },
  { key: 'facilities', label: '服务配套（每行一项）', isList: true },
  { key: 'companies', label: '部分入驻企业（每行一家）', isList: true },
  { key: 'fireSystems', label: '消防系统状态（每行一项）', isList: true },
  { key: 'inspectionEvents', label: '巡检事件（每行一项）', isList: true },
  { key: 'gateEvents', label: '门岗事件（每行一项）', isList: true },
  { key: 'workOrderEvents', label: '工单示例（每行：事项 · 位置 · 状态）', isList: true },
];

const DEFAULT_METRICS: Record<string, number> = {
  plannedLand: 660, plannedFloor: 68, plannedInvestment: 26,
  builtLand: 171, builtFloor: 14.43, builtCountedFloor: 19.4,
  signedTenants: 26, occupancy: 85,
  annualOutput: 8.76, annualTax: 4260, people: 486, visitors: 18,
  servicePeople: 29, peoplePasses: 813,
  vehicles: 127, vehiclePasses: 312, freightVehicles: 21, parkingRate: 64,
  camerasOnline: 128, camerasOffline: 3, cameraRate: 97.7, cameraPoints: 12,
  safetyAlerts: 0, fireRate: 99.2, inspections: 26, hazards: 2,
  outputTarget: 73, taxTarget: 69, activity: 81, aboveScale: 44, highTech: 38,
  usedFloor: 6.8, availableFloor: 3.2, standardRate: 74, gardenRate: 61, officeRate: 57,
  outputMonth4: 0.58, outputMonth5: 0.73, outputMonth6: 0.81, outputMonth7: 0.94, outputMonth8: 1.02, outputMonth9: 1.08,
  safetyMonth4: 7, safetyMonth5: 6, safetyMonth6: 5, safetyMonth7: 4, safetyMonth8: 3, safetyMonth9: 2,
  industryManufacturing: 28, industryEquipment: 22, industryMaterials: 17, industryElectronics: 17, industryServices: 16,
  workPending: 6, workProgress: 8, workCompleted: 42,
};

const DEFAULT_CONTENT: Record<string, string | string[]> = {
  stage: '一期、二期已经建成',
  focus: '以智能制造和新材料为重点，多种产业协同发展',
  construction: '重点建设标准厂房、研发办公、数字展贸、仓储物流以及生产生活配套设施。',
  flexibility: '单体空间可以灵活分割和组合，满足企业生产制造、设备安装、研发办公、产品展示和仓储物流等不同需求。',
  serviceSummary: '逐步形成集生产、研发、办公、展示、交易和生活服务于一体的综合产业空间。',
  occupancyNote: '入驻率采用业主提供的口径；统计分母与统计日期待业务接口确认，不以企业数推算。',
  awards: ['山东省新旧动能转换优选项目', '山东省绿色低碳高质量发展重点项目', '临沂市重点项目'],
  factoryTypes: ['临街厂房', '三层标准厂房', '花园式厂房', '高标准厂房'],
  facilities: ['办公楼', '数字展贸中心', '企业服务中心', '人才公寓', '员工餐厅', '新能源汽车充电站', '会议接待', '餐饮住宿'],
  companies: ['金湖新材料', '希美克门窗', '泓润卫生用品', '中盛新材料', '金特夫人造草坪'],
  fireSystems: ['火灾报警系统 · 在线', '消防水系统 · 正常', '应急照明系统 · 正常', '重点部位巡检 · 完成'],
  inspectionEvents: ['消防通道检查 · 6#厂房 · 已完成', '灭火器点检 · 展贸中心 · 已完成', '电气箱规范 · 9#厂房 · 整改中', '疏散标识检查 · 研发办公 · 已完成'],
  gateEvents: ['19:36 · 访客车辆 鲁Q·3***8 入园', '19:31 · 货运车辆 鲁Q·7***1 入园', '19:28 · 3#厂房预约来访 6 人', '19:22 · 员工车辆 鲁Q·2***6 离园'],
  workOrderEvents: ['公共照明检修 · 园区道路 · 处理中', '空调设备报修 · 企业服务中心 · 待处理', '环境保洁服务 · 公共区域 · 已完成'],
};

/** 服务端从未发布时的完整出厂文档 (字段齐全, 保证大屏 validate 通过) */
export function buildDefaultDoc(): ParkOpsMetricsDoc {
  const notPlaceholder = new Set(['people', 'vehicles', 'camerasOnline', 'camerasOffline', 'cameraRate', 'safetyAlerts', 'fireRate', 'outputTarget', 'taxTarget', 'activity', 'workPending', 'workProgress', 'workCompleted', 'visitors', 'vehiclePasses', 'builtLand', 'builtFloor', 'builtCountedFloor', 'hazards', 'inspections']);
  return {
    version: 1,
    source: '业主提供的园区介绍 · 2026年9月10日本版口径',
    updatedAt: '2026-09-10T00:00:00+08:00',
    placeholderKeys: FIELDS.slice(10).map((f) => f.key).filter((k) => !notPlaceholder.has(k)),
    metrics: { ...DEFAULT_METRICS },
    content: JSON.parse(JSON.stringify(DEFAULT_CONTENT)),
  };
}

/** 与大屏 ops-data-model.validate 等价的前端校验, 不合法直接抛中文错误 */
export function validateDoc(input: ParkOpsMetricsDoc): ParkOpsMetricsDoc {
  if (!input || input.version !== 1 || typeof input.metrics !== 'object' || !input.metrics || typeof input.content !== 'object') {
    throw new Error('数据格式错误：需要 version=1、metrics 和 content');
  }
  const out: ParkOpsMetricsDoc = { version: 1, source: '', updatedAt: '', placeholderKeys: [], metrics: {}, content: {} };
  if (!Array.isArray(input.placeholderKeys)) throw new Error('占位标记格式错误');
  const validKeys = new Set(FIELDS.map((f) => f.key));
  if (input.placeholderKeys.some((k) => !validKeys.has(k))) throw new Error('占位标记含未知字段');
  out.placeholderKeys = [...new Set(input.placeholderKeys)];
  if (typeof input.source !== 'string' || !input.source.trim() || input.source.length > 200) throw new Error('请填写数据来源（最多200字）');
  if (typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt))) throw new Error('数据日期无效');
  out.source = input.source.trim();
  out.updatedAt = input.updatedAt;
  for (const f of FIELDS) {
    const value = input.metrics[f.key];
    if (value !== null && value !== undefined) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1e9 || (f.unit === '%' && n > 100)) {
        throw new Error(`${f.label}须为非负数字${f.unit === '%' ? '且不超过100' : ''}，未知请留空`);
      }
      if (INT_UNITS.has(f.unit) && !Number.isInteger(n)) throw new Error(`${f.label}须为整数`);
      out.metrics[f.key] = n;
    } else {
      out.metrics[f.key] = null;
    }
  }
  const shares = INDUSTRY_KEYS.map((k) => out.metrics[k]);
  if (shares.every((v) => v !== null) && Math.abs(shares.reduce((s, v) => s + Number(v), 0) - 100) > 0.001) {
    throw new Error('产业结构五项占比合计须为 100%');
  }
  for (const cf of COPY_FIELDS) {
    const value = input.content[cf.key];
    if (cf.isList) {
      if (!Array.isArray(value) || value.length > 100 || value.some((x) => typeof x !== 'string' || !x.trim() || x.length > 120)) {
        throw new Error(`${cf.label}格式错误（最多100项，每项120字）`);
      }
      out.content[cf.key] = value.map((x) => x.trim());
    } else {
      if (typeof value !== 'string' || value.length > 1000) throw new Error(`${cf.label}最多1000字`);
      out.content[cf.key] = value;
    }
  }
  return out;
}

export async function fetchParkOpsMetrics(): Promise<ParkOpsMetricsDoc | null> {
  return api.get<ParkOpsMetricsDoc | null>('/park-ops-metrics');
}

export interface ParkOpsMetricsSnapshot {
  document: ParkOpsMetricsDoc | null;
  revision: number;
  checksum: string | null;
  updatedAt: string | null;
}

export async function fetchParkOpsMetricsSnapshot(): Promise<ParkOpsMetricsSnapshot> {
  return api.get<ParkOpsMetricsSnapshot>('/park-ops-metrics/editor');
}

export async function saveParkOpsMetrics(doc: ParkOpsMetricsDoc, expectedRevision: number): Promise<ParkOpsMetricsSnapshot> {
  return api.put<ParkOpsMetricsSnapshot>('/park-ops-metrics/editor', { document: doc, expectedRevision });
}

/** 页面按字段表分组后的有序分组名 */
export const FIELD_GROUPS: string[] = [...new Set(FIELDS.map((f) => f.group))];
