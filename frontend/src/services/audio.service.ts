import { api } from './http';
import type { AdapterResult } from '@/types/api';

export const audioService = {
  setVolume: (id: string, value: number, zone?: string) =>
    api.post<AdapterResult>(`/audio/${id}/volume`, { value, zone }),
  /** 读取 EKX-808 当前 8 路真实输出音量；只在播放器音量浮层首次展开时按需调用。 */
  getLiveOutputs: () =>
    api.get<{ ok: boolean; data?: { channels: Array<{ ch: number; volume: number | null; muted: boolean | null }> }; error?: string }>(
      '/audio/outputs/live',
    ),
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

  // EKX-808 8x8 矩阵单点路由 (Out X ← In Y 接通/断开). 前台"音源矩阵"页点交叉点用.
  setMatrix: (out: number, input: number, on: boolean) =>
    api.post<AdapterResult<{ out: number; input: number; on: boolean }>>(`/audio/matrix`, { out, input, on }),
  /** 设备**真实**的 8×8 路由表 (~284ms, 可轮询). 矩阵界面该信的唯一数据源 */
  getLiveMatrix: () =>
    api.get<{ ok: boolean; data?: { matrix: boolean[][] }; error?: string }>('/audio/matrix/live'),
  /** 8 路输入的真实增益(dB)+静音 (~4.6s, 别轮询: 开页面读一次/改完复读) */
  getLiveInputs: () =>
    api.get<{ ok: boolean; data?: { channels: Array<{ ch: number; gainDb: number | null; muted: boolean | null }> }; error?: string }>(
      '/audio/inputs/live',
    ),
  // 输入通道增益 (0-100). EKX 用户预设常把输入压到 -60dB, 矩阵通了也没声, 这里拉回.
  setInputVolume: (channel: number, value: number) =>
    api.post<AdapterResult<{ channel: number; volume: number }>>(`/audio/input/${channel}/gain`, { value }),
};
