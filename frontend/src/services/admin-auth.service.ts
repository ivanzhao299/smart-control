import { api } from './http';

/**
 * 后台鉴权 API.
 *
 * 后台使用 users 中的个人管理员账户，令牌由持久化签名密钥签发，有效期 8 小时。
 */

export interface LoginResult {
  token: string;
  expiresAt: string; // ISO string
}

export async function adminLogin(username: string, password: string): Promise<LoginResult> {
  return api.post<LoginResult>('/admin/auth/login', { username, password });
}

/** 检查当前 token 还有效. 如果不行 (401), 接口层会 throw HttpError */
export async function adminMe(): Promise<{ authenticated: boolean }> {
  // 启动路由守卫会调用此探测；后台暂时不可达时不能把 PWA 启动画面
  // 卡到 10 秒以上，否则用户看到的是“系统页面未能启动”而不是登录页。
  return api.get<{ authenticated: boolean }>('/admin/auth/me', { timeout: 2500 });
}

export async function adminLogout(): Promise<void> {
  await api.post<null>('/admin/auth/logout', null);
}
