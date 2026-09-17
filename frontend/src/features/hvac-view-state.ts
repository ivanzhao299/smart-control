import type { HvacFan, HvacIndoor, HvacMode, HvacZone } from '../services/hvac.service';

/** Display state retains the last reading when a device becomes unknown. */
export interface IndoorState {
  known: boolean;
  on: boolean;
  temperature: number;
  mode: HvacMode;
  fan: HvacFan;
  roomTemp?: number;
  online: boolean;
  faultCode: number;
}

export interface IndoorRow extends HvacIndoor {
  state: IndoorState;
}

export interface ZoneCard {
  code: string | null;
  name: string;
  members: IndoorRow[];
  onCount: number;
  temp: number;
  mode: HvacMode | null;
  avgRoomT: number | null;
}

export function unknownState(): IndoorState {
  return { known: false, on: false, temperature: 24, mode: 'auto', fan: 'auto', online: false, faultCode: 0 };
}

function averageRoomTemperature(known: readonly IndoorRow[]): number | null {
  const temperatures = known.map((row) => row.state.roomTemp).filter((t): t is number => typeof t === 'number');
  return temperatures.length
    ? Math.round((temperatures.reduce((sum, t) => sum + t, 0) / temperatures.length) * 10) / 10
    : null;
}

/** Unknown devices count as neither on nor off, even if a stale reading is retained. */
export function buildOverview(rows: readonly IndoorRow[], zoneCount: number) {
  const known = rows.filter((row) => row.state.known);
  return {
    onCount: known.filter((row) => row.state.on).length,
    knownCount: known.length,
    unknownCount: rows.length - known.length,
    total: rows.length,
    faultCount: known.filter((row) => row.state.faultCode > 0).length,
    avgRoomT: averageRoomTemperature(known),
    zoneCount,
  };
}

export function commonStateValue<K extends keyof IndoorState>(rows: readonly IndoorRow[], key: K): IndoorState[K] | null {
  const known = rows.filter((row) => row.state.known);
  if (!known.length) return null;
  const first = known[0].state[key];
  return known.every((row) => row.state[key] === first) ? first : null;
}

/** Selection control keeps its existing 24-degree fallback, distinct from zone cards. */
export function selectedTemperature(rows: readonly IndoorRow[]): number {
  const known = rows.filter((row) => row.state.known);
  return known.length ? Math.round(known.reduce((sum, row) => sum + row.state.temperature, 0) / known.length) : 24;
}

/** Empty zones remain visible so users can assign members to a newly created zone. */
export function buildGroupedSections(rows: readonly IndoorRow[], zones: readonly HvacZone[]) {
  const byCode = new Map<string | null, IndoorRow[]>();
  for (const row of rows) {
    const key = row.zoneCode ?? null;
    const members = byCode.get(key) ?? [];
    members.push(row);
    byCode.set(key, members);
  }
  const sections: Array<{ code: string | null; name: string; zone: HvacZone | null; rows: IndoorRow[] }> = zones.map((zone) => ({
    code: zone.code, name: zone.name, zone, rows: byCode.get(zone.code) ?? [],
  }));
  const ungrouped = byCode.get(null) ?? [];
  if (ungrouped.length) sections.push({ code: null, name: '未分组', zone: null, rows: ungrouped });
  return sections;
}

export function buildZoneCard(code: string | null, name: string, members: IndoorRow[]): ZoneCard {
  const known = members.filter((row) => row.state.known);
  const on = known.filter((row) => row.state.on);
  const source = on.length ? on : known;
  const temperature = source.length ? Math.round(source.reduce((sum, row) => sum + row.state.temperature, 0) / source.length) : 26;
  const mode = on.length && on.every((row) => row.state.mode === on[0].state.mode) ? on[0].state.mode : null;
  return {
    code, name, members,
    onCount: on.length,
    temp: Math.max(16, Math.min(30, temperature)),
    mode,
    avgRoomT: averageRoomTemperature(known),
  };
}
