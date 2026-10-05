import {
  BUILDING_FUNCTION_LABEL,
  BUILDINGS,
  CATEGORY_LABEL,
  CATEGORY_SHARE,
  ELEVATORS,
  FUNCTION_PROFILE,
  PARK_PLAN,
  TRANSFORMERS,
  ZONE_LABEL,
  type BuildingAsset,
  type BuildingFunction,
  type ElevatorAsset,
  type TransformerAsset,
} from './park-energy-catalog';

/** 可被后台维护覆盖的园区能源资产集合。 */
export interface EnergyAssets {
  transformers: TransformerAsset[];
  buildings: BuildingAsset[];
  elevators: ElevatorAsset[];
}

/**
 * 园区全口径能源估算模型（纯函数）。
 *
 * 以建筑面积 × 单位负荷指标 × 运行小时估算楼栋用电，向上汇总变压器与园区；
 * 电梯按主机功率 × 等效运行小时估算并归入其楼栋「电梯」分类。所有结果
 * source='model'（规划估算），接入真实电表后以计量为准。
 */

export interface CategoryKwh {
  lighting: number;
  hvac: number;
  power: number;
  elevator: number;
  socket: number;
}

export interface BuildingEnergy {
  code: string;
  name: string;
  zone: string;
  zoneLabel: string;
  functionLabel: string;
  areaM2: number;
  todayKwh: number;
  monthKwh: number;
  categoryKwh: CategoryKwh;
}

export interface TransformerEnergy {
  code: string;
  name: string;
  zoneLabel: string;
  capacityKva: number;
  todayKwh: number;
  monthKwh: number;
  /** 估算最大负荷 kW */
  peakKw: number;
  /** 负载率 % */
  loadRatePct: number;
}

export interface ElevatorEnergy {
  code: string;
  name: string;
  buildingName: string;
  kindLabel: string;
  stops: number;
  todayKwh: number;
  monthKwh: number;
}

export interface CategoryEnergy {
  key: string;
  label: string;
  todayKwh: number;
  monthKwh: number;
  sharePct: number;
}

export interface ZoneEnergy {
  zone: string;
  zoneLabel: string;
  todayKwh: number;
  monthKwh: number;
}

export interface ParkModelTotals {
  todayKwh: number;
  monthKwh: number;
  byZone: ZoneEnergy[];
}

export interface ParkEnergyModel {
  source: 'model';
  generatedAt: string;
  totals: ParkModelTotals;
  transformers: TransformerEnergy[];
  buildings: BuildingEnergy[];
  elevators: ElevatorEnergy[];
  categories: CategoryEnergy[];
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** 电梯等效满载运行小时 / 日。 */
const ELEVATOR_RUN_HOURS: Record<'passenger' | 'freight', number> = {
  passenger: 2.2,
  freight: 1.6,
};
const MONTH_DAYS = 30;
/** 估算最大负荷的同时系数。 */
const COINCIDENCE = 0.85;

function emptyCategory(): CategoryKwh {
  return { lighting: 0, hvac: 0, power: 0, elevator: 0, socket: 0 };
}

export function buildParkEnergyModel(assets?: Partial<EnergyAssets>): ParkEnergyModel {
  // 后台维护的台账覆盖默认 catalog；未提供的部分回退默认。
  const T = assets?.transformers ?? TRANSFORMERS;
  const B = assets?.buildings ?? BUILDINGS;
  const E = assets?.elevators ?? ELEVATORS;
  // ---- 电梯：先按楼栋归集（用于替换楼栋电梯分类） ----
  const elevators: ElevatorEnergy[] = [];
  const elevatorByBuilding = new Map<string, number>();
  for (const e of E) {
    const hours = ELEVATOR_RUN_HOURS[e.kind];
    const todayKwh = r2(e.motorKw * hours);
    elevators.push({
      code: e.code,
      name: e.name,
      buildingName: B.find((b) => b.code === e.buildingCode)?.name ?? '—',
      kindLabel: e.kind === 'passenger' ? '客梯' : '货梯',
      stops: e.stops,
      todayKwh,
      monthKwh: r2(todayKwh * MONTH_DAYS),
    });
    elevatorByBuilding.set(
      e.buildingCode,
      (elevatorByBuilding.get(e.buildingCode) ?? 0) + todayKwh,
    );
  }

  // ---- 楼栋 ----
  const buildings: BuildingEnergy[] = B.map((b) => {
    const profile = FUNCTION_PROFILE[b.function as BuildingFunction];
    const todayKwh = r2((b.areaM2 * profile.loadWpm2 * profile.runHours) / 1000);
    const share = CATEGORY_SHARE[b.function as BuildingFunction];
    // 电梯按模型实际值；其余四类按相对占比分摊（总用电 - 电梯实际值）。
    const elevatorKwh = r2(Math.min(elevatorByBuilding.get(b.code) ?? 0, todayKwh));
    const rest = Math.max(0, todayKwh - elevatorKwh);
    const restShareSum = share.lighting + share.hvac + share.power + share.socket;
    const cat: CategoryKwh = {
      elevator: elevatorKwh,
      lighting: r2(rest * (share.lighting / restShareSum)),
      hvac: r2(rest * (share.hvac / restShareSum)),
      power: r2(rest * (share.power / restShareSum)),
      socket: r2(rest * (share.socket / restShareSum)),
    };
    return {
      code: b.code,
      name: b.name,
      zone: b.zone,
      zoneLabel: ZONE_LABEL[b.zone],
      functionLabel: BUILDING_FUNCTION_LABEL[b.function as BuildingFunction],
      areaM2: b.areaM2,
      todayKwh,
      monthKwh: r2(todayKwh * MONTH_DAYS),
      categoryKwh: cat,
    };
  });

  // ---- 变压器 ----
  const transformers: TransformerEnergy[] = T.map((t) => {
    const fed = buildings.filter((b) => t.feeds.includes(b.code));
    const todayKwh = r2(fed.reduce((s, b) => s + b.todayKwh, 0));
    // 最大负荷 = 所带楼栋面积 × 单位负荷 × 同时系数。
    const peakKw = r2(
      fed.reduce((s, b) => {
        const asset = B.find((x) => x.code === b.code);
        const prof = asset ? FUNCTION_PROFILE[asset.function as BuildingFunction] : null;
        return s + (prof ? (b.areaM2 * prof.loadWpm2) / 1000 : 0);
      }, 0) * COINCIDENCE,
    );
    const capacityKw = t.capacityKva * PARK_PLAN.powerFactor;
    return {
      code: t.code,
      name: t.name,
      zoneLabel: ZONE_LABEL[t.zone],
      capacityKva: t.capacityKva,
      todayKwh,
      monthKwh: r2(todayKwh * MONTH_DAYS),
      peakKw,
      loadRatePct: r2(Math.min(100, (peakKw / capacityKw) * 100)),
    };
  });

  // ---- 分类汇总 ----
  const catSum = new Map<string, { today: number; month: number }>();
  let totalToday = 0;
  let totalMonth = 0;
  for (const b of buildings) {
    totalToday += b.todayKwh;
    totalMonth += b.monthKwh;
    for (const [k, v] of Object.entries(b.categoryKwh)) {
      const cur = catSum.get(k) ?? { today: 0, month: 0 };
      cur.today += v;
      cur.month += v * MONTH_DAYS;
      catSum.set(k, cur);
    }
  }
  const categories: CategoryEnergy[] = [...catSum.entries()]
    .map(([key, v]) => ({
      key,
      label: CATEGORY_LABEL[key] ?? key,
      todayKwh: r2(v.today),
      monthKwh: r2(v.month),
      sharePct: totalMonth > 0 ? r2((v.month / totalMonth) * 100) : 0,
    }))
    .sort((a, b) => b.monthKwh - a.monthKwh);

  // ---- 分区汇总 ----
  const zoneMap = new Map<string, ZoneEnergy>();
  for (const b of buildings) {
    const cur =
      zoneMap.get(b.zone) ??
      ({ zone: b.zone, zoneLabel: b.zoneLabel, todayKwh: 0, monthKwh: 0 } as ZoneEnergy);
    cur.todayKwh = r2(cur.todayKwh + b.todayKwh);
    cur.monthKwh = r2(cur.monthKwh + b.monthKwh);
    zoneMap.set(b.zone, cur);
  }

  return {
    source: 'model',
    generatedAt: new Date().toISOString(),
    totals: {
      todayKwh: r2(totalToday),
      monthKwh: r2(totalMonth),
      byZone: [...zoneMap.values()],
    },
    transformers,
    buildings,
    elevators,
    categories,
  };
}
