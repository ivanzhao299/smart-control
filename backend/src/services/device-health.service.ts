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

export interface HealthSummary {
  intervalMs: number;
  enabled: boolean;
  gateways: ConnectionInfo[];
  lastProbeAt?: string;
}

@Injectable()
export class DeviceHealthService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastProbeAt?: string;
  private readonly intervalMs: number;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: AdapterConnectionRegistry,
    private readonly lighting: LightingAdapter,
    private readonly led: LedAdapter,
    private readonly audio: AudioAdapter,
    private readonly hvac: HvacAdapter,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    this.intervalMs = Number.parseInt(process.env.HEALTH_CHECK_INTERVAL_MS ?? '15000', 10);
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
    // 首次稍后启动, 避免应用启动期间立即打满网络
    this.timer = setInterval(() => void this.probeAll(), this.intervalMs);
    setTimeout(() => void this.probeAll(), 1000);
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
    };
  }

  async probeAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.allSettled([
        this.probe('lighting', () => this.lighting.healthCheck()),
        this.probe('led', () => this.led.healthCheck()),
        this.probe('audio', () => this.audio.healthCheck()),
        this.probe('hvac', () => this.hvac.healthCheck()),
      ]);
      this.lastProbeAt = new Date().toISOString();
    } finally {
      this.running = false;
    }
  }

  private async probe(name: string, fn: () => Promise<{ ok: boolean; error?: string }>): Promise<void> {
    try {
      const res = await fn();
      if (!res.ok) {
        this.logger.warn(`Health probe failed: ${name} -> ${res.error ?? 'unknown'}`, {
          context: 'DeviceHealthService',
        });
      }
    } catch (err) {
      this.logger.warn(`Health probe threw: ${name} -> ${(err as Error).message}`, {
        context: 'DeviceHealthService',
      });
    }
  }
}
