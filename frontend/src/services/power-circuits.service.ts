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
  reading: PowerReading;
  createdAt: string;
  updatedAt: string;
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
};
