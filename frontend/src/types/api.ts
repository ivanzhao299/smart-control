export interface ApiOk<T> {
  success: true;
  message: string;
  data: T;
}

export interface ApiErr {
  success: false;
  message: string;
}

export type DeviceCategory = 'lighting' | 'led' | 'audio' | 'hvac' | 'power' | 'system';
export type DeviceStatus = 'online' | 'offline' | 'reconnecting' | 'running' | 'error' | 'disabled';

export interface Device {
  id: number;
  name: string;
  category: DeviceCategory;
  protocol: string;
  adapter: string;
  ip: string | null;
  address: string | null;
  floor: string | null;
  zone: string | null;
  enabled: boolean;
  status: DeviceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Paged<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SceneSummary {
  id: number;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
}

export interface Scene extends SceneSummary {
  actions: SceneAction[];
}

export interface SceneAction {
  id: number;
  sceneId: number;
  deviceType: string;
  deviceId: string;
  command: string;
  params: string;
  delayMs: number;
  sortOrder: number;
  enabled: boolean;
}

export interface SceneExecution {
  executionId: string;
  sceneId: number;
  sceneCode: string;
  sceneName: string;
  operator: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  startedAt: string;
  finishedAt?: string;
  totalActions: number;
  succeeded: number;
  failed: number;
  failures: Array<{ deviceType: string; deviceId: string; command: string; error: string }>;
}

export interface AdapterResult<T = unknown> {
  ok: boolean;
  deviceId: string;
  command: string;
  data?: T;
  error?: string;
  mock: boolean;
  durationMs: number;
}

export interface GatewayInfo {
  gateway: string;
  state: 'online' | 'offline' | 'reconnecting' | 'error';
  endpoint: string;
  lastError?: string;
  attempts: number;
  updatedAt: string;
}

export interface DeviceRuntimeSnapshot {
  device: string;
  status: DeviceStatus;
  state: Record<string, unknown>;
  updatedAt: string;
}

export interface SystemInfo {
  app: string;
  env: string;
  version: string;
  sprint: string;
  mockMode: boolean;
  mockLatencyMs: number;
  websocketPath: string;
  apiPrefix: string;
}

export type UserRole = 'admin' | 'operator' | 'viewer';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulerTask {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  cron: string;
  sceneCode: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunStatus: string | null;
  lastRunMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'partial_failed'
  | 'failed'
  | 'cancelled';

export type TriggerType = 'manual' | 'schedule' | 'system';

export interface SceneExecutionRecord {
  id: number;
  executionId: string;
  sceneCode: string;
  sceneName: string;
  triggerType: TriggerType;
  triggerSource: string;
  status: ExecutionStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  totalActions: number;
  successCount: number;
  failedCount: number;
  resultSummary: string | null;
  createdAt: string;
}

export interface OperationLogEntry {
  id: number;
  operator: string;
  terminal: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  result: 'success' | 'failure';
  message: string | null;
  createdAt: string;
}

export type SceneExecutionEventName =
  | 'scene_execution_started'
  | 'scene_execution_progress'
  | 'scene_execution_success'
  | 'scene_execution_partial_failed'
  | 'scene_execution_failed'
  | 'scene_execution_cancelled';

export interface SceneExecutionWsEvent {
  type: SceneExecutionEventName;
  executionId: string;
  sceneCode: string;
  sceneName: string;
  triggerType: TriggerType;
  triggerSource: string;
  status: ExecutionStatus;
  totalActions: number;
  successCount: number;
  failedCount: number;
  durationMs?: number;
  step?: string;
  at: string;
}

export type WsEvent =
  | { type: 'hello'; message: string; serverTime: string }
  | { type: 'device_status'; device: string; status: string; state?: Record<string, unknown>; at: string }
  | { type: 'scene'; scene: string; executionId: string; status: 'running' | 'action' | 'completed' | 'failed' | 'stopped'; step?: string; failures?: number; at: string }
  | SceneExecutionWsEvent
  | { type: 'alarm'; source: string; level: 'info' | 'warning' | 'error'; message: string; at: string }
  | { type: 'pong'; at: string };
