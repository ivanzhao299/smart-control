import { api } from './http';

/** 融合器窗口 (坐标/大小归一化 0~1). id=-1 是融合器默认播放窗口(不可用数字 id 控制). */
export interface FusionWindow {
  id: number;
  source: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectorStatus {
  version: string;
  kind: string;
  planRunning: boolean;
  windows: FusionWindow[];
}

/** 投影视频融合器控制 API (JBT-SK-HD02). 只含后端已实机验通的核心命令. */
export const projectorService = {
  status: () => api.get<ProjectorStatus>('/projector/status'),
  windows: () => api.get<FusionWindow[]>('/projector/windows'),
  open: (source: string, x: number, y: number, w: number, h: number) =>
    api.post<{ windowId: number }>('/projector/windows/open', { source, x, y, w, h }),
  close: (id: number) => api.post<null>(`/projector/windows/${id}/close`),
  clean: () => api.post<null>('/projector/windows/clean'),
  move: (id: number, x: number, y: number) =>
    api.post<null>(`/projector/windows/${id}/move`, { x, y }),
  resize: (id: number, w: number, h: number) =>
    api.post<null>(`/projector/windows/${id}/resize`, { w, h }),
  getVolume: (id: number) =>
    api.get<{ volume: number; muted: boolean }>(`/projector/windows/${id}/volume`),
  setVolume: (id: number, volume: number) =>
    api.post<{ volume: number; muted: boolean }>(`/projector/windows/${id}/volume`, { volume }),
};
