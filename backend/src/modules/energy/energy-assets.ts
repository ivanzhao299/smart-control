import {
  BUILDINGS,
  ELEVATORS,
  TRANSFORMERS,
  type BuildingFunction,
  type EnergyZone,
} from './park-energy-catalog';
import type { EnergyAssets } from './park-energy-model';

/**
 * 园区能源台账的运行时配置（可在后台维护）。
 *
 * 存储于通用 RuntimeConfigStore（表 runtime_config_documents），带 schemaVersion /
 * revision（乐观锁）/ sha256，并保留每次修改的修订历史。默认种子取自
 * park-energy-catalog；后台保存后以用户台账为准。
 */
export const ENERGY_ASSETS_KEY = 'energy.assets';
export const ENERGY_ASSETS_SCHEMA_VERSION = 1;

/** 默认台账（深拷贝 catalog，避免外部修改常量）。 */
export function defaultEnergyAssets(): EnergyAssets {
  return {
    transformers: TRANSFORMERS.map((t) => ({ ...t, feeds: [...t.feeds] })),
    buildings: BUILDINGS.map((b) => ({ ...b })),
    elevators: ELEVATORS.map((e) => ({ ...e })),
  };
}

const ZONES: readonly EnergyZone[] = ['center', 'phase1', 'phase2', 'future'];
const FUNCTIONS: readonly BuildingFunction[] = [
  'exhibition',
  'plant',
  'office',
  'support',
  'dorm',
];
const KINDS = ['passenger', 'freight'] as const;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, max: number, fallback: string): string {
  const t =
    typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return (t || fallback).slice(0, max);
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function enumVal<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

function strArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, maxItems)
    .map((x) => str(x, maxLen, ''))
    .filter(Boolean);
}

/** 校验并清洗后台提交的台账，非法值回退默认/钳制，保证模型可安全计算。 */
export function normalizeEnergyAssets(input: unknown): EnergyAssets {
  const root = asRecord(input);

  const tIn = Array.isArray(root.transformers) ? root.transformers : [];
  const transformers = tIn.slice(0, 40).map((item, i) => {
    const r = asRecord(item);
    return {
      code: str(r.code, 40, `TR${i + 1}`),
      name: str(r.name, 60, `变压器${i + 1}`),
      capacityKva: Math.round(num(r.capacityKva, 50, 10000, 1000)),
      zone: enumVal(r.zone, ZONES, 'phase1'),
      feeds: strArray(r.feeds, 60, 40),
    };
  });

  const bIn = Array.isArray(root.buildings) ? root.buildings : [];
  const buildings = bIn.slice(0, 200).map((item, i) => {
    const r = asRecord(item);
    return {
      code: str(r.code, 40, `B${String(i).padStart(2, '0')}`),
      name: str(r.name, 60, `楼栋${i + 1}`),
      zone: enumVal(r.zone, ZONES, 'phase1'),
      function: enumVal(r.function, FUNCTIONS, 'plant'),
      areaM2: Math.round(num(r.areaM2, 50, 500000, 5000)),
    };
  });

  const eIn = Array.isArray(root.elevators) ? root.elevators : [];
  const elevators = eIn.slice(0, 200).map((item, i) => {
    const r = asRecord(item);
    return {
      code: str(r.code, 40, `EL${String(i + 1).padStart(2, '0')}`),
      name: str(r.name, 60, `电梯${i + 1}`),
      buildingCode: str(r.buildingCode, 40, ''),
      kind: enumVal(r.kind, KINDS, 'passenger'),
      stops: Math.round(num(r.stops, 2, 200, 6)),
      motorKw: Math.round(num(r.motorKw, 1, 100, 11)),
    };
  });

  return { transformers, buildings, elevators };
}
