import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { LightingAdapter } from '../adapters/lighting/lighting.adapter';
import { LedAdapter } from '../adapters/led/led.adapter';
import { AudioAdapter } from '../adapters/audio/audio.adapter';
import { HvacAdapter } from '../adapters/hvac/hvac.adapter';
import { AdapterConnectionRegistry, ConnectionInfo } from '../adapters/connection-registry';
import { ControlBus } from './control-bus';
import { AlertService } from '../modules/alerts/alert.service';

export interface HealthSummary {
  intervalMs: number;
  enabled: boolean;
  gateways: ConnectionInfo[];
  lastProbeAt?: string;
  reconnecting: string[];
}

interface ProbeFn {
  (): Promise<{ ok: boolean; error?: string }>;
}

/** Sprint-08 自定义重连退避: 立即 / 5s / 15s 三次, 失败后标记 offline */
const RECONNECT_DELAYS_MS = [0, 5_000, 15_000];

@Injectable()
export class DeviceHealthService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastProbeAt?: string;
  private readonly intervalMs: number;
  private readonly enabled: boolean;
  /** key=gateway-name, 正在重连的网关跟踪 */
  private reconnectInFlight = new Set<string>();
  /** 上一次的网关状态, 用于触发 online/offline 转换事件 */
  private lastGatewayState = new Map<string, ConnectionInfo['state']>();

  constructor(
    private readonly config: ConfigService,
    private readonly registry: AdapterConnectionRegistry,
    private readonly lighting: LightingAdapter,
    private readonly led: LedAdapter,
    private readonly audio: AudioAdapter,
    private readonly hvac: HvacAdapter,
    private readonly bus: ControlBus,
    private readonly alertService: AlertService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    this.intervalMs = Number.parseInt(process.env.HEALTH_CHECK_INTERVAL_MS ?? '30000', 10);
    this.enabled = (process.env.HEALTH_CHECK_ENABLED ?? 'true').toLowerCase() !== 'false';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.info('DeviceHealthService disabled by HEALTH_CHECK_ENABLED=false', {
        context: 'DeviceHealthService',
      });
      return;
    }
    this.logger.info(`DeviceHealthService starting (interval=${this.intervalMs}ms)`, {
      context: 'DeviceHealthService',
    });
    this.timer = setInterval(() => void this.probeAll(), this.intervalMs);
    setTimeout(() => void this.probeAll(), 1500);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  summary(): HealthSummary {
    return {
      intervalMs: this.intervalMs,
      enabled: this.enabled,
      gateways: this.registry.list(),
      lastProbeAt: this.lastProbeAt,
      reconnecting: Array.from(this.reconnectInFlight),
    };
  }

  async probeAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.allSettled([
        this.probeOne('lighting-dali-gateway', () => this.lighting.healthCheck()),
        this.probeOne('led-nova-vx1000', () => this.led.healthCheck()),
        this.probeOne('audio-dsp', () => this.audio.healthCheck()),
        this.probeOne('hvac-modbus', () => this.hvac.healthCheck()),
      ]);
      this.lastProbeAt = new Date().toISOString();
      this.detectStateTransitions();
    } finally {
      this.running = false;
    }
  }

  private async probeOne(gateway: string, fn: ProbeFn): Promise<void> {
    try {
      const res = await fn();
      if (!res.ok) {
        this.logger.warn(`Health probe failed: ${gateway} -> ${res.error ?? 'unknown'}`, {
          context: 'DeviceHealthService',
        });
        void this.scheduleReconnect(gateway, fn, res.error);
      }
    } catch (err) {
      this.logger.warn(`Health probe threw: ${gateway} -> ${(err as Error).message}`, {
        context: 'DeviceHealthService',
      });
      void this.scheduleReconnect(gateway, fn, (err as Error).message);
    }
  }

  /** 重连退避序列: 立即(0)/5s/15s 三次, 全失败则保持 offline + 创建 critical alert */
  private async scheduleReconnect(
    gateway: string,
    fn: ProbeFn,
    lastError: string | undefined,
  ): Promise<void> {
    if (this.reconnectInFlight.has(gateway)) return;
    this.reconnectInFlight.add(gateway);
    try {
      for (let i = 0; i < RECONNECT_DELAYS_MS.length; i += 1) {
        const delay = RECONNECT_DELAYS_MS[i];
        if (delay > 0) await new Promise<void>((r) => setTimeout(r, delay));
        try {
          const r = await fn();
          if (r.ok) {
            this.logger.info(`Reconnect succeeded: ${gateway} (attempt ${i + 1})`, {
              context: 'DeviceHealthService',
            });
            await this.alertService.autoResolveBySource('gateway', gateway, 'gateway_offline');
            return;
          }
          lastError = r.error ?? lastError;
        } catch (err) {
          lastError = (err as Error).message;
        }
        this.logger.warn(
          `Reconnect attempt ${i + 1}/${RECONNECT_DELAYS_MS.length} failed: ${gateway} -> ${lastError}`,
          { context: 'DeviceHealthService' },
        );
      }
      // 三次都失败 → 写持久化 alert
      try {
        await this.alertService.create({
          level: 'critical',
          type: 'gateway_offline',
          sourceType: 'gateway',
          sourceId: gateway,
          title: `网关离线: ${gateway}`,
          message: lastError ?? 'all reconnect attempts failed',
          dedupe: true,
        });
      } catch (err) {
        this.logger.error(`Failed to create alert for ${gateway}: ${(err as Error).message}`, {
          context: 'DeviceHealthService',
        });
      }
    } finally {
      this.reconnectInFlight.delete(gateway);
    }
  }

  private detectStateTransitions(): void {
    const gateways = this.registry.list();
    for (const g of gateways) {
      const prev = this.lastGatewayState.get(g.gateway);
      if (prev === g.state) continue;
      this.lastGatewayState.set(g.gateway, g.state);
      const at = new Date().toISOString();
      if (g.state === 'online') {
        this.bus.publish({
          type: 'device_online',
          device: g.gateway,
          category: this.categoryOf(g.gateway),
          at,
        });
      } else if (g.state === 'offline' || g.state === 'error') {
        this.bus.publish({
          type: 'device_offline',
          device: g.gateway,
          category: this.categoryOf(g.gateway),
          reason: g.lastError,
          at,
        });
      }
    }
  }

  private categoryOf(name: string): string {
    if (name.includes('lighting')) return 'lighting';
    if (name.includes('led')) return 'led';
    if (name.includes('audio')) return 'audio';
    if (name.includes('hvac')) return 'hvac';
    return 'system';
  }
}
