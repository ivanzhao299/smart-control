import { api } from './http';
import type { AdapterResult } from '@/types/api';

export type HvacMode = 'cool' | 'heat' | 'fan' | 'auto' | 'dry';
export type HvacFan = 'auto' | 'low' | 'mid' | 'high';

export const hvacService = {
  on: (id: string) => api.post<AdapterResult>(`/hvac/${id}/on`),
  off: (id: string) => api.post<AdapterResult>(`/hvac/${id}/off`),
  setTemperature: (id: string, value: number) =>
    api.post<AdapterResult>(`/hvac/${id}/temperature`, { value }),
  setMode: (id: string, mode: HvacMode) =>
    api.post<AdapterResult>(`/hvac/${id}/mode`, { mode }),
  setFanSpeed: (id: string, speed: HvacFan) =>
    api.post<AdapterResult>(`/hvac/${id}/fan-speed`, { speed }),
};
