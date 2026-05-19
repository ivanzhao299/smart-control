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

export type ControlEvent =
  | DeviceStatusEvent
  | SceneEvent
  | AlarmEvent
  | SceneExecutionEvent;

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
