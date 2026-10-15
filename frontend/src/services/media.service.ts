import axios, { type AxiosRequestConfig } from 'axios';
import { getApiBaseURL, getClientToken, getAdminToken, isDirectLocalConnection, getUploadBaseURL } from './http';
import { identityGeneration, assertCurrentIdentity, onIdentityChange } from './identity-boundary';
export { MEDIA_UPLOAD_ACCEPT } from '../features/media-file-intake';

/**
 * media 专用 axios, 用于非上传请求(list/access/rename/delete 等 GET/小 JSON)。
 * 大文件上传不走这里 —— 见下方 xhrUpload(原生 XHR; axios fetch 流式体在 HTTP
 * 直连后端时会触发 ERR_ALPN_NEGOTIATION_FAILED)。
 *
 * 不走 http.ts，必须同步捕获身份、带鉴权头并独立处理切换取消。
 * Fetch adapter 禁止重定向。
 */
// Capture identity synchronously with the URL, not in an asynchronous interceptor.
// Fetch adapter forbids redirects. Non-upload requests have no streaming body, so they stay on axios.
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
 * 其它页面 (http.ts 体系) 一致。上传进度由 xhrUpload 的 upload.onprogress 提供。
 */
const base = (): string => getApiBaseURL();

/**
 * 大文件上传必须走原生 XMLHttpRequest, 不能走 axios 的 fetch adapter。
 *
 * 根因(2026-10-15 真机/浏览器实测锁定): axios fetch adapter 只要传了 onUploadProgress,
 * 就会把 FormData 请求体包成 ReadableStream + `duplex:'half'` 流式发送
 * (见 node_modules/axios/lib/adapters/fetch.js supportsRequestStream 分支)。
 * 浏览器在【HTTP 直连后端】(局域网 http://192.168.77.54:3200) 发送流式请求体时,
 * 触发 net::ERR_ALPN_NEGOTIATION_FAILED, POST 直接失败(preflight 与 GET 都正常),
 * 表现为"5173 局域网一上传就提示上传失败"；同一份请求用原生 fetch 非流式 / XHR 均 201 成功。
 * 域名 HTTPS 经 Nginx 时流式体侥幸能发, 但走隧道极慢。
 *
 * XHR 由浏览器原生处理 multipart 上传, 既能拿到真实 upload.onprogress, 又对
 * HTTP/HTTPS、CORS、abort 全平台稳定, 是大文件上传的标准做法。
 */
function xhrUpload(
  url: string,
  form: FormData,
  headers: Record<string, string>,
  opts: { onProgress?: (pct: number) => void; signal?: AbortSignal; timeoutMs: number },
): Promise<{ data?: unknown; message?: string }> {
  return new Promise((resolve, reject) => {
    const generation = identityGeneration();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    // 跨域: 不带 cookie, 与 mediaRequest(axios fetch) 保持一致。
    xhr.withCredentials = false;
    xhr.timeout = opts.timeoutMs;
    // 注意: 绝不手动 set Content-Type, 交给浏览器为 FormData 自动带 multipart boundary。
    Object.entries(headers).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') xhr.setRequestHeader(key, value);
    });

    // 身份切换(换服务器/换账号) -> 中止本次上传。
    const offIdentity = onIdentityChange(() => { try { xhr.abort(); } catch { /* ignore */ } });
    // 用户点"取消上传" -> 外部 signal abort 联动 xhr.abort。
    let offSignal: (() => void) | null = null;
    const onExternalAbort = () => { try { xhr.abort(); } catch { /* ignore */ } };
    if (opts.signal) {
      if (opts.signal.aborted) {
        onExternalAbort();
      } else {
        opts.signal.addEventListener('abort', onExternalAbort, { once: true });
        offSignal = () => opts.signal?.removeEventListener('abort', onExternalAbort);
      }
    }

    let settled = false;
    const cleanup = () => {
      offIdentity();
      if (offSignal) offSignal();
    };
    const finalize = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    xhr.upload.onprogress = (event: ProgressEvent) => {
      if (event.lengthComputable && opts.onProgress && generation === identityGeneration()) {
        opts.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };

    const parseBody = (): any => {
      try { return xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { return null; }
    };

    xhr.onload = () => finalize(() => {
      const body = parseBody();
      if (xhr.status >= 200 && xhr.status < 300) {
        assertCurrentIdentity(generation);
        resolve(body ?? {});
      } else {
        // 伪装成 axios error 的结构, 使上层 useMediaUploadQueue 的 isAxiosError +
        // error.response.status === 401 分支继续生效。
        const err = new Error(body?.message || `上传失败 (HTTP ${xhr.status})`) as Error & {
          isAxiosError?: boolean; response?: { status: number; data: unknown };
        };
        err.isAxiosError = true;
        err.response = { status: xhr.status, data: body };
        reject(err);
      }
    });

    xhr.onabort = () => finalize(() => {
      // 同时满足 axios.isCancel(仅判断 __CANCEL__===true) 与原生 AbortError 语义。
      const canceled = new Error('上传已取消') as Error & { __CANCEL__?: boolean };
      canceled.name = 'CanceledError';
      canceled.__CANCEL__ = true;
      reject(canceled);
    });

    xhr.onerror = () => finalize(() => {
      const err = new Error('网络错误：上传请求被中断（可能跨域受限、网络被拦截或已断开）') as Error & {
        isAxiosError?: boolean; response?: { status: number; data: null };
      };
      err.isAxiosError = true;
      err.response = { status: 0, data: null };
      reject(err);
    });

    xhr.ontimeout = () => finalize(() => reject(new Error('上传超时，请改用局域网或缩小文件')));

    xhr.send(form);
  });
}

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

  /** 上传, 支持 progress 回调; opts.signal 可取消。走原生 XHR(见 xhrUpload 注释)。 */
  async upload(
    file: File,
    opts: { remark?: string; onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
  ): Promise<MediaItem> {
    const fd = new FormData();
    fd.append('file', file);
    if (opts.remark) fd.append('remark', opts.remark);
    // 上传走专用 baseURL(局域网探测成功则直连后端, 否则同源 Nginx)
    const uploadBase = getUploadBaseURL();
    const clientToken = getClientToken();
    const adminToken = getAdminToken();
    const body = await xhrUpload(
      `${uploadBase}/media/upload`,
      fd,
      {
        'X-Upload-Size': String(file.size),
        ...(clientToken ? { 'X-Client-Token': clientToken } : {}),
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      },
      {
        // 局域网/本机直连: 不限大小, 不设整体超时(0=无超时)；公网: 30 分钟兜底大视频。
        timeoutMs: isDirectLocalConnection() ? 0 : 30 * 60 * 1000,
        signal: opts.signal,
        onProgress: opts.onProgress,
      },
    );
    if (!body?.data) throw new Error(body?.message || '上传失败');
    return body.data as MediaItem;
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
