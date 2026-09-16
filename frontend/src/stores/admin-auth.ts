import { defineStore } from 'pinia';
import { computed, ref, onScopeDispose } from 'vue';
import { onServerChange } from '@/services/identity-boundary';
import { adminLogin, adminLogout, adminMe } from '@/services/admin-auth.service';
import { setAdminToken, getApiBaseURL, getClientToken } from '@/services/http';

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

  // 启动时同步当前 token 到 http.ts 模块变量
  if (token.value) setAdminToken(token.value);
  onScopeDispose(onServerChange(() => {
    token.value = null;
    expiresAt.value = null;
    checked.value = false;
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
  }

  /** 验证当前 token 是否还有效. 没 token / 401 都清掉. 返回是否登录. */
  async function ensureChecked(force = false): Promise<boolean> {
    if (!token.value) {
      checked.value = true;
      // Named administrators already authenticated through client login must
      // not be asked for the separate shared administrator password.
      if (!getClientToken()) return false;
      try { return (await adminMe()).authenticated === true; }
      catch { return false; }
    }
    if (checked.value && !force) return true;
    checking.value = true;
    try {
      await adminMe();
      checked.value = true;
      return true;
    } catch {
      // 401 / 网络都视为失效, 清状态
      token.value = null;
      expiresAt.value = null;
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY + ':exp');
      clearPersistedAdmin();
      setAdminToken(null);
      checked.value = true;
      return false;
    } finally {
      checking.value = false;
    }
  }

  return { token, expiresAt, isAuthenticated, checking, checked, login, logout, ensureChecked };
});
