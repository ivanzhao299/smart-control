import type { ApiOk } from '@/types/api';
import { trackApiCall } from './rum.service';
import {
  identityGeneration,
  invalidateIdentity,
  assertCurrentIdentity,
  notifyServerChange,
  onIdentityChange,
} from './identity-boundary';

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
 * 业主输入的是 "http://192.168.77.54:3200" 这种 origin, 我们自动拼 /api.
 */
const STORAGE_KEY_BASE = 'sc.client.baseURL';
/** 后端默认端口 — env 里给不出端口时用它 */
const DEFAULT_BACKEND_PORT = 3200;

/** 从形如 http://host:3200/api 的字符串里取端口; 取不到给 null */
function portOfBase(base: string | undefined): number | null {
  if (!base) return null;
  try {
    const p = new URL(base).port;
    return p ? Number.parseInt(p, 10) : null;
  } catch {
    return null;
  }
}

/**
 * 没存过地址时的默认值.
 *
 * ⚠️ 别直接用 VITE_API_BASE_URL (它是 http://localhost:3200/api):
 * localhost 只在 GK9000 那台机器上成立。业主用手机/平板打开 PWA 时, localhost
 * 指的是**手机自己**, 必然连不上 —— 于是每台新设备、每次重装 PWA 都得手动清掉
 * 再敲一遍真实地址。业主原话: "每次都要输入网址"。
 *
 * 改成从**当前页面的 origin** 推: PWA 从哪台机器打开, backend 就在那台机器上。
 *   kiosk 上页面是 http://localhost:5173     -> 推出 http://localhost:3200/api (行为不变)
 *   手机上页面是 http://192.168.77.54:5173   -> 推出 http://192.168.77.54:3200/api (正是要的)
 * 端口沿用 env 里写的 (没有就 3200), 这样换端口只改 env 一处。
 *
 * 例外: env 是相对路径 (e.g. '/control/api') 说明是 nginx 同源反代部署, 那种情况
 * origin 推断会推出错误的 :3200, 所以相对路径优先直接用。
 */
function readInitialBaseURL(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;

  // 2026-07-30 (公网直连+现场自动提速): **页面 origin 优先**于存的地址。
  // App 壳会按"现场优先"自动选择加载现场(192.168.77.54:5173)还是公网
  // (erp.cnjinhu.top:8443)——API 必须跟着页面走, 否则现场打开页面、API 却
  // 打到存下来的公网地址, 流量绕北京一圈白白变慢。
  // 登录页手输的服务器地址仍即时生效 (setApiBaseURL 运行时覆盖), 只是
  // 下次启动会重新按页面 origin 推。
  try {
    const { protocol, hostname, port } = window.location;
    if (/^https?:$/.test(protocol) && hostname) {
      // 反代域名场景 (公网 erp.cnjinhu.top:8443 等): 页面不在 5173 上说明走的是
      // nginx 统一入口, /api 由同一入口反代到 backend — API 直接同源, 零配置。
      if (port !== '5173') {
        const scopedHosts = (import.meta.env.VITE_SCOPED_API_HOSTS ?? 'park.cnjinhu.com')
          .split(',')
          .map((host) => host.trim().toLowerCase())
          .filter(Boolean);
        const scopedBase = scopedHosts.includes(hostname.toLowerCase()) && fromEnv?.startsWith('/')
          ? fromEnv
          : '/api';
        return `${protocol}//${window.location.host}${scopedBase}`;
      }
      // 经典双端口场景 (5173 前端 + 3200 后端): 按 env 端口推 backend
      const bePort = portOfBase(fromEnv) ?? DEFAULT_BACKEND_PORT;
      return `${protocol}//${hostname}:${bePort}/api`;
    }
  } catch { /* 非浏览器环境 (SSR/测试) */ }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_BASE);
    if (stored) return stored;
  } catch { /* localStorage 不可用 (隐私模式) */ }

  if (fromEnv && fromEnv.startsWith('/')) return fromEnv; // 同源反代

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
  const changed = baseURL !== normalized;
  baseURL = normalized;
  if (changed) {
    // Clear both identities before any subscriber can start a request to the new server.
    adminToken = null;
    clientToken = null;
    notifyServerChange();
    invalidateIdentity();
  }
  try { window.localStorage.setItem(STORAGE_KEY_BASE, normalized); } catch {/* ignore */}
}
export function getApiBaseURL(): string { return baseURL; }

/**
 * 当前是否走"局域网/本机直连后端"(经典 5173 前端 + 3200 后端), 不经过公网
 * Nginx / WireGuard 隧道。判断依据:
 *   - 页面跑在 5173 端口(本地双端口布局), 或
 *   - baseURL 解析后指向 3200 端口。
 * 直连场景: 上传走局域网高速、不限大小(见 useMediaUploadQueue)。
 */
export function isDirectLocalConnection(): boolean {
  try {
    if (window.location.port === '5173') return true;
    const u = new URL(baseURL, window.location.href);
    if (u.port === '3200') return true;
    // 异步探测到的局域网直连(域名访问场景)
    if (lanProbe.state === 'ok') return true;
    return false;
  } catch { return false; }
}

/**
 * 局域网探测(2026-10-15): 用户用域名 https://erp.cnjinhu.com 访问时,
 * location.port 是 443, 旧逻辑判定为"远程", 上传走公网 Nginx/WireGuard 慢。
 *
 * 但人在园区 WiFi 里时, 后端其实在身边 192.168.77.54:3200。做法:
 *   1) 同源 GET /api/system/info (走 Nginx), 拿后端返回的 lanBaseUrl
 *      (由后端 env LAN_PUBLIC_URL 配置, 例如 http://192.168.77.54:3200)。
 *   2) 用 1500ms 短超时 fetch ${lanBaseUrl}/api/system/info。
 *      - 成功: 说明手机和后端在同一局域网, 上传直连绕开 Nginx。
 *      - 失败/超时/混合内容被拦: 回退 Nginx, 不影响正常公网使用。
 *
 * 结果缓存到模块变量; 只探一次, 不反复打。
 */
const lanProbe: { state: 'idle' | 'probing' | 'ok' | 'fail'; endpoint: string | null } = {
  state: 'idle',
  endpoint: null,
};

/** 触发一次局域网探测(幂等; App.vue onMounted 调)。 */
export async function detectLanConnection(): Promise<void> {
  if (lanProbe.state !== 'idle') return;
  // 已经是经典直连(5173/3200), 不用探
  if (typeof window !== 'undefined' && window.location.port === '5173') {
    lanProbe.state = 'ok';
    return;
  }
  lanProbe.state = 'probing';
  try {
    // 同源拿 lanBaseUrl (走 Nginx, 必然通)
    const res = await fetch('/api/system/info', { cache: 'no-store' });
    if (!res.ok) throw new Error('info ' + res.status);
    const j = await res.json();
    const lan = j?.data?.lanBaseUrl;
    if (!lan) throw new Error('no lanBaseUrl');
    // 短超时直连探测
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const r2 = await fetch(`${lan.replace(/\/+$/, '')}/api/system/info`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (r2.ok) {
      lanProbe.endpoint = lan;
      lanProbe.state = 'ok';
    } else {
      lanProbe.state = 'fail';
    }
  } catch {
    lanProbe.state = 'fail';
  }
}

/** 上传专用 baseURL: 局域网探测成功时直连后端, 否则走默认 baseURL。 */
export function getUploadBaseURL(): string {
  // 异步探测成功: 用后端返回的局域网地址
  if (lanProbe.state === 'ok' && lanProbe.endpoint) {
    return `${lanProbe.endpoint.replace(/\/+$/, '')}/api`;
  }
  // 经典直连: 页面跑在 5173, 走 vite proxy 同源 /api (避免跨端口 CORS)
  if (typeof window !== 'undefined' && window.location.port === '5173') {
    return '/api';
  }
  return baseURL;
}

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
  // baseURL 形如 "http://192.168.77.54:3200/api" 或 "/api"
  // 想拿 origin (去掉 /api 后缀), 路径直接拼回去
  const origin = baseURL.replace(/\/api(\/.*)?$/, '');
  // path 已经带 /api/... 前缀, origin 不带 /api, 直接拼
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 连通性监听 — MainLayout 注册回调, 每次请求结束报告 "服务器可达/不可达".
 * 网络层失败 (fetch 抛错 / 超时) 报 false; 只要拿到 HTTP 响应 (哪怕 500) 报 true.
 * 调用方主动取消的请求 (外部 signal abort) 不算失败, 不报告.
 * 用途: 连续失败 → 弹服务器地址设置框, 让业主换 IP.
 */
let connectivityListener: ((ok: boolean) => void) | null = null;
export function setConnectivityListener(fn: ((ok: boolean) => void) | null): void {
  connectivityListener = fn;
}
function reportConnectivity(ok: boolean): void {
  try { connectivityListener?.(ok); } catch { /* 监听器异常不影响请求 */ }
}

/**
 * Admin Bearer token — 由 adminAuth Pinia store 在 login 后调 setAdminToken 注入,
 * logout 时调 clearAdminToken 清掉. 所有 PUT/POST/DELETE 自动带 Authorization 头.
 * GET 不带也行 (后端 GET 都公开), 带了也无害.
 * 用模块级变量而不是从 localStorage 读, 是为了避免 http.ts 反向依赖 Pinia.
 */
let adminToken: string | null = null;
export function setAdminToken(t: string | null): void {
  if (adminToken === t) return;
  adminToken = t; invalidateIdentity();
}
export function getAdminToken(): string | null { return adminToken; }

/** 客户端 token (业主级别). 走 X-Client-Token header, 跟 admin token 并列. */
let clientToken: string | null = null;
export function setClientToken(t: string | null): void {
  if (clientToken === t) return;
  clientToken = t; invalidateIdentity();
}
export function getClientToken(): string | null { return clientToken; }

/**
 * 401 兜底钩子。签名令牌可跨部署和重启；非登录端点返回 401 时，App.vue 清除
 * 已失效令牌并回登录页重新认证。浏览器不保存密码做静默重登。
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void { onUnauthorized = fn; }
/** 主动触发全局 401 兜底（供不走 http.ts 的独立 axios，如 media 上传在自身 401 时调用）。 */
export function notifyUnauthorized(): void {
  try { onUnauthorized?.(); } catch { /* 钩子异常不影响调用方 */ }
}

export interface HttpRequestConfig {
  /** URL query params, 自动 encode 拼到 url 后. 接受任何 typed interface, 运行时再过滤 nullish. */
  params?: Record<string, unknown>;
  /** 请求 headers (会被合并) */
  headers?: Record<string, string>;
  /** 超时, 默认 15s */
  timeout?: number;
  /** 取消信号 (由调用方控制) */
  signal?: AbortSignal;
  /** GET 专用: 绕过短缓存与 in-flight 合并, 强制重新拉取 (诊断/手动刷新用) */
  refresh?: boolean;
  /** 响应解析: 默认 json; blob 用于图片/文件二进制 (稳定 URL, 走浏览器 HTTP 缓存) */
  responseType?: 'json' | 'blob';
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

async function rawRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  cfg?: HttpRequestConfig,
): Promise<{ data: T }> {
  const generation = identityGeneration();
  const finalUrl = buildUrl(url, cfg?.params);
  const headers: Record<string, string> = {
    Accept: cfg?.responseType === 'blob' ? '*/*' : 'application/json',
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
    redirect: 'error',
    cache: cfg?.responseType === 'blob' ? 'default' : 'no-store',
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
    assertCurrentIdentity(generation);
    trackApiCall(url, Math.round(performance.now() - startMs), 0);
    // 外部主动取消不算连不上; 超时/网络错误才报不可达
    const externallyAborted = cfg?.signal?.aborted === true;
    if (!externallyAborted) reportConnectivity(false);
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
  assertCurrentIdentity(generation);
  trackApiCall(url, Math.round(performance.now() - startMs), resp.status);
  reportConnectivity(true);

  // 304: 让上层用缓存 (useQuery 会用); 直接抛特殊 status
  if (resp.status === 304) {
    return { data: undefined as unknown as T };
  }

  let payload: T | undefined;
  const ct = resp.headers.get('content-type') ?? '';
  if (cfg?.responseType === 'blob') {
    payload = (await resp.blob()) as unknown as T;
  } else if (ct.includes('application/json')) {
    try { payload = await resp.json() as T; } catch { /* 空 body */ }
  } else if (resp.status !== 204) {
    try { payload = await resp.text() as unknown as T; } catch { /* ignore */ }
  }

  assertCurrentIdentity(generation);
  if (!resp.ok) {
    // 401 且不是登录/ping/后台会话探测端点本身 → 通知上层重新鉴权。
    // - 登录端点的 401 是密码错, 不该触发；
    // - admin/auth/me 是"我是否登录后台"的探测, 非后台角色(如 operator)会得到 401,
    //   由 admin-auth store 自己 catch 返回 false; 它只影响后台身份、不影响前台 client
    //   会话(两套鉴权独立), 绝不能据此清掉前台 token, 否则操作员登录后即被弹回。
    if (resp.status === 401 && !/(client-auth\/(login|ping)|admin\/auth\/(login|me))/.test(url)) {
      try { onUnauthorized?.(); } catch { /* 钩子异常不影响本次请求抛错 */ }
    }
    const msg =
      (payload as { message?: string } | undefined)?.message ??
      `Request failed with status ${resp.status}`;
    throw new HttpError(msg, resp.status, payload);
  }
  return { data: payload as T };
}

/**
 * GET 请求去重 / 短缓存 (2026-10-06)。
 *
 * 问题: 登录后同一批清单/配置接口被「路由守卫、各 Pinia store、MainLayout 预热、
 * 落地页 onMounted」重复拉取——admin/auth/me、client-auth/me 同一时刻各发 2 次,
 * scenes/devices/light-zones 在登录后多个串行波次里重复拉, 经公网(每请求
 * TTFB 0.5–1s)把登录拖到数秒。
 *
 * 两层:
 *   1) in-flight 合并 (所有 GET 默认): 同一最终 URL 且同一身份代次的请求正在
 *      进行时, 复用同一个 promise, 不重复发——零新鲜度代价。
 *   2) 短 TTL 内存缓存 (仅"配置/清单类"端点, cacheTtlFor): TTL 内直接返回;
 *      实时状态/身份端点不做 TTL。写操作后清空 TTL 缓存, 身份/服务器切换时全清。
 * key 前缀 identityGeneration, 天然随账户/服务器切换隔离。
 */
interface CachedPayload { payload: unknown; at: number }
const inflightGet = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, CachedPayload>();
const CACHE_TTL_MS = 30_000;

/**
 * 各端点 GET 缓存 TTL(ms)。配置/清单类 30s；power-circuits 为后台 10s 采集的
 * 开关快照, 给 10s(与采集周期一致), 让多处共享、写操作后清缓存重读;
 * 其余(实时/身份端点)不在表内 → 0, 仅做 in-flight 合并。
 *
 * 实时端点刻意不做 TTL: /playback/channels(播放状态)、/system-branding(欢迎页内容)
 * 必须在切源/改完即刻反映, TTL 会让画面或状态最长延迟 30s; 它们仍享受 in-flight 合并。
 */
const CACHE_TTL_BY_PATH: Record<string, number> = {
  '/scenes': CACHE_TTL_MS,
  '/devices': CACHE_TTL_MS,
  '/light-zones': CACHE_TTL_MS,
  '/dali-lights': CACHE_TTL_MS,
  '/dali-lights/gateways': CACHE_TTL_MS,
  '/system/info': CACHE_TTL_MS,
  '/system/runtime/gateways': CACHE_TTL_MS,
  '/system/runtime/devices': CACHE_TTL_MS,
  '/client-auth/ping': CACHE_TTL_MS,
  '/media': CACHE_TTL_MS,
  '/power-circuits': 10_000,
};
function cacheTtlFor(pathWithQuery: string): number {
  return CACHE_TTL_BY_PATH[pathWithQuery.split('?')[0]] ?? 0;
}

// 账户/服务器切换: 丢弃所有共享请求与缓存(旧代次结果不再被复用)。
onIdentityChange(() => {
  inflightGet.clear();
  responseCache.clear();
});

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  cfg?: HttpRequestConfig,
): Promise<{ data: T }> {
  const generation = identityGeneration();
  const finalUrl = buildUrl(url, cfg?.params);

  if (method === 'GET' && cfg?.refresh !== true && cfg?.responseType !== 'blob') {
    const key = `${generation}|${finalUrl}`;
    const ttl = cacheTtlFor(url);
    if (ttl > 0) {
      const hit = responseCache.get(key);
      if (hit && performance.now() - hit.at < ttl) {
        assertCurrentIdentity(generation);
        return { data: hit.payload as T };
      }
    }
    const shared = inflightGet.get(key);
    if (shared) {
      assertCurrentIdentity(generation);
      return { data: (await shared) as T };
    }
    const work = rawRequest<T>('GET', url, undefined, cfg)
      .then((r) => {
        if (ttl > 0 && identityGeneration() === generation) {
          responseCache.set(key, { payload: r.data, at: performance.now() });
        }
        return r.data;
      })
      .finally(() => { inflightGet.delete(key); });
    inflightGet.set(key, work);
    return { data: (await work) as T };
  }

  try {
    return await rawRequest<T>(method, url, body, cfg);
  } finally {
    // 写操作后清单/配置可能变化: 丢弃 TTL 缓存, 下次读取拉新值。
    if (method !== 'GET') responseCache.clear();
  }
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
