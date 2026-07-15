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

/** 网关实际挂载的内机扫描结果 (GET /hvac/gateways/scan) */
export interface HvacGatewayScan {
  code: string;
  host: string;
  port: number;
  /** 空调品牌码, 奥克斯=15 */
  brand: number;
  /** 网关自报的内机数量 */
  indoorCount: number;
  /** brand===15 才算数据就绪 */
  ready: boolean;
  /** 实际在线的物理内机号 (现场从 1 起, 不是 0) */
  onlineNs: number[];
  indoors: Array<{
    n: number; online: boolean; on: boolean; mode: string;
    temperature: number; roomTemp?: number; faultCode: number;
  }>;
  error?: string;
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
  /** 改功能区名字 — 业主在空调页直接改, 不用进后台 */
  renameZone: (code: string, name: string) =>
    api.put<HvacZone>(`/hvac/zones/${code}`, { name }),
  /** 扫描网关实际挂载的内机 (现场校准用) */
  scanGateways: () => api.get<HvacGatewayScan[]>('/hvac/gateways/scan'),
  zoneOn: (code: string) => api.post<HvacZoneResult>(`/hvac/zone/${code}/on`),
  zoneOff: (code: string) => api.post<HvacZoneResult>(`/hvac/zone/${code}/off`),
  zoneTemperature: (code: string, value: number) =>
    api.post<HvacZoneResult>(`/hvac/zone/${code}/temperature`, { value }),
  zoneMode: (code: string, mode: HvacMode) =>
    api.post<HvacZoneResult>(`/hvac/zone/${code}/mode`, { mode }),
  zoneFanSpeed: (code: string, speed: HvacFan) =>
    api.post<HvacZoneResult>(`/hvac/zone/${code}/fan-speed`, { speed }),
};
