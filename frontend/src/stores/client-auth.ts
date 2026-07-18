import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, setApiBaseURL, getApiBaseURL, setClientToken } from '@/services/http';

/**
 * 客户端鉴权 store — 业主级别 (跟 admin-auth 独立).
 *
 * 持久化:
 *   - localStorage 'sc.client.token'    : 30 天 TTL token
 *   - localStorage 'sc.client.baseURL'  : 业主输入的服务器地址 (http.ts setApiBaseURL 管这个)
 *   - localStorage 'sc.client.savedPassword' : 密码正确登录过就存下来, 下次自动登录用
 *     (见 tryAutoLogin) —— token 是 30 天 TTL 没错, 但 backend 每次重启/重新部署,
 *     session 表 (内存 Map) 会清空, token 没到期也会失效, 业主就得重新输一遍密码。
 *     存密码本地自动重登, 免得每次部署完业主都要摸出手机重新登录。
 *     跟 token 同样存在 localStorage, 暴露面不比已经在存的 token 更大。
 *
 * 登录页 ClientLoginPage 用这个 store:
 *   1. 输入服务器地址 → setBaseURL(url) → 测试连接
 *   2. 输入密码 → login(pw) → 服务端返 token → setToken(token) → 顺带存密码
 *   3. 路由 guard 看 isAuthed → 放行; 没 token 时登录页会先试 tryAutoLogin()
 */

const TOKEN_STORAGE_KEY = 'sc.client.token';
const TOKEN_EXPIRY_KEY = 'sc.client.token.expiresAt';
const SAVED_PASSWORD_KEY = 'sc.client.savedPassword';

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

  async function login(password: string, opts: { remember?: boolean } = {}): Promise<void> {
    loggingIn.value = true;
    lastError.value = null;
    try {
      const data = await api.post<LoginResponse>('/client-auth/login', { password });
      token.value = data.token;
      expiresAt.value = data.expiresAt;
      try {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
        window.localStorage.setItem(TOKEN_EXPIRY_KEY, data.expiresAt);
        // 默认记密码 (remember:false 才不存, 目前没地方传 false, 等于永远记) ——
        // 密码对了才走到这里, "保存密码并自动登录" 就是这么来的。
        if (opts.remember !== false) window.localStorage.setItem(SAVED_PASSWORD_KEY, password);
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
   * 登录页挂载时先试这个: 本地存过密码就悄悄重登一次, 登上了直接跳走, 业主感觉不到
   * "又要登一次"。密码后来被改过 (admin 强制重置过客户端密码) 会登失败, 这时清掉存的
   * 密码 —— 不然每次都要打一遍失败请求, 而且旧密码摆在 localStorage 里也没意义了。
   */
  async function tryAutoLogin(): Promise<boolean> {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(SAVED_PASSWORD_KEY); } catch { /* ignore */ }
    if (!saved) return false;
    try {
      await login(saved);
      return true;
    } catch {
      clearSavedPassword();
      return false;
    }
  }

  function clearSavedPassword(): void {
    try { window.localStorage.removeItem(SAVED_PASSWORD_KEY); } catch { /* ignore */ }
  }

  function logout(): void {
    token.value = null;
    expiresAt.value = null;
    setClientToken(null);
    try {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(TOKEN_EXPIRY_KEY);
    } catch { /* ignore */ }
    clearSavedPassword();
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
    tryAutoLogin,
    clearSavedPassword,
    logout,
  };
});

function readToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_STORAGE_KEY); } catch { return null; }
}
function readExpiry(): string | null {
  try { return window.localStorage.getItem(TOKEN_EXPIRY_KEY); } catch { return null; }
}
