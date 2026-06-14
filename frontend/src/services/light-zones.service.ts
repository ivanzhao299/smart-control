import { api } from './http';
import { queryOnce, invalidate } from './query.service';

/**
 * 后端 /api/light-zones CRUD 客户端.
 *
 * 跟 lighting.service.ts 的关系:
 *   - light-zones.service: 拉 zone 元数据 (名字/楼层/网关/group), 后台编辑
 *   - lighting.service:    给 zone id 下发命令 (on/off/brightness)
 */
export interface LightZoneView {
  id: number;
  code: string;
  name: string;
  floor: string;
  gatewayCode: string;
  daliGroup: number;
  sortOrder: number;
  icon: string | null;
  description: string | null;
  enabled: boolean;
  gatewaySlaveId: number | null;
  gatewayDisplayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface LightZoneUpsertDto {
  code: string;
  name: string;
  floor: string;
  gatewayCode: string;
  daliGroup: number;
  sortOrder?: number;
  icon?: string | null;
  description?: string | null;
  enabled?: boolean;
}

/** 后台 "测试此分区" 返回 — 把全链路诊断信息给操作员 */
export interface LightZoneTestResult {
  zone: { id: number; code: string; name: string };
  gateway: { code: string; displayName: string; slaveId: number | null };
  daliGroup: number;
  routing: { ok: boolean; error?: string };
  dispatch: null | {
    on:  { ok: boolean; error: string | null; durationMs: number; mock: boolean };
    off: { ok: boolean; error: string | null; durationMs: number; mock: boolean };
  };
}

const LZ = 'light-zones:list';

export const lightZonesService = {
  // SWR 缓存: 命中立返 + 后台 revalidate; 写操作后 invalidate(LZ) 保证下次拉到最新
  list: (includeDisabled = false) =>
    queryOnce(`${LZ}:${includeDisabled}`, () =>
      api.get<LightZoneView[]>('/light-zones', {
        params: includeDisabled ? { includeDisabled: '1' } : {},
      })),
  detail: (id: number) => api.get<LightZoneView>(`/light-zones/${id}`),
  create: (dto: LightZoneUpsertDto) =>
    api.post<LightZoneView>('/light-zones', dto).then((r) => { invalidate(LZ); return r; }),
  update: (id: number, dto: Partial<LightZoneUpsertDto>) =>
    api.put<LightZoneView>(`/light-zones/${id}`, dto).then((r) => { invalidate(LZ); return r; }),
  remove: (id: number) =>
    api.del<null>(`/light-zones/${id}`).then((r) => { invalidate(LZ); return r; }),
  test: (id: number) => api.post<LightZoneTestResult>(`/light-zones/${id}/test`),
};
