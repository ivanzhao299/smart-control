import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export type ControlEventType = 'device_status' | 'scene' | 'alarm' | 'scene_execution';

export interface DeviceStatusEvent {
  type: 'device_status';
  device: string;
  status: string;
  state?: Record<string, unknown>;
  at: string;
}

/** 兼容 Sprint-03 平板订阅的事件 */
export interface SceneEvent {
  type: 'scene';
  scene: string;
  executionId: string;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'action';
  step?: string;
  failures?: number;
  at: string;
}

export interface AlarmEvent {
  type: 'alarm';
  source: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  at: string;
}

/** Sprint-07: 场景执行生命周期细粒度事件 */
export type SceneExecutionEventName =
  | 'scene_execution_started'
  | 'scene_execution_progress'
  | 'scene_execution_success'
  | 'scene_execution_partial_failed'
  | 'scene_execution_failed'
  | 'scene_execution_cancelled';

export interface SceneExecutionEvent {
  type: SceneExecutionEventName;
  executionId: string;
  sceneCode: string;
  sceneName: string;
  triggerType: 'manual' | 'schedule' | 'system';
  triggerSource: string;
  status: 'pending' | 'running' | 'success' | 'partial_failed' | 'failed' | 'cancelled';
  totalActions: number;
  successCount: number;
  failedCount: number;
  durationMs?: number;
  step?: string;
  at: string;
}

/** Sprint-08: 设备在线/下线、报警生命周期、健康状态、服务状态 */
export interface DeviceOnlineEvent {
  type: 'device_online';
  device: string;
  category?: string;
  at: string;
}

export interface DeviceOfflineEvent {
  type: 'device_offline';
  device: string;
  category?: string;
  reason?: string;
  at: string;
}

export interface AlertCreatedEvent {
  type: 'alert_created';
  alertId: number;
  level: 'info' | 'warning' | 'critical' | 'emergency';
  alertType: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  message: string | null;
  at: string;
}

export interface AlertResolvedEvent {
  type: 'alert_resolved';
  alertId: number;
  sourceType: string;
  sourceId: string | null;
  resolvedBy: string;
  at: string;
}

export interface SystemHealthEvent {
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

export interface ServiceStatusEvent {
  type: 'service_status';
  service: 'scheduler' | 'health-check' | 'websocket' | 'engine';
  status: 'up' | 'down' | 'degraded';
  message?: string;
  at: string;
}

/** Sprint-09: 测试中心事件 */
export type TestEventName =
  | 'test_started'
  | 'test_progress'
  | 'test_success'
  | 'test_failed';

export interface TestEvent {
  type: TestEventName;
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

/** Sprint-09: UAT 更新事件 */
export interface UatUpdatedEvent {
  type: 'uat_updated';
  uatId: number;
  status: 'pending' | 'passed' | 'failed' | 'need_adjustment';
  itemName: string;
  tester?: string;
  at: string;
}

/** Sprint-10: 播控通道变化 — slot=1/2 当前播啥变了, PlayerPage / MediaPage / LedPage 都订阅 */
export interface PlaybackChannelChangedEvent {
  type: 'playback_channel_changed';
  slot: number;
  // Invalidation only: each recipient fetches an authorized state over HTTP.
  at: string;
}

/** 智能断路器读数 (后台预采集后经 WS 推送, 电源页据此实时刷新, 免轮询) */
export interface PowerReadingEvent {
  type: 'power_reading';
  circuitId: number;
  code: string;
  reading: {
    on: boolean;
    voltage: number;
    current: number;
    power: number;
    powerFactor: number;
    energy: number;
    lastReadAt: string;
  };
  at: string;
}

/** 臻识车牌识别: 一次过车识别结果 (PWA 道闸页 / 大屏人车管理实时刷新) */
export interface LprPassEvent {
  type: 'lpr_pass';
  serialno: string;
  license: string;
  passDirection: 'in' | 'out' | null;
  releaseResult: string;
  isFake: number | null;
  isDanger: number | null;
  recordId: number;
  at: string;
}

/** 臻识道闸状态变化 (0 关到位 / 1 开到位 / 2 中间) */
export interface LprGateStatusEvent {
  type: 'lpr_gate_status';
  serialno: string;
  gateStatus: number;
  connectStatus: number | null;
  at: string;
}

/** 远程手动开闸结果 (comet 立即下发或排队等待相机下一次通讯) */
export interface LprGateCommandEvent {
  type: 'lpr_gate_command';
  serialno: string;
  delivered: boolean;
  queued: boolean;
  operator: string;
  at: string;
}

export type ControlEvent =
  | LprPassEvent
  | LprGateStatusEvent
  | LprGateCommandEvent
  | PowerReadingEvent
  | DeviceStatusEvent
  | SceneEvent
  | AlarmEvent
  | SceneExecutionEvent
  | DeviceOnlineEvent
  | DeviceOfflineEvent
  | AlertCreatedEvent
  | AlertResolvedEvent
  | SystemHealthEvent
  | ServiceStatusEvent
  | TestEvent
  | UatUpdatedEvent
  | PlaybackChannelChangedEvent;

@Injectable()
export class ControlBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(64);
  }

  publish(event: ControlEvent): void {
    try {
      this.emitter.emit('event', event);
    } catch {
      // WS 推送失败不影响主流程
    }
  }

  subscribe(handler: (event: ControlEvent) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }
}
