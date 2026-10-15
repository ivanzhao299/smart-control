import axios, { type AxiosProgressEvent, type AxiosRequestConfig } from 'axios';
import { getApiBaseURL, getClientToken, getAdminToken, isDirectLocalConnection, getUploadBaseURL } from './http';
import { identityGeneration, assertCurrentIdentity, onIdentityChange } from './identity-boundary';
export { MEDIA_UPLOAD_ACCEPT } from '../features/media-file-intake';

/**
 * media 专用 axios(留着只为上传进度回调 —— http.ts 那套 fetch 没有 onUploadProgress)。
 *
 * 不走 http.ts，必须同步捕获身份、带鉴权头并独立处理切换取消。
 * Fetch adapter 禁止重定向；浏览器支持请求流时才有细粒度上传进度。
 */
// Capture identity synchronously with the URL, not in an asynchronous interceptor.
// Fetch adapter prevents redirects (XHR cannot), and supports progress where the browser can stream requests.
async function mediaRequest(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, data?: unknown, config: AxiosRequestConfig = {}) {
  const generation = identityGeneration();
  const clientToken = getClientToken();
  const adminToken = getAdminToken();
  const controller = new AbortController();
  const unsubscribe = onIdentityChange(() => controller.abort());
  // 外部传入的 signal (用户点"取消上传") abort 时, 联动内部 controller
  const externalSignal = config.signal as AbortSignal | undefined;
  let cleanupExternal: (() => void) | null = null;
  if (externalSignal && typeof externalSignal.addEventListener === 'function') {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      const handler = () => controller.abort();
      externalSignal.addEventListener('abort', handler, { once: true });
      cleanupExternal = () => externalSignal.removeEventListener('abort', handler);
    }
  }
  try {
    const result = await axios.request({
      ...config, method, url, data,
      adapter: 'fetch',
      fetchOptions: { redirect: 'error', cache: 'no-store' },
      withCredentials: false,
      signal: controller.signal,
      headers: {
        ...config.headers,
        // Axios 1.20 injects its own User-Agent in the fetch adapter. Safari
        // preserves it (unlike Chromium), adding a disallowed CORS preflight
        // header even for list reads. false prevents Axios from re-inserting it;
        // the browser must supply its own User-Agent. Keep redirect/auth isolation.
        'User-Agent': false,
        ...(clientToken ? { 'X-Client-Token': clientToken } : {}),
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      },
      onUploadProgress: config.onUploadProgress ? (event) => {
        if (generation === identityGeneration()) config.onUploadProgress?.(event);
      } : undefined,
    });
    assertCurrentIdentity(generation);
    return result;
  } catch (error) {
    assertCurrentIdentity(generation);
    throw error;
  } finally {
    unsubscribe();
    if (cleanupExternal) cleanupExternal();
  }
}
const mediaHttp = {
  get: (url: string, config?: AxiosRequestConfig) => mediaRequest('GET', url, undefined, config),
  post: (url: string, data?: unknown, config?: AxiosRequestConfig) => mediaRequest('POST', url, data, config),
  put: (url: string, data?: unknown, config?: AxiosRequestConfig) => mediaRequest('PUT', url, data, config),
  delete: (url: string) => mediaRequest('DELETE', url),
};

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
  ownerUserId: number | null;
  visibility: 'private' | 'shared';
  source: 'upload' | 'legacy' | 'system' | 'webpage' | 'import';
  id: number;
  originalName: string;
  kind: 'video' | 'image' | 'audio' | 'webpage' | 'doc';
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
  processingStatus: 'ready' | 'pending' | 'processing' | 'failed';
  processingError: string | null;
}

interface ListResult { items: MediaItem[]; total: number }

export interface OrphanMediaItem {
  relPath: string;
  name: string;
  sizeBytes: number;
  kind: 'video' | 'image' | 'audio' | 'doc' | null;
}

export const mediaService = {
  async access(id: number, variant: 'file' | 'pdf' = 'file'): Promise<{ url: string; expiresAt: string }> {
    const response = await mediaHttp.post(`${base()}/media/${id}/access`, { variant });
    if (!response.data?.data?.url) throw new Error('无法获得资料预览授权');
    return response.data.data;
  },
  async list(opts: { kind?: 'video' | 'image' | 'audio' | 'webpage' | 'doc'; scope?: 'visible' | 'mine' | 'shared'; ownerUserId?: number; keyword?: string; limit?: number; offset?: number } = {}): Promise<ListResult> {
    const params: Record<string, string> = {};
    if (opts.kind) params.kind = opts.kind;
    if (opts.scope) params.scope = opts.scope;
    if (opts.ownerUserId !== undefined) params.ownerUserId = String(opts.ownerUserId);
    if (opts.keyword) params.keyword = opts.keyword;
    if (opts.limit !== undefined) params.limit = String(opts.limit);
    if (opts.offset !== undefined) params.offset = String(opts.offset);
    const r = await mediaHttp.get(`${base()}/media`, { params });
    return r.data?.data ?? { items: [], total: 0 };
  },

  /** 添加网页 URL 作为媒体 (可推到 LED/投影 iframe 播放) */
  async createWebpage(name: string, url: string): Promise<MediaItem> {
    const r = await mediaHttp.post(`${base()}/media/webpage`, { name, url });
    if (!r.data?.data) throw new Error(r.data?.message || '添加网页失败');
    return r.data.data;
  },

  /** 上传, 支持 progress 回调; opts.signal 可取消 */
  async upload(
    file: File,
    opts: { remark?: string; onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
  ): Promise<MediaItem> {
    const fd = new FormData();
    fd.append('file', file);
    if (opts.remark) fd.append('remark', opts.remark);
    // 上传走专用 baseURL(局域网探测成功则直连后端, 否则同源 Nginx)
    const uploadBase = getUploadBaseURL();
    const r = await mediaHttp.post(`${uploadBase}/media/upload`, fd, {
      headers: { 'X-Upload-Size': String(file.size) },
      // 不要手写 Content-Type: 'multipart/form-data' —— 那样没有 boundary, 后端解析不出文件。
      // 交给 axios/浏览器按 FormData 自动带 boundary。(之前被 401 挡着没暴露, token 修好后就会露)
      // 局域网/本机直连: 不限大小, 不设整体超时(0=无超时)；公网: 30 分钟兜底大视频。
      timeout: isDirectLocalConnection() ? 0 : 30 * 60 * 1000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      signal: opts.signal,
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

  /** 重命名（文件名/备注）；上传者本人可改自己的资料，管理员可改任意 */
  async rename(id: number, originalName: string): Promise<MediaItem> {
    const r = await mediaHttp.put(`${base()}/media/${id}`, { originalName });
    if (!r.data?.data) throw new Error(r.data?.message || '重命名失败');
    return r.data.data;
  },

  async prepare(id: number): Promise<void> {
    await mediaHttp.post(`${base()}/media/${id}/prepare`);
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
