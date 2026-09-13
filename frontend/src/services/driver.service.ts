import { api } from './http';

export interface ParamFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'enum';
  label: string;
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
}

export interface DriverTemplate {
  kind: string;
  displayName: string;
  vendor: string;
  category: string;
  protocol: string;
  capabilities: string[];
  defaultAddressing: Record<string, unknown> | null;
  paramSchema: Record<string, ParamFieldSchema> | null;
  remark: string | null;
  builtin: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DriverCreatePayload {
  kind: string;
  displayName: string;
  vendor: string;
  category: string;
  protocol: string;
  capabilities: string[];
  defaultAddressing?: Record<string, unknown>;
  paramSchema?: Record<string, ParamFieldSchema>;
  remark?: string;
}

export const driverService = {
  list: () => api.get<DriverTemplate[]>('/drivers'),
  detail: (kind: string) => api.get<DriverTemplate>(`/drivers/${kind}`),
  create: (body: DriverCreatePayload) => api.post<DriverTemplate>('/drivers', body),
  remove: (kind: string) => api.del<null>(`/drivers/${kind}`),
};
