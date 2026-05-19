import { api } from './http';
import type {
  Device,
  DeviceCategory,
  DeviceRuntimeSnapshot,
  GatewayInfo,
  Paged,
  SystemInfo,
} from '@/types/api';

export const deviceService = {
  list: (params?: { category?: DeviceCategory; pageSize?: number }) =>
    api.get<Paged<Device>>('/devices', { params: { pageSize: 100, ...params } }),
  detail: (id: number) => api.get<Device>(`/devices/${id}`),
  systemInfo: () => api.get<SystemInfo>('/system/info'),
  runtimeDevices: () => api.get<DeviceRuntimeSnapshot[]>('/system/runtime/devices'),
  runtimeGateways: () => api.get<GatewayInfo[]>('/system/runtime/gateways'),
  triggerHealthProbe: () => api.post('/system/runtime/health/probe'),
};
