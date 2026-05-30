import { api } from './http';

/**
 * 后台鉴权 API.
 *
 * 当前是"单密码门禁" — 业主把 admin 密码交给现场维护方就行, 不是多用户体系.
 * (多用户体系走 user.entity / UsersModule, 跟这套并行不冲突.)
 *
 * token 由后端内存维护 8 小时. backend 重启 / 改密码会让全员失效, 需要重登.
 */

export interface LoginResult {
  token: string;
  expiresAt: string; // ISO string
}

export async function adminLogin(password: string): Promise<LoginResult> {
  return api.post<LoginResult>('/admin/auth/login', { password });
}

/** 检查当前 token 还有效. 如果不行 (401), 接口层会 throw HttpError */
export async function adminMe(): Promise<{ authenticated: boolean }> {
  return api.get<{ authenticated: boolean }>('/admin/auth/me');
}

export async function adminLogout(): Promise<void> {
  await api.post<null>('/admin/auth/logout', null);
}

export async function adminChangePassword(oldPassword: string, newPassword: string): Promise<void> {
  await api.post<null>('/admin/auth/change-password', { oldPassword, newPassword });
}
