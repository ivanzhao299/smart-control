import { api } from './http';
import { queryOnce, invalidate } from './query.service';

/**
 * 后端 /api/light-zones CRUD 客户端.
 *
 * 跟 lighting.service.ts 的关系:
 *   - light-zones.service: 拉 zone 元数据 (名字/楼层/含哪些组), 后台编辑 + 编组
 *   - lighting.service:    给 zone id 下发命令 (on/off/brightness), 后端扇出到各组
 *
 * 2026-07-16 模型改造: 分区不再"就是一个 DALI 组"。现场 7 分区 / 11 组, 一个分区可含
 * 多组、且可跨两台网关, 所以 zone 下挂 groups[], 组号必须跟 gatewayCode 一起看
 * (两台网关的"组3"是完全不同的灯)。
 */

/** 一个 DALI 组 = (网关, 组号); 这是灯光的最小可控单位 */
export interface LightGroupView {
  id: number;
  gatewayCode: string;
  daliGroup: number;
  /** 归属分区; null = 尚未分配 */
  zoneCode: string | null;
  /** 实测灯具短地址, 没扫过是空数组 */
  shorts: number[];
  sortOrder: number;
  enabled: boolean;
  slaveId: number | null;
  gatewayDisplayName: string;
}

export interface LightZoneView {
  id: number;
  code: string;
  name: string;
  floor: string;
  sortOrder: number;
  icon: string | null;
  description: string | null;
  enabled: boolean;
  /** 可以是空数组 —— 新建的空分区照常显示, 否则没法往里放组 */
  groups: LightGroupView[];
  createdAt: string;
  updatedAt: string;
}

export interface LightZoneUpsertDto {
  code: string;
  name: string;
  floor: string;
  sortOrder?: number;
  icon?: string | null;
  description?: string | null;
  enabled?: boolean;
}

/** 后台 "测试此分区" 返回 — 逐组点灯, 让操作员核对分组是否正确 */
export interface LightZoneTestResult {
  zone: { id: number; code: string; name: string };
  routing: { ok: boolean; error?: string };
  total?: number;
  okCount?: number;
  dispatch: null | Array<{
    gateway: { code: string; slaveId: number };
    daliGroup: number;
    on:  { ok: boolean; error: string | null; durationMs: number; mock: boolean };
    off: { ok: boolean; error: string | null; durationMs: number; mock: boolean };
  }>;
}

const LZ = 'light-zones:list';
const LG = 'light-zones:groups';

/** 分区和组是同一份数据的两个视图, 改任一边都要把两个缓存都失效, 否则编组后列表不动 */
function invalidateAll(): void {
  invalidate(LZ);
  invalidate(LG);
}

export const lightZonesService = {
  // SWR 缓存: 命中立返 + 后台 revalidate; 写操作后 invalidate 保证下次拉到最新
  list: (includeDisabled = false) =>
    queryOnce(`${LZ}:${includeDisabled}`, () =>
      api.get<LightZoneView[]>('/light-zones', {
        params: includeDisabled ? { includeDisabled: '1' } : {},
      })),
  groups: () => queryOnce(LG, () => api.get<LightGroupView[]>('/light-zones/groups')),
  detail: (id: number) => api.get<LightZoneView>(`/light-zones/${id}`),
  create: (dto: LightZoneUpsertDto) =>
    api.post<LightZoneView>('/light-zones', dto).then((r) => { invalidateAll(); return r; }),
  update: (id: number, dto: Partial<LightZoneUpsertDto>) =>
    api.put<LightZoneView>(`/light-zones/${id}`, dto).then((r) => { invalidateAll(); return r; }),
  remove: (id: number) =>
    api.del<null>(`/light-zones/${id}`).then((r) => { invalidateAll(); return r; }),
  /**
   * 拖拽排序 — 传全量有序 id。
   *
   * 排序存后端而不是 localStorage: 现场有主控机 + 平板 + 手机, 只存前端的话每台
   * 设备顺序都不一样, 等于没排。sortOrder 字段本来就在实体上、list 也早按它排,
   * 只差这个写入口。
   */
  reorderZones: (ids: number[]) =>
    api.put<{ count: number }>('/light-zones/reorder/zones', { ids })
      .then((r) => { invalidateAll(); return r; }),
  reorderGroups: (ids: number[]) =>
    api.put<{ count: number }>('/light-zones/reorder/groups', { ids })
      .then((r) => { invalidateAll(); return r; }),
  /** zoneCode=null 表示把这些组从分区里移出 */
  assignGroups: (groupIds: number[], zoneCode: string | null) =>
    api.post<{ count: number; zoneCode: string | null }>('/light-zones/groups/assign', { groupIds, zoneCode })
      .then((r) => { invalidateAll(); return r; }),
  setGroupShorts: (groupId: number, shorts: number[]) =>
    api.put<LightGroupView>(`/light-zones/groups/${groupId}/shorts`, { shorts })
      .then((r) => { invalidateAll(); return r; }),
  test: (id: number) => api.post<LightZoneTestResult>(`/light-zones/${id}/test`),
};
