import { api } from './http';

/** 能源总览 KPI */
export interface EnergyOverview {
  totalKwh: number;
  todayKwh: number;
  monthKwh: number;
  yesterdayKwh: number;
  circuitCount: number;
  pricePerKwh: number;
  todayCost: number;
  totalCost: number;
  peakPowerW: number;
}

/** 趋势点（按日/月） */
export interface EnergyPoint {
  label: string;
  kwh: number;
}

/** 回路用电占比/排行项 */
export interface EnergyBreakdownItem {
  code: string;
  name: string;
  category: string;
  icon: string | null;
  /** cloud=平台电表 / integral=功率积分 / none=无数据 */
  source: string;
  kwh: number;
  peakPowerW: number;
}

// ============ 园区能源台账（后台可维护） ============
export type EnergyZone = 'center' | 'phase1' | 'phase2' | 'future';
export type BuildingFunction =
  | 'exhibition'
  | 'plant'
  | 'office'
  | 'support'
  | 'dorm';

export interface TransformerAsset {
  code: string;
  name: string;
  capacityKva: number;
  zone: EnergyZone;
  feeds: string[];
}
export interface BuildingAsset {
  code: string;
  name: string;
  zone: EnergyZone;
  function: BuildingFunction;
  areaM2: number;
}
export interface ElevatorAsset {
  code: string;
  name: string;
  buildingCode: string;
  kind: 'passenger' | 'freight';
  stops: number;
  motorKw: number;
}
export interface EnergyAssets {
  transformers: TransformerAsset[];
  buildings: BuildingAsset[];
  elevators: ElevatorAsset[];
}
export interface EnergyAssetsDoc {
  revision: number;
  schemaVersion: number;
  isDefault: boolean;
  value: EnergyAssets;
}

export const energyService = {
  overview: () => api.get<EnergyOverview>('/energy/overview'),
  trend: (groupBy: 'day' | 'month' = 'day', days = 30) =>
    api.get<EnergyPoint[]>('/energy/trend', { params: { groupBy, days } }),
  breakdown: (days = 30) =>
    api.get<EnergyBreakdownItem[]>('/energy/breakdown', { params: { days } }),
  /** 读取园区能源台账 */
  getAssets: () => api.get<EnergyAssetsDoc>('/energy/assets'),
  /** 保存园区能源台账（CAS：expectedRevision 过期返回 409） */
  saveAssets: (value: EnergyAssets, expectedRevision: number) =>
    api.put<{ revision: number; schemaVersion: number; value: EnergyAssets }>(
      '/energy/assets',
      { expectedRevision, value },
    ),
  /** 手动触发云电量同步（需管理员） */
  sync: (days = 30) =>
    api.post<{ devices: number; rows: number }>('/energy/sync', undefined, {
      params: { days },
    }),
};
