import { api } from './http';

/** 权限点（与后端 permission-catalog 对齐）。 */
export interface PermissionPoint {
  code: string;
  name: string;
  group: string;
  /** view 只读 / write 可写 / admin 后台管理。 */
  kind: 'view' | 'write' | 'admin';
  /** front 前台 PWA / back 后台。 */
  scope: 'front' | 'back' | 'both';
  sort: number;
  hint?: string;
}

export interface PermissionGroup {
  code: string;
  name: string;
  sort: number;
}

/** 内置角色及其默认权限集（catalog 下发，用于"恢复默认"与默认/人工增减标色）。 */
export interface CatalogRole {
  code: string;
  name: string;
  lockedFull: boolean;
  defaultPermissions: string[];
}

export interface PermissionCatalog {
  groups: PermissionGroup[];
  permissions: PermissionPoint[];
  roles: CatalogRole[];
}

/** 角色列表行（含聚合统计）。 */
export interface RoleListRow {
  code: string;
  name: string;
  description?: string | null;
  isBuiltin: boolean;
  isLocked: boolean;
  canFront: boolean;
  canBack: boolean;
  enabled: boolean;
  sortOrder: number;
  userCount?: number;
  permissionCount?: number;
}

/** 角色详情（含权限 code 列表）。 */
export interface RoleDetail extends RoleListRow {
  permissions: string[];
}

export interface RoleCreatePayload {
  code: string;
  name: string;
  description?: string | null;
  canFront?: boolean;
  canBack?: boolean;
  enabled?: boolean;
  permissions?: string[];
}

export type RoleUpdatePayload = Partial<Omit<RoleCreatePayload, 'code' | 'permissions'>>;

export interface RoleCopyPayload {
  code: string;
  name: string;
  description?: string | null;
  canFront?: boolean;
  canBack?: boolean;
  permissions?: string[];
}

export const roleService = {
  catalog: () => api.get<PermissionCatalog>('/roles/permissions'),
  list: () => api.get<RoleListRow[]>('/roles'),
  detail: (code: string) => api.get<RoleDetail>(`/roles/${encodeURIComponent(code)}`),
  create: (body: RoleCreatePayload) => api.post<RoleDetail>('/roles', body),
  update: (code: string, body: RoleUpdatePayload) =>
    api.put<RoleDetail>(`/roles/${encodeURIComponent(code)}`, body),
  remove: (code: string) => api.del<null>(`/roles/${encodeURIComponent(code)}`),
  replacePermissions: (code: string, permissions: string[]) =>
    api.put<{ code: string; permissions: string[] }>(
      `/roles/${encodeURIComponent(code)}/permissions`,
      { permissions },
    ),
  copy: (code: string, body: RoleCopyPayload) =>
    api.post<RoleDetail>(`/roles/${encodeURIComponent(code)}/copy`, body),
};
