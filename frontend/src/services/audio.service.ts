import { api } from './http';
import type { AdapterResult } from '@/types/api';

export const audioService = {
  setVolume: (id: string, value: number, zone?: string) =>
    api.post<AdapterResult>(`/audio/${id}/volume`, { value, zone }),
  mute: (id: string, zone?: string) =>
    api.post<AdapterResult>(`/audio/${id}/mute`, { muted: true, zone }),
  unmute: (id: string, zone?: string) =>
    api.post<AdapterResult>(`/audio/${id}/mute`, { muted: false, zone }),
  playBgm: (id: string, track?: string, zone?: string) =>
    api.post<AdapterResult>(`/audio/${id}/play-bgm`, { track, zone }),
  stopBgm: (id: string, zone?: string) =>
    api.post<AdapterResult>(`/audio/${id}/stop-bgm`, { zone }),
  mic: (id: string, enable: boolean, zone?: string) =>
    api.post<AdapterResult>(`/audio/${id}/mic`, { enable, zone }),

  // EKX-808 一键场景 — apply 走后台编辑的矩阵内容 (没配则后端回退设备预设)
  applyScene: (preset: number) =>
    api.post<AdapterResult<{ preset?: number; commands?: number; outputs?: number }>>(`/audio/scene/apply/${preset}`, {}),
  // 直接调设备内置预设 (不读 DB content), 留作调试/兜底
  recallScene: (preset: number) =>
    api.post<AdapterResult<{ preset: number }>>(`/audio/scene/recall/${preset}`, {}),
  currentScene: () =>
    api.get<{ message: string; data: AdapterResult<{ preset: number }> }>(`/audio/scene/current`),
};
