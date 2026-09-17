import { api } from './http';
import { queryOnce, invalidate } from './query.service';

export interface PowerReading {
  on: boolean;
  current: number;       // A
  voltage: number;       // V
  power: number;         // W
  powerFactor: number;
  energy: number;        // 累计 kWh
  lastReadAt: string;
}

export interface PowerCircuitView {
  id: number;
  configRevision: number;
  code: string;
  name: string;
  floor: string;
  category: string;
  gatewayCode: string | null;
  relayChannel: number | null;
  meterAddress: number | null;
  ratedVoltage: number;
  ratedCurrent: number;
  ratedPower: number;
  sortOrder: number;
  icon: string | null;
  description: string | null;
  enabled: boolean;
  /** 是不是智能断路器回路 (LED 大屏总闸) — 前端据此显示空开专属详情 */
  isBreaker: boolean;
  reading: PowerReading;
  createdAt: string;
  updatedAt: string;
}

/** 智能断路器全量计量 (GET /power-circuits/:id/breaker) */
export interface BreakerMeasurements {
  voltages: [number, number, number];       // 三相电压 A/B/C
  currents: [number, number, number];       // 三相电流 A/B/C
  leakageCurrent: number;                    // 漏电 / 零序电流 A
  powers: [number, number, number, number];  // 功率 A/B/C/总 W
  energies: [number, number, number, number];// 电量 A/B/C/总 kWh
  temperatures: [number, number, number, number]; // 4 路接线柱温度 ℃
  powerFactor: number;
  frequency: number;                         // Hz
  mode: number;
  switchState: 'open' | 'closed' | 'locked' | 'unknown';
  alarms: {
    overVoltage: [boolean, boolean, boolean];
    underVoltage: [boolean, boolean, boolean];
    overCurrent: [boolean, boolean, boolean];
    leakage: boolean;
    overPower: [boolean, boolean, boolean, boolean];
    overHeat: [boolean, boolean, boolean, boolean];
    overEnergy: [boolean, boolean, boolean, boolean];
    any: boolean;
  };
}

export interface PowerCircuitUpsertDto {
  code: string;
  name: string;
  floor: string;
  category?: string;
  gatewayCode?: string | null;
  relayChannel?: number | null;
  meterAddress?: number | null;
  ratedVoltage?: number;
  ratedCurrent?: number;
  ratedPower?: number;
  sortOrder?: number;
  icon?: string | null;
  description?: string | null;
  enabled?: boolean;
}

const PC = 'power-circuits:list';
export type PowerCircuitConfigView = Omit<PowerCircuitView, 'reading' | 'isBreaker'>;
/** Late telemetry may refresh readings, never roll metadata back to an older revision. */
export function mergePowerCircuitView(incoming: PowerCircuitView, current?: PowerCircuitView): PowerCircuitView {
  if (!current || !Number.isSafeInteger(current.configRevision) || incoming.configRevision >= current.configRevision) return incoming;
  const { reading: _reading, isBreaker: _isBreaker, ...metadata } = current;
  return { ...incoming, ...metadata };
}
const revision = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('未取得有效配置版本，请重新读取');
  return value;
};

export const powerCircuitsService = {
  configurationList: () => api.get<PowerCircuitConfigView[]>('/power-circuits/configuration'),
  configuration: (id: number) => api.get<PowerCircuitConfigView>(`/power-circuits/configuration/${id}`),
  // SWR 缓存; on/off 也 invalidate (它们改 reading.on, 列表"状态"列要刷新)
  list: (includeDisabled = false) =>
    queryOnce(`${PC}:${includeDisabled}`, () =>
      api.get<PowerCircuitView[]>('/power-circuits', {
        params: includeDisabled ? { includeDisabled: '1' } : {},
      })),
  detail: (id: number) => api.get<PowerCircuitView>(`/power-circuits/${id}`),
  create: (dto: PowerCircuitUpsertDto) =>
    api.post<PowerCircuitConfigView>('/power-circuits/configuration', dto).then((r) => { invalidate(PC); return r; }),
  update: (id: number, dto: Partial<PowerCircuitUpsertDto> & { expectedRevision: number }) =>
    api.put<PowerCircuitConfigView>(`/power-circuits/configuration/${id}`, { ...dto, expectedRevision: revision(dto.expectedRevision) }).then((r) => { invalidate(PC); return r; }),
  remove: (id: number, expectedRevision: number) =>
    api.del<null>(`/power-circuits/configuration/${id}?expectedRevision=${revision(expectedRevision)}`).then((r) => { invalidate(PC); return r; }),
  on: (id: number) =>
    api.post<PowerCircuitView>(`/power-circuits/${id}/on`).then((r) => { invalidate(PC); return r; }),
  off: (id: number) =>
    api.post<PowerCircuitView>(`/power-circuits/${id}/off`).then((r) => { invalidate(PC); return r; }),
  /** 空开专属: 三相分相 + 4 路温度 + 漏电 + 报警位 (只对 isBreaker 回路有意义) */
  breaker: (id: number) => api.get<BreakerMeasurements>(`/power-circuits/${id}/breaker`),
  /** Administrator rename changes metadata only, never waits for telemetry. */
  rename: (id: number, name: string, expectedRevision: number) =>
    api.put<PowerCircuitConfigView>(`/power-circuits/configuration/${id}`, { name, expectedRevision: revision(expectedRevision) }).then((r) => { invalidate(PC); return r; }),
  /** 时序器全开 (b3) — 设备按各路延时依次上电 */
  seqAllOn: () =>
    api.post<{ on: boolean }>('/power-circuits/sequencer/all-on').then((r) => { invalidate(PC); return r; }),
  /** 时序器全关 (b3) — 先开的后关 */
  seqAllOff: () =>
    api.post<{ on: boolean }>('/power-circuits/sequencer/all-off').then((r) => { invalidate(PC); return r; }),
};
