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

/**
 * 网关 key → 人读名字 + 是否启用 probe.
 * 报警标题用 displayName, 用户看 "网关离线: 诺瓦 V2460" 比 "led-nova-vx1000" 友好.
 * envSkip 列表里的 gateway 跳过 probe (e.g. 现场没接 V2460 时 LED_PROBE_DISABLED=1).
 */
const GATEWAY_META: Record<string, { displayName: string; envSkipKey: string }> = {
  'lighting-dali-gateway':    { displayName: '灯光 DALI 网关 (旧 key, 已淘汰)', envSkipKey: 'LIGHTING_PROBE_DISABLED' },
  'lighting-dali-cy64a':      { displayName: '灯光 DALI 网关 (旧聚合 key)', envSkipKey: 'LIGHTING_PROBE_DISABLED' },
  // 多网关时代 (2026-05-31+) 按 slaveId 区分:
  'lighting-dali-cy64a-1':    { displayName: 'DALI 网关 #1 (1F)', envSkipKey: 'LIGHTING_PROBE_DISABLED' },
  'lighting-dali-cy64a-2':    { displayName: 'DALI 网关 #2 (2F)', envSkipKey: 'LIGHTING_PROBE_DISABLED' },
  'led-nova-vx1000':          { displayName: '诺瓦 V2460 LED 控制器', envSkipKey: 'LED_PROBE_DISABLED' },
  'audio-dsp':                { displayName: '音响 DSP', envSkipKey: 'AUDIO_PROBE_DISABLED' },
  'hvac-modbus':              { displayName: '空调 Modbus', envSkipKey: 'HVAC_PROBE_DISABLED' },
};

function gatewayDisplay(key: string): string {
  if (GATEWAY_META[key]) return GATEWAY_META[key].displayName;
  // 动态生成: lighting-dali-cy64a-3 → 'DALI 网关 (slaveId=3)'
  const m = key.match(/^lighting-dali-cy64a-(\d+)$/);
  if (m) return `DALI 网关 (slaveId=${m[1]})`;
  return key;
}
function isGatewayProbeDisabled(key: string): boolean {
  // 所有 lighting-dali-* 都共用一个 env 开关
  if (key.startsWith('lighting-dali-')) {
    const v = process.env.LIGHTING_PROBE_DISABLED;
    return v === '1' || v === 'true';
  }
  const meta = GATEWAY_META[key];
  if (!meta) return false;
  const v = process.env[meta.envSkipKey];
  return v === '1' || v === 'true';
}

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
      const tasks: Array<Promise<void>> = [];
      // 灯光 cy-dali64a 的 healthCheck 内部已经并行 probe 所有 slaveId, 上层只调一次,
      // 但 reconnect 状态归到 -1 那个 key (默认 slaveId), 其他 slaveId 由 readWithFault 实时报告.
      const all: Array<[string, ProbeFn]> = [
        ['lighting-dali-cy64a-1', () => this.lighting.healthCheck()],
        ['led-nova-vx1000',       () => this.led.healthCheck()],
        ['audio-dsp',             () => this.audio.healthCheck()],
        ['hvac-modbus',           () => this.hvac.healthCheck()],
      ];
      for (const [key, fn] of all) {
        if (isGatewayProbeDisabled(key)) {
          // env 显式禁了, 也顺手 auto-resolve 一下之前的 active alert (避免遗留)
          await this.alertService.autoResolveBySource('gateway', key, 'gateway_offline');
          continue;
        }
        tasks.push(this.probeOne(key, fn));
      }
      await Promise.allSettled(tasks);
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
          title: `网关离线: ${gatewayDisplay(gateway)}`,
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
