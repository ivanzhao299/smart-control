import axios, { type AxiosProgressEvent, type AxiosRequestConfig } from 'axios';
import { getApiBaseURL, getClientToken, getAdminToken } from './http';
import { identityGeneration, assertCurrentIdentity, onIdentityChange } from './identity-boundary';

/**
 * media 专用 axios(留着只为上传进度回调 —— http.ts 那套 fetch 没有 onUploadProgress)。
 *
 * 不走 http.ts，必须同步捕获身份、带鉴权头并独立处理切换取消。
 * Fetch adapter 禁止重定向；浏览器支持请求流时才有细粒度上传进度。
 */
// Capture identity synchronously with the URL, not in an asynchronous interceptor.
// Fetch adapter prevents redirects (XHR cannot), and supports progress where the browser can stream requests.
async function mediaRequest(method: 'GET' | 'POST' | 'DELETE', url: string, data?: unknown, config: AxiosRequestConfig = {}) {
  const generation = identityGeneration();
  const clientToken = getClientToken();
  const adminToken = getAdminToken();
  const controller = new AbortController();
  const unsubscribe = onIdentityChange(() => controller.abort());
  try {
    const result = await axios.request({
      ...config, method, url, data,
      adapter: 'fetch',
      fetchOptions: { redirect: 'error', cache: 'no-store' },
      withCredentials: false,
      signal: controller.signal,
      headers: {
        ...config.headers,
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
  }
}
const mediaHttp = {
  get: (url: string, config?: AxiosRequestConfig) => mediaRequest('GET', url, undefined, config),
  post: (url: string, data?: unknown, config?: AxiosRequestConfig) => mediaRequest('POST', url, data, config),
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

/**
 * 上传入口统一的 accept 列表 (2026-07-26): PlayerConsole (LED/投影页"上传内容")
 * 原来只有 video/*,image/*,audio/* —— PPT/Word 选不了, .ape/.dsf/.mid 这类无标准
 * MIME 的音频在文件选择器里也被滤掉。所有上传入口共用这一份, 不再两处漂移;
 * 真正的类型判定在 backend classifyKind (按 MIME + 扩展名兜底)。
 */
export const MEDIA_UPLOAD_ACCEPT =
  'video/*,image/*,audio/*,.ppt,.pptx,.doc,.docx,.pdf,.mp3,.wav,.aac,.m4a,.ogg,.flac,.wma,.opus,.aiff,.aif,.ape,.mp2,.mka,.wv,.mid,.midi,.spx,.dsf,.dff,.au,.ra'
  // 视频扩展名兜底: Windows 对 .m4v/.mkv 等常报空 mime, 光靠 video/* 会被选择器滤掉
  + ',.mp4,.m4v,.mov,.mkv,.avi,.webm,.flv,.wmv,.mpg,.mpeg,.3gp,.ts,.vob,.rmvb';

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

  /** 上传, 支持 progress 回调 */
  async upload(
    file: File,
    opts: { remark?: string; onProgress?: (pct: number) => void } = {},
  ): Promise<MediaItem> {
    const fd = new FormData();
    fd.append('file', file);
    if (opts.remark) fd.append('remark', opts.remark);
    const r = await mediaHttp.post(`${base()}/media/upload`, fd, {
      headers: { 'X-Upload-Size': String(file.size) },
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
