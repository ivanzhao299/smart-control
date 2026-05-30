import { api } from './http';

/**
 * 系统品牌 — 控制系统自身的 logo + 名称 (区别于 brand.service 那个硬件厂商目录).
 *
 * GET /api/system-branding 公开, 所有 layout 启动时拉一次, 写到 Pinia store 缓存.
 * PUT /api/system-branding 后台才用, 改完前台不用刷新, 通过 store reactive 立即生效.
 */

export interface SystemBranding {
  systemName: string;
  systemSubtitle: string | null;
  logoText: string;
  logoUrl: string | null;
  browserTitle: string | null;
  copyright: string | null;
}

export type SystemBrandingPatch = Partial<SystemBranding>;

export async function fetchSystemBranding(): Promise<SystemBranding> {
  const resp = await api.get<{ data: SystemBranding }>('/system-branding');
  return resp.data;
}

export async function saveSystemBranding(patch: SystemBrandingPatch): Promise<SystemBranding> {
  const resp = await api.put<{ data: SystemBranding }>('/system-branding', patch);
  return resp.data;
}
