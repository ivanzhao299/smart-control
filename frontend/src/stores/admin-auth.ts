import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { adminLogin, adminLogout, adminMe } from '@/services/admin-auth.service';
import { setAdminToken } from '@/services/http';

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

export const useAdminAuthStore = defineStore('admin-auth', () => {
  const token = ref<string | null>(typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null);
  const expiresAt = ref<string | null>(typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY + ':exp') : null);
  const checking = ref(false);
  const checked = ref(false);

  // 启动时同步当前 token 到 http.ts 模块变量
  if (token.value) setAdminToken(token.value);

  const isAuthenticated = computed<boolean>(() => !!token.value);

  async function login(password: string): Promise<void> {
    const res = await adminLogin(password);
    token.value = res.token;
    expiresAt.value = res.expiresAt;
    sessionStorage.setItem(STORAGE_KEY, res.token);
    sessionStorage.setItem(STORAGE_KEY + ':exp', res.expiresAt);
    setAdminToken(res.token);
    checked.value = true;
  }

  async function logout(): Promise<void> {
    try { await adminLogout(); } catch { /* 即使后端 logout 失败也要清前端 */ }
    token.value = null;
    expiresAt.value = null;
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY + ':exp');
    setAdminToken(null);
    checked.value = false;
  }

  /** 验证当前 token 是否还有效. 没 token / 401 都清掉. 返回是否登录. */
  async function ensureChecked(force = false): Promise<boolean> {
    if (!token.value) {
      checked.value = true;
      return false;
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
      setAdminToken(null);
      checked.value = true;
      return false;
    } finally {
      checking.value = false;
    }
  }

  return { token, expiresAt, isAuthenticated, checking, checked, login, logout, ensureChecked };
});
