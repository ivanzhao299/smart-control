import { api } from './http';
import type { AdapterResult } from '@/types/api';

export type HvacMode = 'cool' | 'heat' | 'fan' | 'auto' | 'dry';
export type HvacFan = 'auto' | 'low' | 'mid' | 'high';

export interface HvacZone {
  code: string;
  name: string;
  floor: '1F' | '2F';
  indoors: number[];
  desc?: string;
}

export interface HvacZoneResult {
  zone: string;
  zoneName: string;
  floor: string;
  total: number;
  okCount: number;
  failCount: number;
  results: Array<{ indoorIdx: number; ok: boolean; error?: string; durationMs: number }>;
}

export const hvacService = {
  // 单内机 (id = "1".."22")
  on: (id: string) => api.post<AdapterResult>(`/hvac/${id}/on`),
  off: (id: string) => api.post<AdapterResult>(`/hvac/${id}/off`),
  setTemperature: (id: string, value: number) =>
    api.post<AdapterResult>(`/hvac/${id}/temperature`, { value }),
  setMode: (id: string, mode: HvacMode) =>
    api.post<AdapterResult>(`/hvac/${id}/mode`, { mode }),
  setFanSpeed: (id: string, speed: HvacFan) =>
    api.post<AdapterResult>(`/hvac/${id}/fan-speed`, { speed }),
  // 功能区批量 (code = "roadshow" / "meeting_room" / ...)
  listZones: () => api.get<HvacZone[]>('/hvac/zones'),
  zoneOn: (code: string) => api.post<HvacZoneResult>(`/hvac/zone/${code}/on`),
  zoneOff: (code: string) => api.post<HvacZoneResult>(`/hvac/zone/${code}/off`),
  zoneTemperature: (code: string, value: number) =>
    api.post<HvacZoneResult>(`/hvac/zone/${code}/temperature`, { value }),
  zoneMode: (code: string, mode: HvacMode) =>
    api.post<HvacZoneResult>(`/hvac/zone/${code}/mode`, { mode }),
  zoneFanSpeed: (code: string, speed: HvacFan) =>
    api.post<HvacZoneResult>(`/hvac/zone/${code}/fan-speed`, { speed }),
};
