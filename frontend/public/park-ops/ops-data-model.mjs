// Business content is deliberately separate from parkOpsConfigJson (map calibration).
export const STORAGE_KEY = 'sc.park-ops.business-preview.v1';
export const fields = [
  ['plannedLand', '总规划用地', '亩', 0, true, '总体规划'],
  ['plannedFloor', '规划总建筑面积', '万㎡', 0, true, '总体规划'],
  ['plannedInvestment', '计划总投资', '亿元', 0, true, '总体规划'],
  ['builtLand', '已建成部分占地', '亩', 0, false, '一期、二期已建成'],
  ['builtFloor', '已建成建筑面积', '万㎡', 2, false, '一期、二期已建成'],
  ['builtCountedFloor', '已建成计容建筑面积', '万㎡', 2, false, '一期、二期已建成'],
  ['signedTenants', '累计签约入驻企业', '家', 0, false, '招商运营'],
  ['occupancy', '入驻率', '%', 0, true, '招商运营'],
  ['annualOutput', '本年度产值', '亿元', 2, false, '年度经营 · 本版数字'],
  ['annualTax', '本年度税收', '万元', 0, false, '年度经营 · 本版数字'],
  ['people', '当前在园人员', '人', 0, false, '人员管理'],
  ['visitors', '今日访客', '人', 0, false, '人员管理'],
  ['servicePeople', '施工 / 服务人员', '人', 0, false, '人员管理'],
  ['peoplePasses', '今日人员累计通行', '次', 0, false, '人员管理'],
  ['vehicles', '当前在场车辆', '辆', 0, false, '车辆管理'],
  ['vehiclePasses', '今日车辆通行', '次', 0, false, '车辆管理'],
  ['freightVehicles', '货运车辆', '辆', 0, false, '车辆管理'],
  ['parkingRate', '停车位占用率', '%', 0, false, '车辆管理'],
  ['camerasOnline', '摄像头在线', '路', 0, false, '视频安防'],
  ['camerasOffline', '摄像头离线', '路', 0, false, '视频安防'],
  ['cameraRate', '摄像头在线率', '%', 1, false, '视频安防'],
  ['cameraPoints', '重点监控点位', '个', 0, false, '视频安防'],
  ['safetyAlerts', '重大安全告警', '起', 0, false, '消防管理'],
  ['fireRate', '消防设备在线率', '%', 1, false, '消防管理'],
  ['inspections', '今日巡检点位', '个', 0, false, '消防管理'],
  ['hazards', '一般隐患整改中', '项', 0, false, '消防管理'],
  ['outputTarget', '年度产值目标完成率', '%', 0, false, '经营与载体'],
  ['taxTarget', '年度税收目标完成率', '%', 0, false, '经营与载体'],
  ['activity', '重点企业生产活跃度', '%', 0, false, '经营与载体'],
  ['aboveScale', '规上企业占比', '%', 0, false, '经营与载体'],
  ['highTech', '高新技术企业占比', '%', 0, false, '经营与载体'],
  ['usedFloor', '已使用产业空间', '万㎡', 1, false, '经营与载体'],
  ['availableFloor', '可招商空间', '万㎡', 1, false, '经营与载体'],
  ['standardRate', '标准厂房使用率', '%', 0, false, '经营与载体'],
  ['gardenRate', '花园式厂房使用率', '%', 0, false, '经营与载体'],
  ['officeRate', '研发办公使用率', '%', 0, false, '经营与载体'],
  ...[4, 5, 6, 7, 8, 9].map(month => [`outputMonth${month}`, `${month}月产值`, '亿元', 2, false, '月度产值占位 · 不参与年度汇总']),
  ...[4, 5, 6, 7, 8, 9].map(month => [`safetyMonth${month}`, `${month}月安全趋势`, '项', 0, false, '安全趋势占位']),
  ['industryManufacturing', '智能制造', '%', 0, false, '产业结构 · 原版占位'],
  ['industryEquipment', '高端装备', '%', 0, false, '产业结构 · 原版占位'],
  ['industryMaterials', '新材料', '%', 0, false, '产业结构 · 原版占位'],
  ['industryElectronics', '电子信息', '%', 0, false, '产业结构 · 原版占位'],
  ['industryServices', '数字服务', '%', 0, false, '产业结构 · 原版占位'],
  ['workPending', '待处理工单', '项', 0, false, '服务工单 · 示例占位'],
  ['workProgress', '处理中工单', '项', 0, false, '服务工单 · 示例占位'],
  ['workCompleted', '已完成工单', '项', 0, false, '服务工单 · 示例占位'],
];
export const industryKeys = fields.filter(f => f[5] === '产业结构 · 原版占位').map(f => f[0]);
const addedMetricKeys = [...industryKeys, 'workPending', 'workProgress', 'workCompleted'];
export const copyFields = [
  ['stage', '建设状态', false], ['focus', '产业方向', false],
  ['construction', '重点建设内容', false], ['flexibility', '空间使用说明', false],
  ['serviceSummary', '综合服务说明', false], ['occupancyNote', '入驻率统计说明', false],
  ['awards', '项目荣誉（每行一项）', true], ['factoryTypes', '厂房类型（每行一项）', true],
  ['facilities', '服务配套（每行一项）', true], ['companies', '部分入驻企业（每行一家）', true],
  ['fireSystems', '消防系统状态占位（每行一项）', true],
  ['inspectionEvents', '巡检事件占位（每行一项）', true],
  ['gateEvents', '门岗事件占位（每行一项）', true],
  ['workOrderEvents', '工单示例（每行一项：事项 · 位置 · 状态）', true],
];
export const defaults = {
  version: 1,
  source: '业主提供的园区介绍 · 2026年9月10日本版口径',
  updatedAt: '2026-09-10T00:00:00+08:00',
  placeholderKeys: fields.slice(10).map(([key]) => key),
  metrics: {
    plannedLand: 660, plannedFloor: 68, plannedInvestment: 26,
    builtLand: 171, builtFloor: 14.43, builtCountedFloor: 19.40,
    signedTenants: 32, occupancy: 68,
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
  },
  content: {
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
  },
};
export function validate(input) {
  if (!input || input.version !== 1 || typeof input.metrics !== 'object' || !input.metrics || !input.content) throw Error('数据格式错误，需要 version=1、metrics 和 content');
  const output = { version: 1, source: '', updatedAt: '', placeholderKeys: [], metrics: {}, content: {} };
  if (!Array.isArray(input.placeholderKeys) || input.placeholderKeys.some(key => !fields.some(f => f[0] === key))) throw Error('placeholderKeys须为有效的占位指标名称列表');
  output.placeholderKeys = [...new Set(input.placeholderKeys)];
  if (typeof input.source !== 'string' || !input.source.trim() || input.source.length > 200) throw Error('请填写数据来源（最多200字）');
  if (typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt))) throw Error('数据日期无效');
  output.source = input.source.trim(); output.updatedAt = input.updatedAt;
  for (const [key, label, unit, digits] of fields) {
    // Additive v1 migration: retain old drafts and mark only missing new fields as examples.
    const missingNew = addedMetricKeys.includes(key) && !Object.hasOwn(input.metrics, key);
    const value = missingNew ? defaults.metrics[key] : input.metrics[key];
    if (missingNew && !output.placeholderKeys.includes(key)) output.placeholderKeys.push(key);
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9 || (unit === '%' && value > 100))) throw Error(`${label}须为非负数字${unit === '%' ? '，且不超过100' : ''}，未知请留空`);
    if (value !== null && ['人', '次', '辆', '路', '个', '起', '项', '家'].includes(unit) && !Number.isInteger(value)) throw Error(`${label}须为整数`);
    output.metrics[key] = value;
  }
  const shares = industryKeys.map(key => output.metrics[key]);
  if (shares.every(value => value !== null) && Math.abs(shares.reduce((sum, value) => sum + value, 0) - 100) > 0.001) throw Error('产业结构五项占比合计须为100%');
  for (const [key, label, list] of copyFields) {
    const value = key === 'workOrderEvents' && !Object.hasOwn(input.content, key) ? defaults.content[key] : input.content[key];
    if (list) {
      if (!Array.isArray(value) || value.length > 100 || value.some(x => typeof x !== 'string' || !x.trim() || x.length > 120)) throw Error(`${label}格式错误（最多100项，每项120字）`);
      output.content[key] = value.map(x => x.trim());
    } else {
      if (typeof value !== 'string' || value.length > 1000) throw Error(`${label}最多1000字`);
      output.content[key] = value;
    }
  }
  return output;
}
export function displayValue(data, key) {
  const field = fields.find(item => item[0] === key), value = data.metrics[key];
  if (value === null) return '—';
  return (field[4] ? '约 ' : '') + value.toLocaleString('zh-CN', { useGrouping: false, minimumFractionDigits: field[3], maximumFractionDigits: Math.max(field[3], 2) });
}
export function apiURL(value, origin) {
  if (typeof value !== 'string' || !value.startsWith('/api/') || value.includes('\\')) throw Error('接口须为本站 /api/ 下的只读地址');
  const url = new URL(value, origin);
  if (url.origin !== origin || !url.pathname.startsWith('/api/') || url.search || url.hash || url.username || url.password || /system-branding|admin|auth/i.test(decodeURIComponent(url.pathname))) throw Error('请使用独立业务数据接口，不要填写布局或管理员接口');
  return url.href;
}
