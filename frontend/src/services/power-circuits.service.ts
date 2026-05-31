import { api } from './http';

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

export const powerCircuitsService = {
  list: (includeDisabled = false) =>
    api.get<PowerCircuitView[]>('/power-circuits', {
      params: includeDisabled ? { includeDisabled: '1' } : {},
    }),
  detail: (id: number) => api.get<PowerCircuitView>(`/power-circuits/${id}`),
  create: (dto: PowerCircuitUpsertDto) => api.post<PowerCircuitView>('/power-circuits', dto),
  update: (id: number, dto: Partial<PowerCircuitUpsertDto>) =>
    api.put<PowerCircuitView>(`/power-circuits/${id}`, dto),
  remove: (id: number) => api.del<null>(`/power-circuits/${id}`),
  on: (id: number) => api.post<PowerCircuitView>(`/power-circuits/${id}/on`),
  off: (id: number) => api.post<PowerCircuitView>(`/power-circuits/${id}/off`),
};
