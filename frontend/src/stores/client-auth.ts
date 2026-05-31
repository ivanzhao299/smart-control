import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, setApiBaseURL, getApiBaseURL, setClientToken } from '@/services/http';

/**
 * 客户端鉴权 store — 业主级别 (跟 admin-auth 独立).
 *
 * 持久化:
 *   - localStorage 'sc.client.token'    : 30 天 TTL token
 *   - localStorage 'sc.client.baseURL'  : 业主输入的服务器地址 (http.ts setApiBaseURL 管这个)
 *
 * 登录页 ClientLoginPage 用这个 store:
 *   1. 输入服务器地址 → setBaseURL(url) → 测试连接
 *   2. 输入密码 → login(pw) → 服务端返 token → setToken(token)
 *   3. 路由 guard 看 isAuthed → 放行
 */

const TOKEN_STORAGE_KEY = 'sc.client.token';
const TOKEN_EXPIRY_KEY = 'sc.client.token.expiresAt';

interface LoginResponse {
  token: string;
  expiresAt: string;
}

export const useClientAuthStore = defineStore('client-auth', () => {
  const token = ref<string | null>(readToken());
  const expiresAt = ref<string | null>(readExpiry());
  const baseURL = ref<string>(getApiBaseURL());
  const loggingIn = ref(false);
  const lastError = ref<string | null>(null);

  // 启动时把 token 同步到 http.ts
  setClientToken(token.value);

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
      return { ok: true, serverTime: data.serverTime };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async function login(password: string): Promise<void> {
    loggingIn.value = true;
    lastError.value = null;
    try {
      const data = await api.post<LoginResponse>('/client-auth/login', { password });
      token.value = data.token;
      expiresAt.value = data.expiresAt;
      try {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
        window.localStorage.setItem(TOKEN_EXPIRY_KEY, data.expiresAt);
      } catch { /* localStorage 不可用 */ }
      setClientToken(data.token);
    } catch (e) {
      lastError.value = (e as Error).message;
      throw e;
    } finally {
      loggingIn.value = false;
    }
  }

  function logout(): void {
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
    logout,
  };
});

function readToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_STORAGE_KEY); } catch { return null; }
}
function readExpiry(): string | null {
  try { return window.localStorage.getItem(TOKEN_EXPIRY_KEY); } catch { return null; }
}
