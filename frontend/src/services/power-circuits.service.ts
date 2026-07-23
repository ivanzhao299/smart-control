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

export const powerCircuitsService = {
  // SWR 缓存; on/off 也 invalidate (它们改 reading.on, 列表"状态"列要刷新)
  list: (includeDisabled = false) =>
    queryOnce(`${PC}:${includeDisabled}`, () =>
      api.get<PowerCircuitView[]>('/power-circuits', {
        params: includeDisabled ? { includeDisabled: '1' } : {},
      })),
  detail: (id: number) => api.get<PowerCircuitView>(`/power-circuits/${id}`),
  create: (dto: PowerCircuitUpsertDto) =>
    api.post<PowerCircuitView>('/power-circuits', dto).then((r) => { invalidate(PC); return r; }),
  update: (id: number, dto: Partial<PowerCircuitUpsertDto>) =>
    api.put<PowerCircuitView>(`/power-circuits/${id}`, dto).then((r) => { invalidate(PC); return r; }),
  remove: (id: number) =>
    api.del<null>(`/power-circuits/${id}`).then((r) => { invalidate(PC); return r; }),
  on: (id: number) =>
    api.post<PowerCircuitView>(`/power-circuits/${id}/on`).then((r) => { invalidate(PC); return r; }),
  off: (id: number) =>
    api.post<PowerCircuitView>(`/power-circuits/${id}/off`).then((r) => { invalidate(PC); return r; }),
  /** 空开专属: 三相分相 + 4 路温度 + 漏电 + 报警位 (只对 isBreaker 回路有意义) */
  breaker: (id: number) => api.get<BreakerMeasurements>(`/power-circuits/${id}/breaker`),
};
