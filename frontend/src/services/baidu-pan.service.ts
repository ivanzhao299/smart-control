import { api } from './http';

/**
 * 百度网盘接入 — 配置(AppKey/SecretKey) → 设备码授权(手机输码) → 浏览文件夹 →
 * GK9000 服务器代下载入媒体库 (流式落盘, 前端轮询进度)。
 */

export interface PanFile {
  fsId: number;
  path: string;
  name: string;
  isDir: boolean;
  sizeBytes: number;
  category: number;
  downloaded: boolean;
  ingestible: boolean;
}

export interface PanStatus {
  configured: boolean;
  authorized: boolean;
  download: {
    active: { name: string; receivedBytes: number; totalBytes: number | null; startedAt: number } | null;
    last: { ok: boolean; name: string; message: string; at: number } | null;
  };
}

export interface PanAuthStart {
  userCode: string;
  verificationUrl: string;
  qrcodeUrl: string | null;
  expiresIn: number;
  interval: number;
}

export const baiduPanService = {
  status: () => api.get<PanStatus>('/baidu-pan/status'),
  saveConfig: (appKey: string, secretKey: string) =>
    api.post<null>('/baidu-pan/config', { appKey, secretKey }),
  authStart: () => api.post<PanAuthStart>('/baidu-pan/auth/start'),
  authPoll: () => api.post<{ authorized: boolean; pending: string | null }>('/baidu-pan/auth/poll'),
  list: (dir: string) => api.get<{ dir: string; entries: PanFile[] }>('/baidu-pan/list', { params: { dir }, timeout: 30_000 }),
  download: (fsId: number, name: string) => api.post<{ started: boolean }>('/baidu-pan/download', { fsId, name }, { timeout: 60_000 }),
};
