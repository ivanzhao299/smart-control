import type { ApiOk } from '@/types/api';
import { trackApiCall } from './rum.service';

/**
 * 原生 fetch + AbortController 替代 axios (PERFORMANCE_AUDIT P1-#10).
 *
 * 收益:
 *   - 主 bundle 减 17 KB gzip
 *   - 浏览器原生 connection keep-alive, 不再每请求新连接
 *   - AbortController 标准方式取消请求 (axios 自己一套 CancelToken 已弃用)
 *
 * 接口跟旧 api 完全兼容: api.get / post / put / del 用法不变.
 */

/**
 * baseURL — 改成可动态 setter. 业主从 ClientLogin 页输入服务器地址 (含 :port),
 * 走 setApiBaseURL 注入. 让 PWA 装到任意位置都能连任意 backend, 不再 build-time
 * 写死. 业主原话"为后续生成 APP 作准备".
 *
 * 初值: localStorage 存的 → vite env (VITE_API_BASE_URL) → '/api' (web 默认)
 * APP 化时, 业主第一次启动会被路由 guard 推到 ClientLogin, 输入地址 → 测试 →
 * 登录, 整个过程 baseURL 都设好.
 *
 * 业主输入的是 "http://192.168.124.11:3200" 这种 origin, 我们自动拼 /api.
 */
const STORAGE_KEY_BASE = 'sc.client.baseURL';
function readInitialBaseURL(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_BASE);
    if (stored) return stored;
  } catch { /* localStorage 不可用 (隐私模式) */ }
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return fromEnv ?? '/api';
}
let baseURL: string = readInitialBaseURL();
/** 设置 baseURL, 同时持久化到 localStorage. 传入裸 origin 自动补 /api. */
export function setApiBaseURL(input: string): void {
  let normalized = input.trim().replace(/\/+$/, '');
  if (normalized && !/\/api(\/.*)?$/.test(normalized) && /^https?:\/\//.test(normalized)) {
    normalized = `${normalized}/api`;
  }
  if (!normalized) normalized = '/api';
  baseURL = normalized;
  try { window.localStorage.setItem(STORAGE_KEY_BASE, normalized); } catch {/* ignore */}
}
export function getApiBaseURL(): string { return baseURL; }

/**
 * 把 backend 返的相对路径 (e.g. "/api/media/2/file") 拼成绝对 URL.
 *
 * 背景: backend 返 fileUrl/logoUrl 这种相对路径, axios 请求时会自动拼 baseURL,
 * 但 <video :src> / <img :src> 走浏览器原生 fetch, 用当前 origin 去拼. 当
 * frontend 跟 backend 不同源 (frontend 5173, backend 3200) 时, 浏览器会去
 * 5173/api/... 取 — 404. 必须在前端拼 baseURL 去掉 /api 后缀的 origin.
 *
 * 输入若已是绝对 URL (http://...) 或 data: URL 直接原样返回.
 */
export function absUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  // baseURL 形如 "http://192.168.124.11:3200/api" 或 "/api"
  // 想拿 origin (去掉 /api 后缀), 路径直接拼回去
  const origin = baseURL.replace(/\/api(\/.*)?$/, '');
  // path 已经带 /api/... 前缀, origin 不带 /api, 直接拼
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Admin Bearer token — 由 adminAuth Pinia store 在 login 后调 setAdminToken 注入,
 * logout 时调 clearAdminToken 清掉. 所有 PUT/POST/DELETE 自动带 Authorization 头.
 * GET 不带也行 (后端 GET 都公开), 带了也无害.
 * 用模块级变量而不是从 localStorage 读, 是为了避免 http.ts 反向依赖 Pinia.
 */
let adminToken: string | null = null;
export function setAdminToken(t: string | null): void { adminToken = t; }
export function getAdminToken(): string | null { return adminToken; }

/** 客户端 token (业主级别). 走 X-Client-Token header, 跟 admin token 并列. */
let clientToken: string | null = null;
export function setClientToken(t: string | null): void { clientToken = t; }
export function getClientToken(): string | null { return clientToken; }

export interface HttpRequestConfig {
  /** URL query params, 自动 encode 拼到 url 后. 接受任何 typed interface, 运行时再过滤 nullish. */
  params?: Record<string, unknown>;
  /** 请求 headers (会被合并) */
  headers?: Record<string, string>;
  /** 超时, 默认 15s */
  timeout?: number;
  /** 取消信号 (由调用方控制) */
  signal?: AbortSignal;
}

export class HttpError<T = unknown> extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response?: T,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function buildUrl(url: string, params?: HttpRequestConfig['params']): string {
  // url 可以是 "/system/info" 或 "https://..."
  const full = /^https?:\/\//.test(url) ? url : `${baseURL}${url.startsWith('/') ? url : `/${url}`}`;
  if (!params) return full;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const q = qs.toString();
  if (!q) return full;
  return full + (full.includes('?') ? '&' : '?') + q;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  cfg?: HttpRequestConfig,
): Promise<{ data: T }> {
  const finalUrl = buildUrl(url, cfg?.params);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(cfg?.headers ?? {}),
  };
  // 自动注入 admin token (登录后存在 adminAuth store, 同步到这里的模块变量)
  if (adminToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${adminToken}`;
  }
  // 客户端 token 走专用 header (X-Client-Token), 不跟 admin 抢 Authorization
  if (clientToken && !headers['X-Client-Token']) {
    headers['X-Client-Token'] = clientToken;
  }
  const init: RequestInit = {
    method,
    headers,
    credentials: 'omit',
  };
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  // 超时控制 — 用 AbortController 组合 timeout + 外部 signal
  const timeoutMs = cfg?.timeout ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  if (cfg?.signal) {
    if (cfg.signal.aborted) ctrl.abort(cfg.signal.reason);
    else cfg.signal.addEventListener('abort', () => ctrl.abort(cfg.signal!.reason), { once: true });
  }
  init.signal = ctrl.signal;

  const startMs = performance.now();
  let resp: Response;
  try {
    resp = await fetch(finalUrl, init);
  } catch (err) {
    clearTimeout(timer);
    trackApiCall(url, Math.round(performance.now() - startMs), 0);
    if (ctrl.signal.aborted) {
      const reason = ctrl.signal.reason as Error | string | undefined;
      throw new HttpError(
        typeof reason === 'string' ? reason : reason?.message ?? '请求已取消',
        0,
      );
    }
    throw new HttpError((err as Error).message ?? 'fetch failed', 0);
  }
  clearTimeout(timer);
  trackApiCall(url, Math.round(performance.now() - startMs), resp.status);

  // 304: 让上层用缓存 (useQuery 会用); 直接抛特殊 status
  if (resp.status === 304) {
    return { data: undefined as unknown as T };
  }

  let payload: T | undefined;
  const ct = resp.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try { payload = await resp.json() as T; } catch { /* 空 body */ }
  } else if (resp.status !== 204) {
    try { payload = await resp.text() as unknown as T; } catch { /* ignore */ }
  }

  if (!resp.ok) {
    const msg =
      (payload as { message?: string } | undefined)?.message ??
      `Request failed with status ${resp.status}`;
    throw new HttpError(msg, resp.status, payload);
  }
  return { data: payload as T };
}

async function unwrap<T>(
  p: Promise<{ data: ApiOk<T> | { success: false; message: string } | undefined }>,
): Promise<T> {
  const { data } = await p;
  if (!data || (data as { success?: boolean }).success === false) {
    throw new Error(
      (data && 'message' in data && typeof data.message === 'string' && data.message) || '请求失败',
    );
  }
  return (data as ApiOk<T>).data;
}

export const api = {
  get: <T>(url: string, cfg?: HttpRequestConfig) =>
    unwrap<T>(request<ApiOk<T> | { success: false; message: string }>('GET', url, undefined, cfg)),
  post: <T>(url: string, body?: unknown, cfg?: HttpRequestConfig) =>
    unwrap<T>(request<ApiOk<T> | { success: false; message: string }>('POST', url, body, cfg)),
  put: <T>(url: string, body?: unknown, cfg?: HttpRequestConfig) =>
    unwrap<T>(request<ApiOk<T> | { success: false; message: string }>('PUT', url, body, cfg)),
  del: <T>(url: string, cfg?: HttpRequestConfig) =>
    unwrap<T>(request<ApiOk<T> | { success: false; message: string }>('DELETE', url, undefined, cfg)),
};

// 给少数需要 status / headers 的调用方暴露底层 request (e.g. ETag / 大文件下载)
export const http = {
  request,
  baseURL,
};

// 旧 axios.AxiosRequestConfig 类型兼容 alias —— 上层 service.ts 都 import type 用了
export type AxiosRequestConfig = HttpRequestConfig;
