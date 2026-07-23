import axios, { type AxiosProgressEvent } from 'axios';
import { getApiBaseURL, getClientToken, getAdminToken } from './http';

/**
 * media 专用 axios(留着只为上传进度回调 —— http.ts 那套 fetch 没有 onUploadProgress)。
 *
 * ⚠️ 关键: 必须自己带鉴权 header! 它不走 http.ts 的 request(), 所以不会自动带 token。
 * 自从加了全局鉴权门(d4a65e7), 裸 axios 的媒体请求全被 401 掉 —— 表现就是"媒体库为空 +
 * 上传报错"。这里加个请求拦截器, 跟 http.ts 一样带上 X-Client-Token / Bearer。
 */
const mediaHttp = axios.create();
mediaHttp.interceptors.request.use((config) => {
  const ct = getClientToken();
  const at = getAdminToken();
  if (ct) config.headers.set('X-Client-Token', ct);
  if (at && !config.headers.has('Authorization')) config.headers.set('Authorization', `Bearer ${at}`);
  return config;
});

/**
 * baseURL 必须运行时动态读 (2026-07-11 修):
 * 之前是模块级快照 import.meta.env.VITE_API_BASE_URL — 构建时固化.
 * GK9000 构建里这是 http://localhost:3200/api, 平板/手机上的 PWA
 * 会去请求设备自己的 localhost → 媒体列表永远是空的.
 * getApiBaseURL() 跟随业主在服务器设置框填的地址 (localStorage), 与
 * 其它页面 (http.ts 体系) 一致. axios 保留只为 upload 的进度回调
 * (fetch 不支持上传进度).
 */
const base = (): string => getApiBaseURL();

export interface MediaItem {
  id: number;
  originalName: string;
  kind: 'video' | 'image' | 'audio' | 'webpage';
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  resolution: string | null;
  remark: string | null;
  uploader: string;
  thumbUrl: string | null;
  fileUrl: string;
  lastPlayedAt: string | null;
  createdAt: string;
}

interface ListResult { items: MediaItem[]; total: number }

export interface OrphanMediaItem {
  relPath: string;
  name: string;
  sizeBytes: number;
  kind: 'video' | 'image' | 'audio' | null;
}

export const mediaService = {
  async list(opts: { kind?: 'video' | 'image' | 'audio' | 'webpage' } = {}): Promise<ListResult> {
    const params: Record<string, string> = {};
    if (opts.kind) params.kind = opts.kind;
    const r = await mediaHttp.get(`${base()}/media`, { params });
    return r.data?.data ?? { items: [], total: 0 };
  },

  /** 添加网页 URL 作为媒体 (可推到 LED/投影 iframe 播放) */
  async createWebpage(name: string, url: string): Promise<MediaItem> {
    const r = await mediaHttp.post(`${base()}/media/webpage`, { name, url });
    if (!r.data?.data) throw new Error(r.data?.message || '添加网页失败');
    return r.data.data;
  },

  /** 上传, 支持 progress 回调 */
  async upload(
    file: File,
    opts: { remark?: string; onProgress?: (pct: number) => void } = {},
  ): Promise<MediaItem> {
    const fd = new FormData();
    fd.append('file', file);
    if (opts.remark) fd.append('remark', opts.remark);
    const r = await mediaHttp.post(`${base()}/media/upload`, fd, {
      // 不要手写 Content-Type: 'multipart/form-data' —— 那样没有 boundary, 后端解析不出文件。
      // 交给 axios/浏览器按 FormData 自动带 boundary。(之前被 401 挡着没暴露, token 修好后就会露)
      timeout: 30 * 60 * 1000, // 30 分钟 (大视频)
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (e.total && opts.onProgress) {
          opts.onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    });
    if (!r.data?.data) throw new Error(r.data?.message || '上传失败');
    return r.data.data;
  },

  async remove(id: number): Promise<void> {
    await mediaHttp.delete(`${base()}/media/${id}`);
  },

  /** 服务器 media 目录里数据库还不认识的文件 (业主直接拷进服务器的, 没走上传接口) */
  async scanOrphans(): Promise<OrphanMediaItem[]> {
    const r = await mediaHttp.get(`${base()}/media/orphans`);
    return r.data?.data ?? [];
  },

  /** 把某个孤儿文件收编成正式媒体库资源 */
  async importOrphan(relPath: string, remark?: string): Promise<MediaItem> {
    const r = await mediaHttp.post(`${base()}/media/orphans/import`, { relPath, remark });
    if (!r.data?.data) throw new Error(r.data?.message || '收编失败');
    return r.data.data;
  },

  async publish(id: number): Promise<{ id: number; name: string; player: string }> {
    const r = await mediaHttp.post(`${base()}/media/${id}/publish`);
    if (!r.data?.data) throw new Error(r.data?.message || '推送失败');
    return r.data.data;
  },

  fileUrl(id: number): string {
    return `${base()}/media/${id}/file`;
  },
};
