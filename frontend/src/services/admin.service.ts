import { api } from './http';
import type {
  Alert,
  AlertLevel,
  AlertStatus,
  AlertSummary,
  Device,
  DeviceTestResult,
  HealthReport,
  LogsSummary,
  OperationLogEntry,
  Paged,
  PingResult,
  PortResult,
  SceneExecutionRecord,
  SceneTestResult,
  SchedulerTask,
  Scene,
  SceneAction,
  SceneSummary,
  SubsystemTestResult,
  SystemResources,
  TestLog,
  TestReport,
  UatCategory,
  UatRecord,
  UatStatus,
  UatSummary,
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
  resolveBySource: (sourceType: string, sourceId: string | null, resolvedBy?: string) =>
    api.post<{ count: number }>('/alerts/resolve-by-source', { sourceType, sourceId, resolvedBy }),
};

/* ---------- Monitor (Sprint-08) ---------- */
export const adminMonitorService = {
  health: () => api.get<HealthReport>('/system/health'),
  status: () => api.get<SystemResources>('/system/status'),
  logsSummary: () => api.get<LogsSummary>('/logs/summary'),
};

/* ---------- Sprint-09: Test Center ---------- */
export const adminTestService = {
  device: (deviceId: string, command: string, params: Record<string, unknown> = {}) =>
    api.post<DeviceTestResult>(`/test/device/${deviceId}`, { command, params }),
  subsystem: (type: string, command?: string, params: Record<string, unknown> = {}) =>
    api.post<SubsystemTestResult>(`/test/subsystem/${type}`, { command, params }),
  scene: (sceneCode: string, dryRun = false) =>
    api.post<SceneTestResult>(`/test/scene/${sceneCode}`, { dryRun }),
  ping: (ip: string, timeoutMs = 2000) =>
    api.post<PingResult>('/test/network/ping', { ip, timeoutMs }),
  port: (ip: string, port: number, timeoutMs = 2000) =>
    api.post<PortResult>('/test/network/port', { ip, port, timeoutMs }),
  logs: (params: { testType?: string; targetType?: string; targetId?: string; success?: boolean; page?: number; pageSize?: number } = {}) =>
    api.get<Paged<TestLog>>('/test/logs', { params: { pageSize: 100, ...params } }),
  report: (body: { startTime?: string; endTime?: string; testType?: string } = {}) =>
    api.post<TestReport>('/test/report', body),
  checklist: () => api.get<unknown>('/test/checklist'),
};

/* ---------- Sprint-09: UAT ---------- */
export interface UatCreatePayload {
  itemName: string;
  category: UatCategory;
  testStep?: string;
  expectedResult?: string;
  actualResult?: string;
  status?: UatStatus;
  tester?: string;
  remark?: string;
  sortOrder?: number;
}

export const adminUatService = {
  list: (params: { category?: UatCategory; status?: UatStatus; keyword?: string } = {}) =>
    api.get<Paged<UatRecord>>('/uat', { params: { pageSize: 500, ...params } }),
  summary: () => api.get<UatSummary>('/uat/summary'),
  detail: (id: number) => api.get<UatRecord>(`/uat/${id}`),
  create: (body: UatCreatePayload) => api.post<UatRecord>('/uat', body),
  update: (id: number, body: Partial<UatCreatePayload>) => api.put<UatRecord>(`/uat/${id}`, body),
  remove: (id: number) => api.del<null>(`/uat/${id}`),
  pass: (id: number, body: { tester?: string; actualResult?: string; remark?: string } = {}) =>
    api.post<UatRecord>(`/uat/${id}/pass`, body),
  fail: (id: number, body: { tester?: string; actualResult?: string; remark?: string } = {}) =>
    api.post<UatRecord>(`/uat/${id}/fail`, body),
  needAdjustment: (id: number, body: { tester?: string; actualResult?: string; remark?: string } = {}) =>
    api.post<UatRecord>(`/uat/${id}/need-adjustment`, body),
  reset: (id: number, body: { tester?: string } = {}) =>
    api.post<UatRecord>(`/uat/${id}/reset`, body),
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

/* ---------- Hardware Inventory (Sprint-10) ---------- */
import type { HardwareUnit, HardwareCategory, HardwareStatus, HardwareSummary } from '@/types/api';

export interface HardwareCreatePayload {
  code: string;
  name: string;
  category: HardwareCategory;
  vendor: string;
  model: string;
  driverKind?: string;
  serialNo?: string;
  firmwareVersion?: string;
  location?: string;
  floor?: string;
  ip?: string;
  macAddress?: string;
  addressing?: string;
  channels?: string;
  status?: HardwareStatus;
  enabled?: boolean;
  remark?: string;
  installedAt?: string;
}

export type HardwareUpdatePayload = Partial<HardwareCreatePayload>;

export const adminHardwareService = {
  list: (params?: { category?: HardwareCategory; floor?: string; status?: HardwareStatus; keyword?: string; enabled?: boolean }) =>
    api.get<Paged<HardwareUnit>>('/hardware', { params: { pageSize: 200, ...params } }),
  summary: () => api.get<HardwareSummary>('/hardware/summary'),
  detail: (id: number) => api.get<HardwareUnit>(`/hardware/${id}`),
  create: (body: HardwareCreatePayload) => api.post<HardwareUnit>('/hardware', body),
  update: (id: number, body: HardwareUpdatePayload) => api.put<HardwareUnit>(`/hardware/${id}`, body),
  remove: (id: number) => api.del<null>(`/hardware/${id}`),
};

/* ---------- System Backup / Restore (Sprint-10) ---------- */
export interface BackupItem {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}
export interface BackupCreateResult {
  snapshot: string;
  sizeBytes: number;
  createdAt: string;
  sourceDbPath: string;
}
export interface RestoreSimulationResult {
  simulated: true;
  selected: string | null;
  wouldRestoreFrom: string | null;
  wouldRestoreTo: string;
  available: BackupItem[];
  note: string;
}

export const adminBackupService = {
  list: () => api.get<BackupItem[]>('/system/backups'),
  create: () => api.post<BackupCreateResult>('/system/backup'),
  restore: (snapshot?: string) =>
    api.post<RestoreSimulationResult>('/system/restore', { snapshot }),
};
