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

/** 音响输入源 (后台可配置名称) */
export interface AudioInputSource {
  id: number;
  channel: number;        // EKX 0-based 输入索引 (0=IN1)
  name: string;
  color: string | null;
  sortOrder: number;
  enabled: boolean;
}

/** 单路输出在某场景里的配置 */
export interface SceneOutputConfig {
  ch: number;             // 输出通道 0-7
  inputs?: number[];      // 喂给这路的输入通道号 (0-7), 多个=混音
  volume?: number;        // 输出音量 0-100
  muted?: boolean;        // 是否静音
}

/** 场景完整内容 (矩阵路由+音量+静音) */
export interface SceneContent {
  outputs: SceneOutputConfig[];
}

/** 音响一键场景 (后台可配置名称 + 内容) */
export interface AudioScene {
  id: number;
  presetNum: number;      // EKX 用户预设号 1-12
  name: string;
  hint: string | null;
  content: string | null; // JSON 字符串: {outputs:[...]}, 为空=回退设备预设
  sortOrder: number;
  enabled: boolean;
}

export type AudioZonePatch = Partial<Omit<AudioOutputZone, 'id'>>;
export type AudioInputPatch = Partial<Omit<AudioInputSource, 'id'>>;
/** 场景写入 patch — content 传对象 (后端序列化), 其余跟实体一致 */
export type AudioScenePatch = Partial<{
  presetNum: number;
  name: string;
  hint: string | null;
  content: SceneContent | null;
  sortOrder: number;
  enabled: boolean;
}>;

/** 把场景的 content JSON 字符串解析成对象 (非法/空返回 null) */
export function parseSceneContent(scene: Pick<AudioScene, 'content'>): SceneContent | null {
  if (!scene.content) return null;
  try {
    const parsed = JSON.parse(scene.content) as SceneContent;
    return parsed && Array.isArray(parsed.outputs) ? parsed : null;
  } catch {
    return null;
  }
}

export const audioConfigService = {
  // 输出通道
  listZones: (includeDisabled = false) =>
    api.get<AudioOutputZone[]>(`/audio-config/zones${includeDisabled ? '?includeDisabled=1' : ''}`),
  createZone: (dto: AudioZonePatch) => api.post<AudioOutputZone>('/audio-config/zones', dto),
  updateZone: (id: number, dto: AudioZonePatch) => api.put<AudioOutputZone>(`/audio-config/zones/${id}`, dto),
  deleteZone: (id: number) => api.del<{ removedId: number }>(`/audio-config/zones/${id}`),
  // 输入源
  listInputs: (includeDisabled = false) =>
    api.get<AudioInputSource[]>(`/audio-config/inputs${includeDisabled ? '?includeDisabled=1' : ''}`),
  createInput: (dto: AudioInputPatch) => api.post<AudioInputSource>('/audio-config/inputs', dto),
  updateInput: (id: number, dto: AudioInputPatch) => api.put<AudioInputSource>(`/audio-config/inputs/${id}`, dto),
  deleteInput: (id: number) => api.del<{ removedId: number }>(`/audio-config/inputs/${id}`),
  // 场景
  listScenes: (includeDisabled = false) =>
    api.get<AudioScene[]>(`/audio-config/scenes${includeDisabled ? '?includeDisabled=1' : ''}`),
  createScene: (dto: AudioScenePatch) => api.post<AudioScene>('/audio-config/scenes', dto),
  updateScene: (id: number, dto: AudioScenePatch) => api.put<AudioScene>(`/audio-config/scenes/${id}`, dto),
  deleteScene: (id: number) => api.del<{ removedId: number }>(`/audio-config/scenes/${id}`),
  // 场景下发 (走 /audio 控制端点, 不是 /audio-config)
  applyScene: (preset: number) => api.post<{ ok: boolean }>(`/audio/scene/apply/${preset}`, {}),
  resetSceneCache: () => api.post<{ ok: boolean }>('/audio/scene/reset-cache', {}),
};
