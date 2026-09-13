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

/**
 * 一台内机 (GET /hvac/indoors).
 *
 * idx 是"楼层内机序号" 1..22, 控制命令下发的就是它。
 * zoneCode 为 null = 未分组。名字和归属都能在本页直接改。
 */
export interface HvacIndoor {
  idx: number;
  name: string;
  floor: '1F' | '2F';
  zoneCode: string | null;
  model?: string;
}

/**
 * 一台内机的真实状态 (GET /hvac/states).
 *
 * known=false 表示**这一轮没读到** (网关超时/内机不在线), 其余字段缺失 —— 界面上
 * 要显示"未知", 绝不能当成关机: 那会让人以为空调停了而实际还在跑。
 */
export type HvacIndoorState =
  | { idx: number; known: false }
  | {
      idx: number;
      known: true;
      on: boolean;
      mode: HvacMode;
      temperature: number;
      fan: HvacFan;
      /** 室温 (实测), 网关读不到时缺省 */
      roomTemp?: number;
      online: boolean;
      faultCode: number;
    };

/** 批量控制的聚合结果 (POST /hvac/batch/*) */
export interface HvacBatchResult {
  total: number;
  okCount: number;
  failCount: number;
  results: Array<{ indoorIdx: number; ok: boolean; error?: string; durationMs: number }>;
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
  // ---- 内机: 单机测试 + 改名 + 编组 (都在 PWA 里做, 不用进后台) ----
  listIndoors: () => api.get<HvacIndoor[]>('/hvac/indoors'),
  /** 真实状态 — 轮询用. 后端按网关合并成一次 Modbus 读, 22 台只要 2 次往返 */
  listStates: () => api.get<HvacIndoorState[]>('/hvac/states'),
  /** 改内机名字 / 归属组; zoneCode 传 '' = 移出分组 */
  updateIndoor: (idx: number, patch: { name?: string; zoneCode?: string | null }) =>
    api.put<HvacIndoor>(`/hvac/indoors/${idx}`, patch),
  /** 批量归组: 选中的几台一次划进某组 */
  assignIndoors: (indoors: number[], zoneCode: string | null) =>
    api.post<{ count: number; zoneCode: string | null }>('/hvac/indoors/assign', { indoors, zoneCode }),
  /** 内机拖动排序: 传全量有序 idx 列表, 后端按顺序写 sortOrder (只动显示顺序, 不碰 idx) */
  reorderIndoors: (idxs: number[]) =>
    api.put<{ count: number }>('/hvac/indoors/reorder', { idxs }),

  // ---- 批量控制: 选中集合 (单机/组/楼层/全部 都走这里) ----
  batchOn: (indoors: number[]) => api.post<HvacBatchResult>('/hvac/batch/on', { indoors }),
  batchOff: (indoors: number[]) => api.post<HvacBatchResult>('/hvac/batch/off', { indoors }),
  batchTemperature: (indoors: number[], value: number) =>
    api.post<HvacBatchResult>('/hvac/batch/temperature', { indoors, value }),
  batchMode: (indoors: number[], mode: HvacMode) =>
    api.post<HvacBatchResult>('/hvac/batch/mode', { indoors, mode }),
  batchFanSpeed: (indoors: number[], speed: HvacFan) =>
    api.post<HvacBatchResult>('/hvac/batch/fan-speed', { indoors, speed }),

  // 功能区 (code = "roadshow" / "meeting_room" / ...)
  listZones: () => api.get<HvacZone[]>('/hvac/zones'),
  /** 改功能区名字 — 业主在空调页直接改, 不用进后台 */
  renameZone: (code: string, name: string) =>
    api.put<HvacZone>(`/hvac/zones/${code}`, { name }),
  /** 新建功能区 */
  createZone: (name: string, floor: '1F' | '2F') =>
    api.post<HvacZone>('/hvac/zones', { name, floor }),
  /** 删除功能区 — 组内内机不删, 只变回未分组 */
  deleteZone: (code: string) =>
    api.del<{ code: string; releasedIndoors: number[] }>(`/hvac/zones/${code}`),
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
