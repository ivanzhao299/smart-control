import type { HvacFan, HvacIndoor, HvacMode, HvacZone } from '@/services/hvac.service';

export type HvacFloorFilter = HvacIndoor['floor'] | 'all';

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

export interface HvacGroupedSection {
  code: string | null;
  name: string;
  zone: HvacZone | null;
  rows: IndoorRow[];
}

export interface HvacOverview {
  onCount: number;
  knownCount: number;
  unknownCount: number;
  total: number;
  faultCount: number;
  avgRoomT: number | null;
  zoneCount: number;
}

export interface HvacZoneCard {
  code: string | null;
  name: string;
  members: IndoorRow[];
  onCount: number;
  temp: number;
  mode: HvacMode | null;
  avgRoomT: number | null;
}

function roundedAverage(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

export function createUnknownIndoorState(): IndoorState {
  return {
    known: false,
    on: false,
    temperature: 24,
    mode: 'auto',
    fan: 'auto',
    online: false,
    faultCode: 0,
  };
}

export function filterIndoorsByFloor(rows: IndoorRow[], floor: HvacFloorFilter): IndoorRow[] {
  return floor === 'all' ? rows : rows.filter((row) => row.floor === floor);
}

export function filterZonesByFloor(zones: HvacZone[], floor: HvacFloorFilter): HvacZone[] {
  return floor === 'all' ? zones : zones.filter((zone) => zone.floor === floor);
}

export function buildGroupedSections(rows: IndoorRow[], zones: HvacZone[]): HvacGroupedSection[] {
  const rowsByCode = new Map<string | null, IndoorRow[]>();
  for (const row of rows) {
    const code = row.zoneCode ?? null;
    const members = rowsByCode.get(code) ?? [];
    members.push(row);
    rowsByCode.set(code, members);
  }

  const sections: HvacGroupedSection[] = zones.map((zone) => ({
    code: zone.code,
    name: zone.name,
    zone,
    rows: rowsByCode.get(zone.code) ?? [],
  }));
  const ungrouped = rowsByCode.get(null) ?? [];
  if (ungrouped.length) sections.push({ code: null, name: '未分组', zone: null, rows: ungrouped });
  return sections;
}

export function summarizeHvacOverview(rows: IndoorRow[], zoneCount: number): HvacOverview {
  const known = rows.filter((row) => row.state.known);
  const on = known.filter((row) => row.state.on);
  const roomTemperatures = known
    .map((row) => row.state.roomTemp)
    .filter((temperature): temperature is number => typeof temperature === 'number');
  return {
    onCount: on.length,
    knownCount: known.length,
    unknownCount: rows.length - known.length,
    total: rows.length,
    faultCount: known.filter((row) => row.state.faultCode > 0).length,
    avgRoomT: roundedAverage(roomTemperatures),
    zoneCount,
  };
}

export function commonKnownState<K extends keyof IndoorState>(
  rows: IndoorRow[],
  key: K,
): IndoorState[K] | null {
  const known = rows.filter((row) => row.state.known);
  if (!known.length) return null;
  const first = known[0].state[key];
  return known.every((row) => row.state[key] === first) ? first : null;
}

export function averageSelectedTemperature(rows: IndoorRow[]): number {
  const known = rows.filter((row) => row.state.known);
  if (!known.length) return 24;
  return Math.round(known.reduce((sum, row) => sum + row.state.temperature, 0) / known.length);
}

export function toggleSelection(selected: ReadonlySet<number>, idxs: number[]): Set<number> {
  const next = new Set(selected);
  if (!idxs.length) return next;
  const allSelected = idxs.every((idx) => next.has(idx));
  for (const idx of idxs) {
    if (allSelected) next.delete(idx);
    else next.add(idx);
  }
  return next;
}

export function invertVisibleSelection(selected: ReadonlySet<number>, visibleIdxs: number[]): Set<number> {
  const next = new Set(selected);
  for (const idx of visibleIdxs) {
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
  }
  return next;
}

export function isSelectionComplete(selected: ReadonlySet<number>, idxs: number[]): boolean {
  return idxs.length > 0 && idxs.every((idx) => selected.has(idx));
}

function buildZoneCard(code: string | null, name: string, members: IndoorRow[]): HvacZoneCard {
  const known = members.filter((member) => member.state.known);
  const on = known.filter((member) => member.state.on);
  const temperatureSource = on.length ? on : known;
  const temperature = temperatureSource.length
    ? Math.round(temperatureSource.reduce((sum, member) => sum + member.state.temperature, 0) / temperatureSource.length)
    : 26;
  const mode = on.length && on.every((member) => member.state.mode === on[0].state.mode)
    ? on[0].state.mode
    : null;
  const roomTemperatures = known
    .map((member) => member.state.roomTemp)
    .filter((value): value is number => typeof value === 'number');

  return {
    code,
    name,
    members,
    onCount: on.length,
    temp: Math.max(16, Math.min(30, temperature)),
    mode,
    avgRoomT: roundedAverage(roomTemperatures),
  };
}

export function buildZoneCards(rows: IndoorRow[], zones: HvacZone[]): HvacZoneCard[] {
  const cards = zones.map((zone) =>
    buildZoneCard(zone.code, zone.name, rows.filter((row) => row.zoneCode === zone.code)));
  const ungrouped = rows.filter((row) => !row.zoneCode);
  if (ungrouped.length) cards.push(buildZoneCard(null, '未分组', ungrouped));
  return cards;
}
