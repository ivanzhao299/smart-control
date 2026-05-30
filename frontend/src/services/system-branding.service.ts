import { api } from './http';

/**
 * 系统品牌 — 控制系统自身的 logo + 名称 (区别于 brand.service 那个硬件厂商目录).
 *
 * GET /api/system-branding 公开, 所有 layout 启动时拉一次, 写到 Pinia store 缓存.
 * PUT /api/system-branding 后台才用, 改完前台不用刷新, 通过 store reactive 立即生效.
 *
 * api.get/put 已经 unwrap 了 ApiOk<T> 外壳, 直接返 data 字段. 不要再 `.data` 一次.
 */

export interface SystemBranding {
  systemName: string;
  systemSubtitle: string | null;
  logoText: string;
  /**
   * Logo 可以是 http(s) URL 或 data URL (base64 内嵌, e.g. data:image/webp;base64,...).
   * 推荐 data URL — 用户上传图片后, 前端 canvas 压缩到 256x256 + WebP 编码内嵌,
   * 不依赖文件系统 / nginx 静态服务, 一条 DB 记录管全套.
   */
  logoUrl: string | null;
  browserTitle: string | null;
  copyright: string | null;
}

export type SystemBrandingPatch = Partial<SystemBranding>;

export async function fetchSystemBranding(): Promise<SystemBranding> {
  return api.get<SystemBranding>('/system-branding');
}

export async function saveSystemBranding(patch: SystemBrandingPatch): Promise<SystemBranding> {
  return api.put<SystemBranding>('/system-branding', patch);
}
