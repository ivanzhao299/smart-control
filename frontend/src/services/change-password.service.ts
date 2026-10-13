import { api } from './http';

/**
 * 自助修改密码 API。
 *
 * 后台（admin/hardware/config）与前台 PWA（operator/viewer）共用同一个端点，
 * 只能修改"当前登录账户自己"的密码，必须先通过旧密码校验。
 * 改密成功后，旧令牌会因密码指纹变化而自动失效，需要重新登录。
 */
export interface ChangePasswordPayload {
  oldPassword: string;
  newPassword: string;
}

export async function changeOwnPassword(payload: ChangePasswordPayload): Promise<void> {
  await api.post<null>('/client-auth/change-password', payload);
}
