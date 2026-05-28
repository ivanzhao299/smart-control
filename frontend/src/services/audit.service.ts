import { api } from './http';

export type AuditAction = 'create' | 'update' | 'delete' | 'rollback';

export interface AuditEntry {
  id: number;
  entityType: string;
  entityId: string;
  action: AuditAction;
  operator: string;
  snapshotBefore: unknown | null;
  snapshotAfter: unknown | null;
  remark: string | null;
  createdAt: string;
}

export interface AuditListParams {
  entityType?: string;
  entityId?: string;
  action?: AuditAction;
  operator?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditList {
  list: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export const auditService = {
  list: (params?: AuditListParams) => api.get<AuditList>('/audit-log', { params }),
  detail: (id: number) => api.get<AuditEntry>(`/audit-log/${id}`),
  rollback: (id: number) => api.post<unknown>(`/audit-log/${id}/rollback`),
};
