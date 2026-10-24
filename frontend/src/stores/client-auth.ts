import { defineStore } from 'pinia';
import { computed, ref, onScopeDispose } from 'vue';
import { onServerChange } from '@/services/identity-boundary';
import { api, setApiBaseURL, getApiBaseURL, setClientToken } from '@/services/http';

/**
 * 客户端鉴权 store — 业主级别 (跟 admin-auth 独立).
 *
 * 持久化:
 *   - localStorage 'sc.client.token'    : 30 天 TTL token
 *   - localStorage 'sc.client.baseURL'  : 业主输入的服务器地址 (http.ts setApiBaseURL 管这个)
 *   - localStorage 'sc.client.savedUsername' : 仅保存用户名，方便下次输入
 *
 * 令牌由后端持久签名密钥验证，部署和进程重启不会再使会话失效。浏览器不得保存
 * 明文密码；历史版本留下的 sc.client.savedPassword 会在初始化或登录时清除。
 *
 * 登录页 ClientLoginPage 用这个 store:
 *   1. 输入服务器地址 → setBaseURL(url) → 测试连接
 *   2. 输入用户名和密码 → login(username, pw) → 服务端返 token → setToken(token) → 顺带存凭据
 *   3. 路由 guard 看 isAuthed → 放行；令牌失效时返回登录页重新认证
 */

const TOKEN_STORAGE_KEY = 'sc.client.token';
const TOKEN_EXPIRY_KEY = 'sc.client.token.expiresAt';
const LEGACY_SAVED_PASSWORD_KEY = 'sc.client.savedPassword';
const SAVED_USERNAME_KEY = 'sc.client.savedUsername';
const SERVER_KEY = 'sc.client.authServer';

interface LoginResponse {
  token: string;
  expiresAt: string;
}

export const useClientAuthStore = defineStore('client-auth', () => {
  removeLegacySavedPassword();
  const token = ref<string | null>(readToken());
  const expiresAt = ref<string | null>(readExpiry());
  const baseURL = ref<string>(getApiBaseURL());
  const loggingIn = ref(false);
  const lastError = ref<string | null>(null);

  // 启动时把 token 同步到 http.ts
  setClientToken(token.value);
  onScopeDispose(onServerChange(() => {
    logout();
    baseURL.value = getApiBaseURL();
  }));

  const isAuthed = computed<boolean>(() => {
    if (!token.value) return false;
    if (expiresAt.value) {
      try {
        if (new Date(expiresAt.value).getTime() < Date.now()) return false;
      } catch { /* 时间字符串坏 */ }
    }
    return true;
  });

  /** 改服务器地址 — 同时持久化 + 同步到 http.ts */
  function setBaseURL(url: string): void {
    setApiBaseURL(url);
    baseURL.value = getApiBaseURL();
  }

  /** 测试连接 — 调 /api/client-auth/ping, 验证 backend 在线 + 路径对 */
  async function testConnection(): Promise<{ ok: boolean; error?: string; serverTime?: string }> {
    try {
      const data = await api.get<{ ok: true; serverTime: string }>('/client-auth/ping', { timeout: 5000 });
      if (data?.ok !== true) return { ok: false, error: '服务器返回无效响应' };
      return { ok: true, serverTime: data.serverTime };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async function login(username: string, password: string, opts: { remember?: boolean } = {}): Promise<void> {
    loggingIn.value = true;
    lastError.value = null;
    try {
      const normalizedUsername = username.trim();
      if (!normalizedUsername) throw new Error('请输入用户名；旧版访问密码不能用于设备控制，请使用用户管理中的账户');
      const data = await api.post<LoginResponse>('/client-auth/login', {
        username: normalizedUsername || undefined,
        password,
      });
      token.value = data.token;
      expiresAt.value = data.expiresAt;
      try {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
        window.localStorage.setItem(TOKEN_EXPIRY_KEY, data.expiresAt);
        window.localStorage.setItem(SERVER_KEY, getApiBaseURL());
        // Signed tokens survive deployments. Never retain a reusable plaintext password.
        window.localStorage.removeItem(LEGACY_SAVED_PASSWORD_KEY);
        window.localStorage.removeItem(SAVED_USERNAME_KEY);
        if (opts.remember !== false) {
          window.localStorage.setItem(SAVED_USERNAME_KEY, normalizedUsername);
        }
      } catch { /* localStorage 不可用 */ }
      setClientToken(data.token);
    } catch (e) {
      lastError.value = (e as Error).message;
      throw e;
    } finally {
      loggingIn.value = false;
    }
  }

  /**
   * 只清理遗留的浏览器明文密码（绝不能留存），名称暂留用于壳生物认证失败后的
   * 兼容调用。用户名不是秘密、且登录页会据此自动回填，这里刻意保留——
   * 现场固定账号，主动退出后仍记住用户名，可省掉每次重输（尤其在壳 WebView 里
   * 第三方键盘受限，能少打字）。
   */
  function clearSavedPassword(): void {
    try {
      window.localStorage.removeItem(LEGACY_SAVED_PASSWORD_KEY);
    } catch { /* ignore */ }
  }

  function logout(): void {
    token.value = null;
    expiresAt.value = null;
    setClientToken(null);
    try {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(TOKEN_EXPIRY_KEY);
      // 保留 SERVER_KEY：主动退出后仍绑定同一服务器，登录页据此自动回填服务器地址
      // 与上次用户名（现场只需输密码，规避壳 WebView 第三方键盘受限）。
      // 切换服务器时 setApiBaseURL 已改变 baseURL，isBoundToCurrentServer 会自然变
      // false，不会误读旧服务器的 token/用户名。明文密码仍由 clearSavedPassword 清除。
    } catch { /* ignore */ }
    clearSavedPassword();
  }

  /**
   * token 被后端判失效（密码或签名密钥轮换、账号停用等）时清掉会话。
   * 用户名继续保留用于登录表单自动填充；主动 logout 同样保留用户名（仅清密码/token）。
   */
  function markSessionExpired(): void {
    token.value = null;
    expiresAt.value = null;
    setClientToken(null);
    try {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(TOKEN_EXPIRY_KEY);
    } catch { /* ignore */ }
  }

  return {
    token,
    expiresAt,
    baseURL,
    loggingIn,
    lastError,
    isAuthed,
    setBaseURL,
    testConnection,
    login,
    clearSavedPassword,
    logout,
    markSessionExpired,
  };
});

function readToken(): string | null {
  if (!isBoundToCurrentServer()) return null;
  try {
    const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const expiry = window.localStorage.getItem(TOKEN_EXPIRY_KEY);
    // 过期 token 不能继续注入 http.ts，否则路由守卫会把它当作客户端身份
    // 去探测 /admin/auth/me，冷启动会被网络超时拖成“系统页面未能启动”。
    if (token && expiry) {
      const expMs = Date.parse(expiry);
      if (Number.isFinite(expMs) && expMs <= Date.now()) {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        window.localStorage.removeItem(TOKEN_EXPIRY_KEY);
        return null;
      }
    }
    return token;
  } catch { return null; }
}
function readExpiry(): string | null {
  if (!isBoundToCurrentServer()) return null;
  try { return window.localStorage.getItem(TOKEN_EXPIRY_KEY); } catch { return null; }
}
export function readSavedUsername(): string {
  if (!isBoundToCurrentServer()) return '';
  try { return window.localStorage.getItem(SAVED_USERNAME_KEY) ?? ''; } catch { return ''; }
}
function isBoundToCurrentServer(): boolean {
  try { return window.localStorage.getItem(SERVER_KEY) === getApiBaseURL(); } catch { return false; }
}
function removeLegacySavedPassword(): void {
  try { window.localStorage.removeItem(LEGACY_SAVED_PASSWORD_KEY); } catch { /* ignore */ }
}
