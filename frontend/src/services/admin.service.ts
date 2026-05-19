import { api } from './http';
import type {
  Alert,
  AlertLevel,
  AlertStatus,
  AlertSummary,
  Device,
  HealthReport,
  LogsSummary,
  OperationLogEntry,
  Paged,
  SceneExecutionRecord,
  SchedulerTask,
  Scene,
  SceneAction,
  SceneSummary,
  SystemResources,
  User,
  UserRole,
} from '@/types/api';

/* ---------- Devices ---------- */
export interface DeviceCreatePayload {
  name: string;
  category: 'lighting' | 'led' | 'audio' | 'hvac' | 'power' | 'system';
  protocol?: string;
  adapter?: string;
  ip?: string;
  address?: string;
  floor?: string;
  zone?: string;
  enabled?: boolean;
  status?: 'online' | 'offline' | 'reconnecting' | 'running' | 'error' | 'disabled';
}

export const adminDeviceService = {
  list: (params?: { keyword?: string; category?: string; pageSize?: number; page?: number }) =>
    api.get<Paged<Device>>('/devices', { params: { pageSize: 200, ...params } }),
  detail: (id: number) => api.get<Device>(`/devices/${id}`),
  create: (body: DeviceCreatePayload) => api.post<Device>('/devices', body),
  update: (id: number, body: Partial<DeviceCreatePayload>) =>
    api.put<Device>(`/devices/${id}`, body),
  remove: (id: number) => api.del<null>(`/devices/${id}`),
};

/* ---------- Scenes & Actions ---------- */
export interface SceneCreatePayload {
  code: string;
  name: string;
  description?: string;
  enabled?: boolean;
}

export interface SceneActionPayload {
  deviceType: string;
  deviceId: string;
  command: string;
  params?: Record<string, unknown>;
  delayMs?: number;
  sortOrder?: number;
  enabled?: boolean;
}

export const adminSceneService = {
  list: () => api.get<Paged<SceneSummary>>('/scenes', { params: { pageSize: 200 } }),
  detail: (id: number) => api.get<Scene>(`/scenes/${id}`),
  create: (body: SceneCreatePayload) => api.post<Scene>('/scenes', body),
  update: (id: number, body: Partial<SceneCreatePayload>) =>
    api.put<Scene>(`/scenes/${id}`, body),
  remove: (id: number) => api.del<null>(`/scenes/${id}`),
  execute: (code: string) => api.post(`/scenes/${code}/execute`),
};

export const adminSceneActionService = {
  listForScene: (sceneId: number) =>
    api.get<SceneAction[]>(`/scenes/${sceneId}/actions`),
  create: (sceneId: number, body: SceneActionPayload) =>
    api.post<SceneAction>(`/scenes/${sceneId}/actions`, body),
  update: (actionId: number, body: Partial<SceneActionPayload>) =>
    api.put<SceneAction>(`/scene-actions/${actionId}`, body),
  remove: (actionId: number) => api.del<null>(`/scene-actions/${actionId}`),
};

/* ---------- Scheduler ---------- */
export interface SchedulerPayload {
  name: string;
  code?: string;
  cron: string;
  sceneCode: string;
  description?: string;
  enabled?: boolean;
}

export const adminSchedulerService = {
  list: (params?: { keyword?: string; enabled?: boolean }) =>
    api.get<Paged<SchedulerTask>>('/scheduler', { params: { pageSize: 200, ...params } }),
  detail: (id: number) => api.get<SchedulerTask>(`/scheduler/${id}`),
  create: (body: SchedulerPayload) => api.post<SchedulerTask>('/scheduler', body),
  update: (id: number, body: Partial<SchedulerPayload>) =>
    api.put<SchedulerTask>(`/scheduler/${id}`, body),
  remove: (id: number) => api.del<null>(`/scheduler/${id}`),
  runNow: (id: number) => api.post<null>(`/scheduler/${id}/run`),
  enable: (id: number) => api.post<SchedulerTask>(`/scheduler/${id}/enable`),
  disable: (id: number) => api.post<SchedulerTask>(`/scheduler/${id}/disable`),
};

/* ---------- Scene Executions ---------- */
export interface ExecutionsQuery {
  sceneCode?: string;
  status?: 'pending' | 'running' | 'success' | 'partial_failed' | 'failed' | 'cancelled';
  triggerType?: 'manual' | 'schedule' | 'system';
  startTime?: string;
  endTime?: string;
  page?: number;
  pageSize?: number;
}

export const adminExecutionService = {
  list: (params: ExecutionsQuery = {}) =>
    api.get<Paged<SceneExecutionRecord>>('/scene-executions', {
      params: { pageSize: 100, ...params },
    }),
  detail: (id: number) => api.get<SceneExecutionRecord>(`/scene-executions/${id}`),
  cancel: (code: string) => api.post(`/scenes/${code}/cancel`),
};

/* ---------- Alerts (Sprint-08) ---------- */
export interface AlertsQuery {
  level?: AlertLevel;
  status?: AlertStatus;
  sourceType?: string;
  type?: string;
  startTime?: string;
  endTime?: string;
  page?: number;
  pageSize?: number;
}

export const adminAlertService = {
  list: (params: AlertsQuery = {}) =>
    api.get<Paged<Alert>>('/alerts', { params: { pageSize: 100, ...params } }),
  summary: () => api.get<AlertSummary>('/alerts/summary'),
  detail: (id: number) => api.get<Alert>(`/alerts/${id}`),
  resolve: (id: number, resolvedBy?: string) =>
    api.post<Alert>(`/alerts/${id}/resolve`, { resolvedBy }),
  ignore: (id: number, resolvedBy?: string) =>
    api.post<Alert>(`/alerts/${id}/ignore`, { resolvedBy }),
};

/* ---------- Monitor (Sprint-08) ---------- */
export const adminMonitorService = {
  health: () => api.get<HealthReport>('/system/health'),
  status: () => api.get<SystemResources>('/system/status'),
  logsSummary: () => api.get<LogsSummary>('/logs/summary'),
};

/* ---------- Users ---------- */
export interface UserCreatePayload {
  username: string;
  password: string;
  role: UserRole;
  enabled?: boolean;
}
export interface UserUpdatePayload {
  username?: string;
  password?: string;
  role?: UserRole;
  enabled?: boolean;
}

export const adminUserService = {
  list: (params?: { keyword?: string; role?: UserRole; enabled?: boolean }) =>
    api.get<Paged<User>>('/users', { params: { pageSize: 200, ...params } }),
  detail: (id: number) => api.get<User>(`/users/${id}`),
  create: (body: UserCreatePayload) => api.post<User>('/users', body),
  update: (id: number, body: UserUpdatePayload) => api.put<User>(`/users/${id}`, body),
  remove: (id: number) => api.del<null>(`/users/${id}`),
};

/* ---------- Logs ---------- */
export interface LogsQuery {
  operator?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: 'success' | 'failure';
  startTime?: string;
  endTime?: string;
  page?: number;
  pageSize?: number;
}

export const adminLogService = {
  list: (params: LogsQuery = {}) =>
    api.get<Paged<OperationLogEntry>>('/logs', { params: { pageSize: 100, ...params } }),
};
