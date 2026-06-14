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
  /** Sprint-10 新增: ISO 时间戳, 从 deploy/configs/version.json 读取 */
  buildTime?: string;
  /** Sprint-10 新增: CI 注入的 git commit hash (40 位) */
  commit?: string | null;
  /** Sprint-10 新增: CI 注入的 ref (branch/tag) */
  ref?: string | null;
  /** Sprint-10 新增: 运行时 Node.js 版本 (process.version) */
  nodeVersion?: string;
  /** Sprint-10 新增: 平台标识 (windows/linux/darwin) */
  platform?: string;
  /** Sprint-10 新增: 主机标识 (GIADA GK9000 等) */
  host?: string;
  hostMachine?: string;
  uptimeSec?: number;
  testMode?: boolean;
  debug?: boolean;
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

export type AlertLevel = 'info' | 'warning' | 'critical' | 'emergency';
export type AlertStatus = 'active' | 'resolved' | 'ignored';

export interface Alert {
  id: number;
  level: AlertLevel;
  type: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  message: string | null;
  status: AlertStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertSummary {
  active: number;
  byLevel: Record<AlertLevel, number>;
  last24h: number;
  latest: Alert | null;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  apiStatus: 'up' | 'down';
  databaseStatus: 'up' | 'down';
  websocketStatus: 'up' | 'down';
  schedulerStatus: 'up' | 'down';
  deviceOnlineCount: number;
  deviceOfflineCount: number;
  reconnectingCount?: number;
  uptime: number;
  memoryUsagePercent: number;
  cpuUsagePercent: number;
  timestamp: string;
  app: string;
  env: string;
  /** Sprint-01 Windows: 现场主机标识 */
  platform?: string;
  host?: string;
}

export interface SystemResources {
  app: string;
  env: string;
  version: string;
  sprint: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  pid: number;
  mockMode: boolean;
  cpu: { usagePercent: number; loadAvg1m: number; cores: number };
  memory: { usagePercent: number; usedMb: number; totalMb: number };
  disk: { usagePercent: number; usedGb: number; totalGb: number };
  uptime: { osSec: number; processSec: number };
  timestamp: string;
}

export interface LogsSummary {
  operations: number;
  sceneExecutions: number;
  sceneFailures: number;
  deviceOffline: number;
  alerts: {
    active: number;
    last24h: number;
    byLevel: Record<AlertLevel, number>;
  };
  rangeStart: string;
  rangeEnd: string;
}

/* ---------- Sprint-09: 测试中心 ---------- */
export type TestType = 'device' | 'subsystem' | 'scene' | 'network_ping' | 'network_port';

export interface TestLog {
  id: number;
  testType: TestType;
  targetType: string;
  targetId: string;
  command: string | null;
  params: string | null;
  result: string | null;
  success: boolean;
  durationMs: number;
  operator: string;
  createdAt: string;
}

export interface DeviceTestResult {
  success: boolean;
  deviceId: string;
  deviceType: string;
  command: string;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface SubsystemTestResult {
  success: boolean;
  type: string;
  totalDevices: number;
  succeededCount: number;
  failedCount: number;
  devices: DeviceTestResult[];
  durationMs: number;
}

export interface SceneTestResult {
  success: boolean;
  sceneCode: string;
  sceneName: string;
  dryRun: boolean;
  totalActions: number;
  succeededCount: number;
  failedCount: number;
  actionResults: Array<{
    deviceType: string;
    deviceId: string;
    command: string;
    params: Record<string, unknown>;
    success: boolean;
    error?: string;
    durationMs: number;
  }>;
  durationMs: number;
}

export interface PingResult {
  success: boolean;
  ip: string;
  reachable: boolean;
  latencyMs: number | null;
  error?: string;
}

export interface PortResult {
  success: boolean;
  ip: string;
  port: number;
  open: boolean;
  latencyMs: number | null;
  error?: string;
}

export interface TestReport {
  startTime: string;
  endTime: string;
  totalTests: number;
  succeededCount: number;
  failedCount: number;
  avgDurationMs: number;
  byTestType: Record<string, { total: number; succeeded: number; failed: number }>;
  failures: Array<{
    id: number;
    testType: string;
    targetType: string;
    targetId: string;
    error: string;
    createdAt: string;
  }>;
}

/* ---------- Sprint-09: UAT ---------- */
export type UatStatus = 'pending' | 'passed' | 'failed' | 'need_adjustment';
export type UatCategory = 'scene' | 'device' | 'stability' | 'other';

export interface UatRecord {
  id: number;
  itemName: string;
  category: UatCategory;
  testStep: string | null;
  expectedResult: string | null;
  actualResult: string | null;
  status: UatStatus;
  tester: string | null;
  remark: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface UatSummary {
  total: number;
  passed: number;
  failed: number;
  needAdjustment: number;
  pending: number;
  passRate: number;
  byCategory: Record<UatCategory, { total: number; passed: number; failed: number; needAdjustment: number; pending: number }>;
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

export interface AlertCreatedWsEvent {
  type: 'alert_created';
  alertId: number;
  level: AlertLevel;
  alertType: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  message: string | null;
  at: string;
}
export interface AlertResolvedWsEvent {
  type: 'alert_resolved';
  alertId: number;
  sourceType: string;
  sourceId: string | null;
  resolvedBy: string;
  at: string;
}
export interface DeviceOnlineWsEvent {
  type: 'device_online';
  device: string;
  category?: string;
  at: string;
}
export interface DeviceOfflineWsEvent {
  type: 'device_offline';
  device: string;
  category?: string;
  reason?: string;
  at: string;
}
export interface SystemHealthWsEvent {
  type: 'system_health';
  status: 'ok' | 'degraded' | 'down';
  apiStatus: 'up' | 'down';
  databaseStatus: 'up' | 'down';
  websocketStatus: 'up' | 'down';
  schedulerStatus: 'up' | 'down';
  deviceOnlineCount: number;
  deviceOfflineCount: number;
  uptime: number;
  memoryUsagePercent: number;
  cpuUsagePercent: number;
  at: string;
}
export interface ServiceStatusWsEvent {
  type: 'service_status';
  service: 'scheduler' | 'health-check' | 'websocket' | 'engine';
  status: 'up' | 'down' | 'degraded';
  message?: string;
  at: string;
}

export interface TestWsEvent {
  type: 'test_started' | 'test_progress' | 'test_success' | 'test_failed';
  testType?: string;
  targetId?: string;
  command?: string;
  index?: number;
  total?: number;
  current?: string;
  success?: boolean;
  result?: unknown;
  totalDevices?: number;
  succeededCount?: number;
  failedCount?: number;
  dryRun?: boolean;
  at: string;
}

export interface UatUpdatedWsEvent {
  type: 'uat_updated';
  uatId: number;
  status: UatStatus;
  itemName: string;
  tester?: string;
  at: string;
}

/** Sprint-10: 播控通道变化 (HDMI1=LED / HDMI2=投影 当前播啥变了) */
export interface PlaybackChannelView {
  id: number;
  slot: number;
  name: string;
  outputKind: 'led' | 'projector' | 'monitor' | 'audio';
  currentMediaId: number | null;
  currentMediaName: string | null;
  currentMediaKind: 'video' | 'image' | 'audio' | null;
  currentMediaUrl: string | null;
  currentMediaDurationSec: number | null;
  currentPlaylistId: number | null;
  playlistIndex: number;
  startedAt: string | null;
  loopMode: 'once' | 'loop';
  lastHeartbeatAt: string | null;
  alive: boolean;
  updatedAt: string;
}
export interface PlaybackChannelChangedWsEvent {
  type: 'playback_channel_changed';
  slot: number;
  view: PlaybackChannelView;
  at: string;
}

export type WsEvent =
  | { type: 'hello'; message: string; serverTime: string }
  | TestWsEvent
  | UatUpdatedWsEvent
  | { type: 'device_status'; device: string; status: string; state?: Record<string, unknown>; at: string }
  | { type: 'scene'; scene: string; executionId: string; status: 'running' | 'action' | 'completed' | 'failed' | 'stopped'; step?: string; failures?: number; at: string }
  | SceneExecutionWsEvent
  | { type: 'alarm'; source: string; level: 'info' | 'warning' | 'error'; message: string; at: string }
  | AlertCreatedWsEvent
  | AlertResolvedWsEvent
  | DeviceOnlineWsEvent
  | DeviceOfflineWsEvent
  | SystemHealthWsEvent
  | ServiceStatusWsEvent
  | PlaybackChannelChangedWsEvent
  | { type: 'pong'; at: string };

/* ---------- Sprint-10: 硬件清单 ---------- */
export const HARDWARE_CATEGORIES = [
  'dali-gateway',
  'led-driver',
  'dali-converter',
  'dali-dimmer',
  'rtu-tcp-converter',
  'led-controller',
  'led-player',
  'audio-dsp',
  'audio-guide',
  'audio-power',
  'hvac-outdoor',
  'hvac-gateway',
  'power-relay',
  'tablet',
  'switch',
  'router',
  'ups',
  'other',
] as const;
export type HardwareCategory = (typeof HARDWARE_CATEGORIES)[number];

export type HardwareStatus = 'normal' | 'fault' | 'offline' | 'maintenance' | 'retired';

export interface HardwareUnit {
  id: number;
  code: string;
  name: string;
  category: HardwareCategory;
  vendor: string;
  model: string;
  driverKind: string | null;
  serialNo: string | null;
  firmwareVersion: string | null;
  location: string | null;
  floor: string | null;
  ip: string | null;
  macAddress: string | null;
  addressing: string | null;
  channels: string | null;
  status: HardwareStatus;
  enabled: boolean;
  remark: string | null;
  installedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HardwareSummary {
  total: number;
  enabled: number;
  fault: number;
  offline: number;
  byCategory: Record<string, number>;
}
