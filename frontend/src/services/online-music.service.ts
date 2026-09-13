import { api } from './http';

/**
 * 在线无版权曲库 (FreePD CC0, GitHub 镜像) — 浏览目录 + 让后端代下载入媒体库。
 * 全库 1016 首, 商用免授权免署名; 下载在 GK9000 服务器侧进行, 平板/手机只发指令。
 */

export interface OnlineTrack {
  path: string;
  name: string;
  genre: string;
  downloaded: boolean;
}

export interface OnlineCatalog {
  genres: Array<{ key: string; label: string; count: number }>;
  tracks: OnlineTrack[];
  downloading: string | null;
}

export const onlineMusicService = {
  catalog: () => api.get<OnlineCatalog>('/online-music/catalog'),
  /** 服务器代下载 (~2-9MB/首), 给足超时 */
  download: (path: string) =>
    api.post<{ id: number; originalName: string; sizeBytes: number }>(
      '/online-music/download', { path }, { timeout: 180_000 },
    ),
};
