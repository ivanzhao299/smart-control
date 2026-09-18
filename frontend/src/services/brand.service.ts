import { api } from './http';

export interface Brand {
  id: number;
  name: string;
  displayName: string | null;
  logoUrl: string | null;
  country: string | null;
  website: string | null;
  salesContact: string | null;
  techContact: string | null;
  remark: string | null;
  enabled: boolean;
  configRevision: number;
  hardwareCount: number;
  driverCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrandUpsertPayload {
  name: string;
  displayName?: string | null;
  logoUrl?: string | null;
  country?: string | null;
  website?: string | null;
  salesContact?: string | null;
  techContact?: string | null;
  remark?: string | null;
  enabled?: boolean;
}

export const brandService = {
  list: () => api.get<Brand[]>('/brands'),
  detail: (id: number) => api.get<Brand>(`/brands/${id}`),
  create: (body: BrandUpsertPayload) => api.post<Brand>('/brands', body),
  update: (id: number, body: Partial<BrandUpsertPayload> & { expectedRevision: number }) => api.put<Brand>(`/brands/editor/${id}`, body),
  remove: (id: number, expectedRevision: number) => api.del<null>(`/brands/editor/${id}?expectedRevision=${expectedRevision}`),
};
