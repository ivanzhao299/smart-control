/**
 * 园区能源资产台账（规划 / 台账口径，非实时计量）。
 *
 * 说明：本文件定义园区变压器、楼栋、电梯等能源资产的规划参数，用于运营大屏
 * 「全口径」能源估算。真实计量数据——锦浪云光伏、华普云 4G 断路器——来自各自
 * 云平台，不受本文件影响。
 *
 * 口径原则（重要）：
 *  - 光伏、已接入云断路器：source='measured'（真实计量）。
 *  - 变压器 / 楼栋 / 电梯 / 分类：source='model'（按面积、容量、典型负荷的规划估算）。
 *  - 资产接入真实电表后，应把对应来源由 model 切换为 measured，并以电表为准。
 *
 * 下列资产为当前规划/示例口径，集中在本文件，可按园区正式台账直接修改。
 */

export type EnergyZone = 'center' | 'phase1' | 'phase2' | 'future';

export interface TransformerAsset {
  code: string;
  name: string;
  /** 额定容量 kVA */
  capacityKva: number;
  zone: EnergyZone;
  /** 所带楼栋 code */
  feeds: string[];
}

export type BuildingFunction =
  | 'exhibition'
  | 'plant'
  | 'office'
  | 'support'
  | 'dorm';

export interface BuildingAsset {
  code: string;
  name: string;
  zone: EnergyZone;
  function: BuildingFunction;
  /** 建筑面积 m² */
  areaM2: number;
}

export interface ElevatorAsset {
  code: string;
  name: string;
  buildingCode: string;
  kind: 'passenger' | 'freight';
  /** 层站数 */
  stops: number;
  /** 主机功率 kW */
  motorKw: number;
}

export const ZONE_LABEL: Record<EnergyZone, string> = {
  center: '展贸中心',
  phase1: '一期·智造区',
  phase2: '二期·研发区',
  future: '远期·科创区',
};

export const BUILDING_FUNCTION_LABEL: Record<BuildingFunction, string> = {
  exhibition: '展贸',
  plant: '工业厂房',
  office: '研发办公',
  support: '配套服务',
  dorm: '宿舍公寓',
};

/** 各功能建筑用电指标：单位面积负荷 W/m²、日运行小时（规划估算基准）。 */
export const FUNCTION_PROFILE: Record<
  BuildingFunction,
  { loadWpm2: number; runHours: number }
> = {
  exhibition: { loadWpm2: 32, runHours: 11 },
  plant: { loadWpm2: 22, runHours: 10 },
  office: { loadWpm2: 38, runHours: 10 },
  support: { loadWpm2: 28, runHours: 12 },
  dorm: { loadWpm2: 18, runHours: 12 },
};

/**
 * 用电分类基准占比（按建筑功能），用于把楼栋总用电拆分到
 * 照明 / 空调 / 动力 / 电梯 / 插座 五类。每行合计为 1。
 */
export const CATEGORY_SHARE: Record<
  BuildingFunction,
  { lighting: number; hvac: number; power: number; elevator: number; socket: number }
> = {
  exhibition: { lighting: 0.28, hvac: 0.34, power: 0.12, elevator: 0.08, socket: 0.18 },
  plant: { lighting: 0.12, hvac: 0.18, power: 0.52, elevator: 0.06, socket: 0.12 },
  office: { lighting: 0.2, hvac: 0.4, power: 0.06, elevator: 0.1, socket: 0.24 },
  support: { lighting: 0.24, hvac: 0.36, power: 0.1, elevator: 0.08, socket: 0.22 },
  dorm: { lighting: 0.22, hvac: 0.34, power: 0.04, elevator: 0.12, socket: 0.28 },
};

export const CATEGORY_LABEL: Record<string, string> = {
  lighting: '照明',
  hvac: '空调',
  power: '动力',
  elevator: '电梯',
  socket: '插座及其他',
};

// ============ 楼栋（17 栋 / 4 分区） ============
export const BUILDINGS: BuildingAsset[] = [
  // 展贸中心
  { code: 'B00', name: '展贸主楼', zone: 'center', function: 'exhibition', areaM2: 26000 },
  // 一期·智造区（1#~6# 厂房）
  { code: 'B01', name: '1#厂房', zone: 'phase1', function: 'plant', areaM2: 9800 },
  { code: 'B02', name: '2#厂房', zone: 'phase1', function: 'plant', areaM2: 9200 },
  { code: 'B03', name: '3#厂房', zone: 'phase1', function: 'plant', areaM2: 10500 },
  { code: 'B04', name: '4#厂房', zone: 'phase1', function: 'plant', areaM2: 8800 },
  { code: 'B05', name: '5#厂房', zone: 'phase1', function: 'plant', areaM2: 7600 },
  { code: 'B06', name: '6#厂房', zone: 'phase1', function: 'support', areaM2: 6200 },
  // 二期·研发区（7#~12# 研发办公）
  { code: 'B07', name: '7#研发楼', zone: 'phase2', function: 'office', areaM2: 11800 },
  { code: 'B08', name: '8#研发楼', zone: 'phase2', function: 'office', areaM2: 10400 },
  { code: 'B09', name: '9#研发楼', zone: 'phase2', function: 'office', areaM2: 9600 },
  { code: 'B10', name: '10#研发楼', zone: 'phase2', function: 'office', areaM2: 8800 },
  { code: 'B11', name: '11#综合楼', zone: 'phase2', function: 'support', areaM2: 7400 },
  { code: 'B12', name: '12#服务楼', zone: 'phase2', function: 'support', areaM2: 5600 },
  // 远期·科创区（13#~16#）
  { code: 'B13', name: '13#科创楼', zone: 'future', function: 'office', areaM2: 12600 },
  { code: 'B14', name: '14#厂房', zone: 'future', function: 'plant', areaM2: 11200 },
  { code: 'B15', name: '15#公寓', zone: 'future', function: 'dorm', areaM2: 8400 },
  { code: 'B16', name: '16#公寓', zone: 'future', function: 'dorm', areaM2: 7800 },
  // 一期·智造区扩建（B17~B20）
  { code: 'B17', name: '7#厂房', zone: 'phase1', function: 'plant', areaM2: 9400 },
  { code: 'B18', name: '8#厂房', zone: 'phase1', function: 'plant', areaM2: 8600 },
  { code: 'B19', name: '9#厂房', zone: 'phase1', function: 'plant', areaM2: 7800 },
  { code: 'B20', name: '一期配套楼', zone: 'phase1', function: 'support', areaM2: 5400 },
  // 二期·研发区扩建（B21~B24）
  { code: 'B21', name: '13#研发楼', zone: 'phase2', function: 'office', areaM2: 10200 },
  { code: 'B22', name: '14#研发楼', zone: 'phase2', function: 'office', areaM2: 9000 },
  { code: 'B23', name: '二期配套楼', zone: 'phase2', function: 'support', areaM2: 6200 },
  { code: 'B24', name: '二期公寓', zone: 'phase2', function: 'dorm', areaM2: 7200 },
  // 远期·科创区扩建（B25~B29）
  { code: 'B25', name: '16#科创楼', zone: 'future', function: 'office', areaM2: 11800 },
  { code: 'B26', name: '17#科创楼', zone: 'future', function: 'office', areaM2: 10600 },
  { code: 'B27', name: '18#厂房', zone: 'future', function: 'plant', areaM2: 9800 },
  { code: 'B28', name: '19#公寓', zone: 'future', function: 'dorm', areaM2: 8200 },
  { code: 'B29', name: '20#公寓', zone: 'future', function: 'dorm', areaM2: 7600 },
];

// ============ 变压器（10 台，负载率规划在 49~77%） ============
export const TRANSFORMERS: TransformerAsset[] = [
  { code: 'TR1', name: '1#变压器', capacityKva: 1250, zone: 'center', feeds: ['B00'] },
  // 一期·智造区（3 台）
  { code: 'TR2', name: '2#变压器', capacityKva: 1000, zone: 'phase1', feeds: ['B01', 'B02', 'B03'] },
  { code: 'TR3', name: '3#变压器', capacityKva: 1000, zone: 'phase1', feeds: ['B04', 'B05', 'B06'] },
  { code: 'TR9', name: '9#变压器', capacityKva: 1000, zone: 'phase1', feeds: ['B17', 'B18', 'B19', 'B20'] },
  // 二期·研发区（4 台）
  { code: 'TR4', name: '4#变压器', capacityKva: 1250, zone: 'phase2', feeds: ['B07', 'B08'] },
  { code: 'TR5', name: '5#变压器', capacityKva: 1000, zone: 'phase2', feeds: ['B09', 'B10'] },
  { code: 'TR10', name: '10#变压器', capacityKva: 1000, zone: 'phase2', feeds: ['B21', 'B22'] },
  { code: 'TR6', name: '6#变压器', capacityKva: 1000, zone: 'phase2', feeds: ['B11', 'B12', 'B23', 'B24'] },
  // 远期·科创区（2 台大容量）
  { code: 'TR7', name: '7#变压器', capacityKva: 1600, zone: 'future', feeds: ['B13', 'B25', 'B26'] },
  { code: 'TR8', name: '8#变压器', capacityKva: 1600, zone: 'future', feeds: ['B14', 'B15', 'B16', 'B27', 'B28', 'B29'] },
];

// ============ 电梯（15 部：客梯 + 货梯） ============
export const ELEVATORS: ElevatorAsset[] = [
  // 展贸主楼：3 客 1 货
  { code: 'EL01', name: '展贸客梯1#', buildingCode: 'B00', kind: 'passenger', stops: 6, motorKw: 11 },
  { code: 'EL02', name: '展贸客梯2#', buildingCode: 'B00', kind: 'passenger', stops: 6, motorKw: 11 },
  { code: 'EL03', name: '展贸客梯3#', buildingCode: 'B00', kind: 'passenger', stops: 6, motorKw: 11 },
  { code: 'EL04', name: '展贸货梯1#', buildingCode: 'B00', kind: 'freight', stops: 5, motorKw: 15 },
  // 二期研发楼
  { code: 'EL05', name: '研发客梯1#', buildingCode: 'B07', kind: 'passenger', stops: 12, motorKw: 13 },
  { code: 'EL06', name: '研发客梯2#', buildingCode: 'B08', kind: 'passenger', stops: 11, motorKw: 13 },
  { code: 'EL07', name: '研发客梯3#', buildingCode: 'B09', kind: 'passenger', stops: 10, motorKw: 13 },
  { code: 'EL08', name: '研发客梯4#', buildingCode: 'B10', kind: 'passenger', stops: 10, motorKw: 13 },
  { code: 'EL09', name: '综合楼客梯1#', buildingCode: 'B11', kind: 'passenger', stops: 8, motorKw: 11 },
  // 远期科创 / 公寓
  { code: 'EL10', name: '科创客梯1#', buildingCode: 'B13', kind: 'passenger', stops: 14, motorKw: 13 },
  { code: 'EL11', name: '科创客梯2#', buildingCode: 'B13', kind: 'passenger', stops: 14, motorKw: 13 },
  { code: 'EL12', name: '公寓客梯1#', buildingCode: 'B15', kind: 'passenger', stops: 10, motorKw: 11 },
  { code: 'EL13', name: '公寓客梯2#', buildingCode: 'B16', kind: 'passenger', stops: 10, motorKw: 11 },
  // 大厂房货梯
  { code: 'EL14', name: '厂房货梯1#', buildingCode: 'B03', kind: 'freight', stops: 4, motorKw: 15 },
  { code: 'EL15', name: '厂房货梯2#', buildingCode: 'B14', kind: 'freight', stops: 4, motorKw: 15 },
];

/** 园区规划参数。 */
export const PARK_PLAN = {
  totalBuildings: BUILDINGS.length,
  totalAreaM2: BUILDINGS.reduce((s, b) => s + b.areaM2, 0),
  transformerCount: TRANSFORMERS.length,
  transformerCapacityKva: TRANSFORMERS.reduce((s, t) => s + t.capacityKva, 0),
  elevatorCount: ELEVATORS.length,
  /** 光伏装机 kWp（与锦浪云一致） */
  pvCapacityKw: 1600,
  /** 功率因数（变压器负载率换算 kVA） */
  powerFactor: 0.92,
};
