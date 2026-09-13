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
  /**
   * 欢迎页绑定的媒体 ID. null = 没设 → LED welcome 按钮回落到 V2460 内置 preset.
   * 业主在 MediaPage 点"设为欢迎页"会写入这个字段. 之后 LedController.welcome
   * 走 playback 推这个 media 到 slot=1 loop 播.
   */
  welcomeMediaId: number | null;
  /** 欢迎页嘉宾称谓 (大屏欢迎页实时读取, 空 = 显示默认'各位领导嘉宾') */
  welcomeGuest: string | null;
  /** 欢迎页主标题 (空 = 默认 '热烈欢迎') — 2026-07-28 前端欢迎页编辑器 */
  welcomeTitle: string | null;
  /** 欢迎页底部标语 (空 = 默认 '智慧展厅 · 数字展贸 · 科创未来') */
  welcomeTagline: string | null;
  /** 欢迎页底图媒体 id (空 = 内置'鎏金夜湖'程序化底图) */
  welcomeBgMediaId: number | null;
  /** 只读: 底图直链 (后端由 welcomeBgMediaId 算出; 展示需 absUrl() 拼绝对地址) */
  welcomeBgUrl?: string | null;
}

export type SystemBrandingPatch = Partial<SystemBranding>;

export async function fetchSystemBranding(): Promise<SystemBranding> {
  return api.get<SystemBranding>('/system-branding');
}

export async function saveSystemBranding(patch: SystemBrandingPatch): Promise<SystemBranding> {
  return api.put<SystemBranding>('/system-branding', patch);
}

/** 欢迎页字段专用保存 — 客户端 token 即可 (无需后台登录), 只收欢迎页四字段 */
export type WelcomePatch = Partial<Pick<SystemBranding, 'welcomeGuest' | 'welcomeTitle' | 'welcomeTagline' | 'welcomeBgMediaId'>>;
export async function saveWelcomeConfig(patch: WelcomePatch): Promise<SystemBranding> {
  return api.put<SystemBranding>('/system-branding/welcome', patch);
}
