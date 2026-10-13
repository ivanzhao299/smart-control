import { api } from './http';

export interface AppReleaseView {
  platform: string;
  versionCode: number;
  versionName: string;
  downloadUrl: string;
  notes: string | null;
  forceUpdate: boolean;
  minSupportedVersionCode: number;
  enabled: boolean;
  releaseSource: 'bundled' | 'manual';
  artifactCommit: string | null;
  artifactSha256: string | null;
  artifactSize: number | null;
  artifactBuiltAt: string | null;
  updatedAt: string;
}

export interface AppReleaseUpsertDto {
  versionCode: number;
  versionName: string;
  downloadUrl: string;
  notes?: string | null;
  forceUpdate?: boolean;
  minSupportedVersionCode?: number;
  enabled?: boolean;
}

/** 运营字段（config 运营配置员可改）：启停/强制更新/最低兼容/更新说明。不含技术字段。 */
export interface AppReleaseOpsDto {
  notes?: string | null;
  forceUpdate?: boolean;
  minSupportedVersionCode?: number;
  enabled?: boolean;
}

export const appReleaseService = {
  /** 公开 — APP 启动调这个 (前端调试也能调) */
  latest: (platform: 'android' | 'ios') =>
    api.get<AppReleaseView | null>(`/app/${platform}/latest`),

  /** 后台（admin/config/hardware 按 app-release 模块分权）— 列所有平台 */
  list: () => api.get<AppReleaseView[]>('/app/list'),

  detail: (platform: 'android' | 'ios') =>
    api.get<AppReleaseView>(`/app/${platform}`),

  /** admin — 全字段（含版本号/下载地址，bundled 平台仍受后端受控部署保护） */
  upsert: (platform: 'android' | 'ios', dto: AppReleaseUpsertDto) =>
    api.put<AppReleaseView>(`/app/${platform}`, dto),

  /** config — 只改运营开关；后端对非 admin 只落运营字段，技术字段一律忽略 */
  updateOps: (platform: 'android' | 'ios', dto: AppReleaseOpsDto) =>
    api.put<AppReleaseView>(`/app/${platform}`, dto),
};
