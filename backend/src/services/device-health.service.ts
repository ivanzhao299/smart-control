import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { LightingAdapter } from '../adapters/lighting/lighting.adapter';
import { LedAdapter } from '../adapters/led/led.adapter';
import { AudioAdapter } from '../adapters/audio/audio.adapter';
import { HvacAdapter } from '../adapters/hvac/hvac.adapter';
import { AdapterConnectionRegistry, ConnectionInfo } from '../adapters/connection-registry';
import { ControlBus } from './control-bus';
import { Device, DeviceStatus } from '../entities/device.entity';
import { DeviceStatusService } from './device-status.service';

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

/** 手动检测时仍尊重现场的单类设备禁用开关。 */
const GATEWAY_PROBE_SKIP_ENV: Record<string, string> = {
  'lighting-dali-gateway': 'LIGHTING_PROBE_DISABLED',
  'lighting-dali-cy64a': 'LIGHTING_PROBE_DISABLED',
  'lighting-dali-cy64a-1': 'LIGHTING_PROBE_DISABLED',
  'lighting-dali-cy64a-2': 'LIGHTING_PROBE_DISABLED',
  'led-nova-vx1000': 'LED_PROBE_DISABLED',
  'audio-dsp': 'AUDIO_PROBE_DISABLED',
  'hvac-modbus': 'HVAC_PROBE_DISABLED',
};

function isGatewayProbeDisabled(key: string): boolean {
  // 所有 lighting-dali-* 都共用一个 env 开关
  if (key.startsWith('lighting-dali-')) {
    const v = process.env.LIGHTING_PROBE_DISABLED;
    return v === '1' || v === 'true';
  }
  const envKey = GATEWAY_PROBE_SKIP_ENV[key];
  if (!envKey) return false;
  const v = process.env[envKey];
  return v === '1' || v === 'true';
}

@Injectable()
export class DeviceHealthService {
  private running = false;
  private lastProbeAt?: string;
  /** 上一次的网关状态, 用于触发 online/offline 转换事件 */
  private lastGatewayState = new Map<string, ConnectionInfo['state']>();

  /** 上一次下发给设备的状态, 只在变化时写 DB (否则每 30s 无谓写 38 行) */
  private lastDeviceStatus = new Map<string, DeviceStatus>();

  constructor(
    private readonly registry: AdapterConnectionRegistry,
    private readonly lighting: LightingAdapter,
    private readonly led: LedAdapter,
    private readonly audio: AudioAdapter,
    private readonly hvac: HvacAdapter,
    private readonly bus: ControlBus,
    private readonly deviceStatus: DeviceStatusService,
    @InjectRepository(Device) private readonly deviceRepo: Repository<Device>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  summary(): HealthSummary {
    return {
      intervalMs: 0,
      enabled: false,
      gateways: this.registry.list(),
      lastProbeAt: this.lastProbeAt,
      reconnecting: this.registry.list()
        .filter((gateway) => gateway.state === 'reconnecting')
        .map((gateway) => gateway.gateway),
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
        if (isGatewayProbeDisabled(key)) continue;
        tasks.push(this.probeOne(key, fn));
      }
      await Promise.allSettled(tasks);
      this.lastProbeAt = new Date().toISOString();
      this.detectStateTransitions();
      await this.syncDeviceStatuses();
    } finally {
      this.running = false;
    }
  }

  /**
   * 把网关在线状态摊到挂在它下面的设备上.
   *
   * 为什么需要这一步: 探活只写内存里的 ConnectionRegistry, 粒度是**网关**;
   * 而前端 deviceStore.statusOf(name) 查的是**设备名**, 查不到就回落到
   * devices.status 这个 DB 字段 —— 那个字段自从种子数据写进去 ('offline')
   * 之后再没有任何代码改过它。于是出现"网关全绿、设备全灰"。这里补上中间
   * 这一环: 设备的在线与否 = 服务它的那台网关通不通。
   *
   * 映射不用另建对应表 —— devices.address 里本来就有:
   *   灯光 {"slaveId":1,"group":1}      → lighting-dali-cy64a-1
   *   空调 {"gwHost":"192.168.50.66"}   → hvac-zh-192.168.50.66:502
   * LED / 音响 各只有一台网关, 按 category 前缀认即可.
   */
  private async syncDeviceStatuses(): Promise<void> {
    let devices: Device[];
    try {
      devices = await this.deviceRepo.find();
    } catch (err) {
      this.logger.warn(`syncDeviceStatuses 读设备表失败: ${(err as Error).message}`, {
        context: 'DeviceHealthService',
      });
      return;
    }
    const gateways = this.registry.list();

    for (const dev of devices) {
      const next = this.deriveStatus(dev, gateways);
      // undefined = 这一族网关一个都没注册 (适配器 mock / 还没初始化),
      // 无从判断就别乱写 —— 保持 DB 里原值, 不假装知道
      if (!next) continue;
      const prev = this.lastDeviceStatus.get(dev.name);
      if (prev === next) continue;
      this.lastDeviceStatus.set(dev.name, next);
      // 变化才落库 (persist=true), 这样重启后前端也能看到上次已知状态
      await this.deviceStatus.update(dev.name, next, { derivedFrom: 'gateway-probe' }, true);
    }
  }

  /** 设备状态 = 服务它的网关的状态; 返回 undefined 表示"无从判断" */
  private deriveStatus(dev: Device, gateways: ConnectionInfo[]): DeviceStatus | undefined {
    if (!dev.enabled) return 'disabled';
    const serving = this.gatewaysForDevice(dev, gateways);
    if (serving.length === 0) return undefined;
    if (serving.some((g) => g.state === 'online')) return 'online';
    if (serving.some((g) => g.state === 'reconnecting')) return 'reconnecting';
    if (serving.some((g) => g.state === 'error')) return 'error';
    return 'offline';
  }

  private gatewaysForDevice(dev: Device, gateways: ConnectionInfo[]): ConnectionInfo[] {
    const family = gateways.filter((g) => g.gateway.startsWith(`${dev.category}-`));
    if (family.length === 0) return [];
    const addr = this.parseAddress(dev.address);
    if (!addr) return family;

    // 多网关的两族再按 address 里的归属收窄到具体那一台
    if (dev.category === 'lighting' && typeof addr.slaveId === 'number') {
      const exact = family.filter((g) => g.gateway === `lighting-dali-cy64a-${addr.slaveId}`);
      if (exact.length > 0) return exact;
    }
    if (dev.category === 'hvac' && typeof addr.gwHost === 'string') {
      const exact = family.filter((g) => g.gateway.startsWith(`hvac-zh-${addr.gwHost}:`));
      if (exact.length > 0) return exact;
    }
    return family;
  }

  private parseAddress(raw: string | null): { slaveId?: number; gwHost?: string } | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { slaveId?: number; gwHost?: string };
    } catch {
      return null; // 非 JSON 的老格式, 按整族算
    }
  }

  private async probeOne(gateway: string, fn: ProbeFn): Promise<void> {
    try {
      const res = await fn();
      if (!res.ok) {
        this.logger.warn(`Health probe failed: ${gateway} -> ${res.error ?? 'unknown'}`, {
          context: 'DeviceHealthService',
        });
      }
    } catch (err) {
      this.logger.warn(`Health probe threw: ${gateway} -> ${(err as Error).message}`, {
        context: 'DeviceHealthService',
      });
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
