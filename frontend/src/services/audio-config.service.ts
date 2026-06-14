import { api } from './http';

/** 音响输出通道 (后台可配置名称) */
export interface AudioOutputZone {
  id: number;
  channel: number;        // EKX 0-based 输出索引 (0=OUT1)
  name: string;
  floor: string | null;
  color: string | null;
  sortOrder: number;
  enabled: boolean;
}

/** 音响一键场景 (后台可配置名称) */
export interface AudioScene {
  id: number;
  presetNum: number;      // EKX 用户预设号 1-12
  name: string;
  hint: string | null;
  sortOrder: number;
  enabled: boolean;
}

export type AudioZonePatch = Partial<Omit<AudioOutputZone, 'id'>>;
export type AudioScenePatch = Partial<Omit<AudioScene, 'id'>>;

export const audioConfigService = {
  // 输出通道
  listZones: (includeDisabled = false) =>
    api.get<AudioOutputZone[]>(`/audio-config/zones${includeDisabled ? '?includeDisabled=1' : ''}`),
  createZone: (dto: AudioZonePatch) => api.post<AudioOutputZone>('/audio-config/zones', dto),
  updateZone: (id: number, dto: AudioZonePatch) => api.put<AudioOutputZone>(`/audio-config/zones/${id}`, dto),
  deleteZone: (id: number) => api.del<{ removedId: number }>(`/audio-config/zones/${id}`),
  // 场景
  listScenes: (includeDisabled = false) =>
    api.get<AudioScene[]>(`/audio-config/scenes${includeDisabled ? '?includeDisabled=1' : ''}`),
  createScene: (dto: AudioScenePatch) => api.post<AudioScene>('/audio-config/scenes', dto),
  updateScene: (id: number, dto: AudioScenePatch) => api.put<AudioScene>(`/audio-config/scenes/${id}`, dto),
  deleteScene: (id: number) => api.del<{ removedId: number }>(`/audio-config/scenes/${id}`),
};
