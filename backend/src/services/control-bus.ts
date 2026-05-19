import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export type ControlEventType = 'device_status' | 'scene' | 'alarm';

export interface DeviceStatusEvent {
  type: 'device_status';
  device: string;
  status: string;
  state?: Record<string, unknown>;
  at: string;
}

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

export type ControlEvent = DeviceStatusEvent | SceneEvent | AlarmEvent;

@Injectable()
export class ControlBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(32);
  }

  publish(event: ControlEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(handler: (event: ControlEvent) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }
}
