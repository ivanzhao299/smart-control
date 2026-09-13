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

export const appReleaseService = {
  /** 公开 — APP 启动调这个 (前端调试也能调) */
  latest: (platform: 'android' | 'ios') =>
    api.get<AppReleaseView | null>(`/app/${platform}/latest`),

  /** Admin — 列所有平台 */
  list: () => api.get<AppReleaseView[]>('/app/list'),

  detail: (platform: 'android' | 'ios') =>
    api.get<AppReleaseView>(`/app/${platform}`),

  upsert: (platform: 'android' | 'ios', dto: AppReleaseUpsertDto) =>
    api.put<AppReleaseView>(`/app/${platform}`, dto),
};
