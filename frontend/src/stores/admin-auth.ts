import { defineStore } from 'pinia';
import { computed, ref, onScopeDispose } from 'vue';
import { onServerChange } from '@/services/identity-boundary';
import { adminLogin, adminLogout, adminMe } from '@/services/admin-auth.service';
import { HttpError, setAdminToken, getApiBaseURL, getClientToken } from '@/services/http';

/**
 * 后台鉴权 store.
 *
 * token 存 sessionStorage 而不是 localStorage — 关浏览器自动清, 比"8 小时" 还短,
 * 业主下班关电脑 = 自动登出. 同时 backend 重启 / 改密码后 token 失效, 一切自然.
 *
 * 启动时 / 进 /admin 路由前调 ensureChecked() 验当前 token 还活着, 不行就清掉, 让
 * route guard 弹登录页.
 */

const STORAGE_KEY = 'sc.adminToken';
const SERVER_KEY = 'sc.adminAuthServer';
// 同源 localStorage 镜像: sessionStorage 在 iOS standalone PWA「整页跳到独立静态文档」
// (园区大屏布局校准 park-ops/index.html?edit=1) 时可能被清, 导致明明已登录却被踢回登录页。
// 镜像带过期时间 + 服务器绑定, 到点/切服务器/登出即失效, 不放宽安全边界。
const PERSIST_KEY = 'sc.adminToken.persist';

function readPersistedAdmin(): { token: string; expiresAt: string } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const data = JSON.parse(localStorage.getItem(PERSIST_KEY) || 'null') as
      { token?: string; expiresAt?: string; server?: string } | null;
    if (!data?.token || !data.expiresAt || data.server !== getApiBaseURL()) return null;
    const expMs = Date.parse(data.expiresAt);
    if (!Number.isFinite(expMs) || expMs <= Date.now()) return null; // 已过期
    return { token: data.token, expiresAt: data.expiresAt };
  } catch { return null; }
}
function writePersistedAdmin(token: string, expiresAt: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ token, expiresAt, server: getApiBaseURL() }));
  } catch { /* 隐私模式/配额失败忽略 */ }
}
function clearPersistedAdmin(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(PERSIST_KEY); } catch { /* ignore */ }
}

export const useAdminAuthStore = defineStore('admin-auth', () => {
  if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SERVER_KEY) !== getApiBaseURL()) {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY + ':exp');
  }
  // Hydrate: sessionStorage 没有时, 用未过期且同服务器的 localStorage 镜像恢复
  let initialToken: string | null = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
  let initialExp: string | null = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY + ':exp') : null;
  if (!initialToken) {
    const persisted = readPersistedAdmin();
    if (persisted && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEY, persisted.token);
      sessionStorage.setItem(STORAGE_KEY + ':exp', persisted.expiresAt);
      sessionStorage.setItem(SERVER_KEY, getApiBaseURL());
      initialToken = persisted.token;
      initialExp = persisted.expiresAt;
    }
  }
  const token = ref<string | null>(initialToken);
  const expiresAt = ref<string | null>(initialExp);
  const checking = ref(false);
  const checked = ref(false);
  let activeCheck: { token: string; promise: Promise<boolean> } | null = null;
  // 仅持有 client token 的命名管理员: 缓存 /admin/auth/me 的结果并绑定该 client token,
  // 避免每次路由导航都重复发该请求阻塞页面切换; client token 变更/登出/切服务器即失效。
  let clientIdentityCheck: { clientToken: string; result: boolean } | null = null;

  // 启动时同步当前 token 到 http.ts 模块变量
  if (token.value) setAdminToken(token.value);
  onScopeDispose(onServerChange(() => {
    token.value = null;
    expiresAt.value = null;
    checked.value = false;
    clientIdentityCheck = null;
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY + ':exp');
    sessionStorage.removeItem(SERVER_KEY);
    clearPersistedAdmin();
  }));

  const isAuthenticated = computed<boolean>(() => !!token.value);

  async function login(username: string, password: string): Promise<void> {
    const res = await adminLogin(username.trim(), password);
    token.value = res.token;
    expiresAt.value = res.expiresAt;
    sessionStorage.setItem(STORAGE_KEY, res.token);
    sessionStorage.setItem(STORAGE_KEY + ':exp', res.expiresAt);
    sessionStorage.setItem(SERVER_KEY, getApiBaseURL());
    writePersistedAdmin(res.token, res.expiresAt);
    setAdminToken(res.token);
    checked.value = true;
  }

  async function logout(): Promise<void> {
    try { await adminLogout(); } catch { /* 即使后端 logout 失败也要清前端 */ }
    token.value = null;
    expiresAt.value = null;
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY + ':exp');
    clearPersistedAdmin();
    setAdminToken(null);
    checked.value = false;
    clientIdentityCheck = null;
  }

  /** 验证当前 token 是否还有效；只有服务端明确拒绝才清除凭据。 */
  async function ensureChecked(force = false): Promise<boolean> {
    if (!token.value) {
      const ct = getClientToken();
      if (!ct) { checked.value = true; clientIdentityCheck = null; return false; }
      // 已用同一 client token 验证过管理员身份 → 复用结果, 不每次导航都发请求。
      if (!force && clientIdentityCheck?.clientToken === ct) {
        checked.value = true;
        return clientIdentityCheck.result;
      }
      checked.value = true;
      // Named administrators already authenticated through client login must
      // not be asked for the separate shared administrator password.
      try {
        const ok = (await adminMe()).authenticated === true;
        clientIdentityCheck = { clientToken: ct, result: ok };
        return ok;
      } catch { return false; }
    }
    // The store is the persisted source of truth. Startup can hydrate the
    // client and administrator stores in either order; resync the HTTP module
    // before both the fast path and a verification request.
    const expectedToken = token.value;
    setAdminToken(expectedToken);
    if (checked.value && !force) return true;
    if (activeCheck?.token === expectedToken) return activeCheck.promise;
    checking.value = true;
    const promise = (async (): Promise<boolean> => {
      // Setting the concurrently restored client identity deliberately aborts
      // older HTTP reads. Retry that identity-boundary abort once instead of
      // mistaking it for an invalid administrator credential.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (token.value !== expectedToken) return false;
        setAdminToken(expectedToken);
        try {
          await adminMe();
          if (token.value !== expectedToken) return false;
          checked.value = true;
          return true;
        } catch (error) {
          if (token.value !== expectedToken) return false;
          if ((error as Error)?.name === 'AbortError' && attempt === 0) continue;

          // Only an authoritative authentication response may erase a saved
          // credential. Transient network failures and identity-boundary aborts
          // leave it available for a later retry.
          const rejected = error instanceof HttpError && [401, 403].includes(error.status);
          if (!rejected) return false;
          token.value = null;
          expiresAt.value = null;
          sessionStorage.removeItem(STORAGE_KEY);
          sessionStorage.removeItem(STORAGE_KEY + ':exp');
          clearPersistedAdmin();
          setAdminToken(null);
          checked.value = true;
          return false;
        }
      }
      return false;
    })();
    activeCheck = { token: expectedToken, promise };
    try { return await promise; }
    finally {
      if (activeCheck?.promise === promise) {
        activeCheck = null;
        checking.value = false;
      }
    }
  }

  return { token, expiresAt, isAuthenticated, checking, checked, login, logout, ensureChecked };
});
