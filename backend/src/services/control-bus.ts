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

export type ControlEvent =
  | DeviceStatusEvent
  | SceneEvent
  | AlarmEvent
  | SceneExecutionEvent
  | DeviceOnlineEvent
  | DeviceOfflineEvent
  | AlertCreatedEvent
  | AlertResolvedEvent
  | SystemHealthEvent
  | ServiceStatusEvent;

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
