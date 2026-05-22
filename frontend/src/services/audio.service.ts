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

  // EKX-808 一键场景预设 (U01-U12)
  recallScene: (preset: number) =>
    api.post<AdapterResult<{ preset: number }>>(`/audio/scene/recall/${preset}`, {}),
  currentScene: () =>
    api.get<{ message: string; data: AdapterResult<{ preset: number }> }>(`/audio/scene/current`),
};
