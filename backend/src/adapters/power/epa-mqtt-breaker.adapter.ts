import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { connect as mqttConnect, type IClientOptions, type MqttClient } from 'mqtt';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { BaseAdapter } from '../base.adapter';
import { AdapterConnectionRegistry } from '../connection-registry';
import {
  decodeElectricStatus,
  type BreakerMeasurements,
  type SwitchState,
} from './epa-breaker-registers';
import type { BreakerState } from './epa-breaker.adapter';
import {
  childToMeasurements,
  controlMessage,
  type EpaMqttChild,
  type EpaMqttMessage,
  parseMessage,
  readOneMessage,
  switchState,
} from './epa-mqtt-protocol';

const CATEGORY = 'power-breaker-4g';
const REGISTRY_PREFIX = 'power-epa-mqtt';

interface CloudBreakerConfig {
  gatewayId: string;
  clientId: string;
}

interface CachedChild {
  child: EpaMqttChild;
  receivedAt: number;
}

interface PendingReply {
  gatewayId: string;
  clientId: string;
  expectedState?: SwitchState;
  resolve: (child: EpaMqttChild) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * ePa 4G/MQTT 智能断路器适配器。
 *
 * 设备从公网主动连接 MQTT broker，本服务也以客户端方式出站连接同一 broker：
 *   设备上行 from/epa/{gatewayId}
 *   平台下行 to/epa/{gatewayId}
 *
 * broker 与账号只来自生产环境变量；硬件表只保存 gatewayId / ClientID，避免密钥进入数据库。
 */
@Injectable()
export class EpaMqttBreakerAdapter extends BaseAdapter implements OnModuleInit, OnModuleDestroy {
  get deviceType(): string {
    return 'power';
  }

  private client?: MqttClient;
  private connecting?: Promise<MqttClient>;
  private readonly latest = new Map<string, CachedChild>();
  private readonly pending = new Map<string, PendingReply>();
  private readonly dbCache = new Map<string, { config: CloudBreakerConfig; at: number }>();
  private readonly mockOn = new Map<string, boolean>();
  private readonly enabled: boolean;
  private readonly brokerUrl: string;
  private readonly commandTimeoutMs: number;
  private readonly staleMs: number;
  private readonly dbCacheTtlMs = 5000;

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    @Optional() private readonly registry?: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
  ) {
    super(config, logger);
    this.enabled = /^(1|true)$/i.test(process.env.EPA_MQTT_ENABLED ?? 'false');
    this.brokerUrl = (process.env.EPA_MQTT_URL ?? '').trim();
    this.commandTimeoutMs = Number.parseInt(process.env.EPA_MQTT_COMMAND_TIMEOUT_MS ?? '5000', 10);
    this.staleMs = Number.parseInt(process.env.EPA_MQTT_STALE_MS ?? '600000', 10);
  }

  onModuleInit(): void {
    if (this.enabled && !this.isMock()) {
      void this.ensureConnected().catch((error) => {
        this.logger.warn(`ePa MQTT 首次连接失败: ${(error as Error).message}`, {
          context: 'EpaMqttBreakerAdapter',
        });
      });
    }
  }

  onModuleDestroy(): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('ePa MQTT adapter 正在关闭'));
    }
    this.pending.clear();
    this.client?.end(true);
    this.client = undefined;
  }

  invalidateConfigCache(deviceId?: string): void {
    if (deviceId) this.dbCache.delete(deviceId);
    else this.dbCache.clear();
  }

  async turnOn(
    deviceId: string,
    _p: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BreakerState>> {
    return this.setSwitch(deviceId, true, ctx);
  }

  async turnOff(
    deviceId: string,
    _p: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BreakerState>> {
    return this.setSwitch(deviceId, false, ctx);
  }

  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<BreakerState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      if (this.isMock()) {
        const on = this.mockOn.get(deviceId) ?? false;
        return { on, switchState: on ? 'closed' : 'open' };
      }
      const child = await this.readChild(deviceId);
      const state = switchState(child.SwitchStatus);
      return { on: state === 'closed', switchState: state };
    });
  }

  async getMeasurements(
    deviceId: string,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BreakerMeasurements>> {
    return this.run(deviceId, 'getMeasurements', ctx, async () => {
      if (this.isMock()) return this.mockMeasurements(deviceId);
      return childToMeasurements(await this.readChild(deviceId));
    });
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run(REGISTRY_PREFIX, 'healthCheck', ctx, async () => {
      if (this.isMock()) return { ok: true as const };
      const client = await this.ensureConnected();
      if (!client.connected) throw new Error('ePa MQTT broker 未连接');
      return { ok: true as const };
    });
  }

  private async setSwitch(
    deviceId: string,
    on: boolean,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BreakerState>> {
    return this.run(deviceId, on ? 'turnOn' : 'turnOff', ctx, async () => {
      if (this.isMock()) {
        this.mockOn.set(deviceId, on);
        return { on, switchState: on ? 'closed' : 'open' };
      }
      const config = await this.getConfig(deviceId);
      const message = controlMessage(config.clientId, on ? 1 : 2);
      const child = await this.request(config, message, on ? 'closed' : 'open');
      const state = switchState(child.SwitchStatus);
      return { on: state === 'closed', switchState: state };
    });
  }

  private async readChild(deviceId: string): Promise<EpaMqttChild> {
    const config = await this.getConfig(deviceId);
    const key = this.childKey(config.gatewayId, config.clientId);
    const cached = this.latest.get(key);
    if (cached && Date.now() - cached.receivedAt <= this.staleMs) return cached.child;
    return this.request(config, readOneMessage(config.clientId));
  }

  private async request(
    config: CloudBreakerConfig,
    message: EpaMqttMessage,
    expectedState?: SwitchState,
  ): Promise<EpaMqttChild> {
    const client = await this.ensureConnected();
    const mid = message.mid as string;
    const reply = new Promise<EpaMqttChild>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(mid);
        reject(new Error(`ePa MQTT 等待 ${config.gatewayId}/${config.clientId} 回复超时`));
      }, this.commandTimeoutMs);
      this.pending.set(mid, {
        gatewayId: config.gatewayId,
        clientId: config.clientId,
        expectedState,
        resolve,
        reject,
        timer,
      });
    });
    try {
      await this.publish(client, `to/epa/${config.gatewayId}`, message);
      return await reply;
    } catch (error) {
      const waiter = this.pending.get(mid);
      if (waiter) clearTimeout(waiter.timer);
      this.pending.delete(mid);
      throw error;
    }
  }

  private async ensureConnected(): Promise<MqttClient> {
    if (this.client?.connected) return this.client;
    if (this.connecting) return this.connecting;
    if (!this.enabled) throw new Error('EPA_MQTT_ENABLED 未启用');
    if (!this.brokerUrl) throw new Error('EPA_MQTT_URL 未配置');

    // mqtt.js 自带断线重连。已有 client 离线时只等待它恢复，不能再创建同 clientId
    // 的第二条连接，否则两条会话会被 broker 互相踢下线。
    if (this.client) {
      this.connecting = this.waitForConnection(this.client).finally(() => {
        this.connecting = undefined;
      });
      return this.connecting;
    }

    const options: IClientOptions = {
      clientId: process.env.EPA_MQTT_CLIENT_ID ?? `smart-control-${process.pid}`,
      username: process.env.EPA_MQTT_USERNAME || undefined,
      password: process.env.EPA_MQTT_PASSWORD || undefined,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    };
    const client = mqttConnect(this.brokerUrl, options);
    this.client = client;
    client.on('connect', () => {
      client.subscribe('from/epa/+', { qos: 0 }, (error) => {
        if (error)
          this.logger.warn(`ePa MQTT 订阅失败: ${error.message}`, {
            context: 'EpaMqttBreakerAdapter',
          });
      });
      this.registry?.register(REGISTRY_PREFIX, this.brokerUrl);
      this.registry?.markOnline(REGISTRY_PREFIX);
    });
    client.on('message', (topic, payload) => this.handleMessage(topic, payload));
    client.on('offline', () => this.registry?.markFailure(REGISTRY_PREFIX, 'broker offline', true));
    client.on('error', (error) => {
      this.registry?.markFailure(REGISTRY_PREFIX, error.message, true);
      this.logger.warn(`ePa MQTT 错误: ${error.message}`, { context: 'EpaMqttBreakerAdapter' });
    });

    this.connecting = this.waitForConnection(client).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private waitForConnection(client: MqttClient): Promise<MqttClient> {
    if (client.connected) return Promise.resolve(client);
    return new Promise<MqttClient>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`ePa MQTT 连接超时: ${this.brokerUrl}`));
      }, 10000);
      const onConnect = (): void => {
        cleanup();
        resolve(client);
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        client.off('connect', onConnect);
      };
      client.once('connect', onConnect);
    });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    const gatewayId = topic.startsWith('from/epa/') ? topic.slice('from/epa/'.length) : '';
    if (!gatewayId) return;
    let message: EpaMqttMessage;
    try {
      message = parseMessage(payload);
    } catch (error) {
      this.logger.warn(`ePa MQTT 非法消息 ${topic}: ${(error as Error).message}`, {
        context: 'EpaMqttBreakerAdapter',
      });
      return;
    }
    if (message.bid === 101) {
      if (this.client?.connected) {
        void this.publish(this.client, `to/epa/${gatewayId}`, { bid: 101 }).catch((error) => {
          this.logger.warn(`ePa MQTT 心跳回复失败: ${(error as Error).message}`, {
            context: 'EpaMqttBreakerAdapter',
          });
        });
      }
      return;
    }

    const children = Array.isArray(message.Children) ? message.Children : [];
    for (const child of children) {
      if (!child.ClientID) continue;
      this.latest.set(this.childKey(gatewayId, child.ClientID), { child, receivedAt: Date.now() });
    }

    const mid = message.mid?.trim();
    if (!mid) return;
    const waiter = this.pending.get(mid);
    if (!waiter || waiter.gatewayId !== gatewayId) return;
    if (message.result === false) {
      this.finishWaiter(
        mid,
        undefined,
        new Error(`ePa MQTT 命令失败 message=${message.message ?? 'unknown'}`),
      );
      return;
    }
    const child = children.find((item) => item.ClientID === waiter.clientId);
    if (!child) return;
    if (waiter.expectedState && switchState(child.SwitchStatus) !== waiter.expectedState) {
      this.finishWaiter(
        mid,
        undefined,
        new Error(
          `ePa MQTT 实际状态 ${switchState(child.SwitchStatus)}，目标 ${waiter.expectedState}`,
        ),
      );
      return;
    }
    this.finishWaiter(mid, child);
  }

  private finishWaiter(mid: string, child?: EpaMqttChild, error?: Error): void {
    const waiter = this.pending.get(mid);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.pending.delete(mid);
    if (error) waiter.reject(error);
    else waiter.resolve(child as EpaMqttChild);
  }

  private publish(client: MqttClient, topic: string, message: EpaMqttMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      client.publish(topic, JSON.stringify(message), { qos: 0 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private async getConfig(deviceId: string): Promise<CloudBreakerConfig> {
    if (!this.hwRepo) throw new Error('ePa MQTT hardware repository 未装载');
    const now = Date.now();
    const cached = this.dbCache.get(deviceId);
    if (cached && now - cached.at < this.dbCacheTtlMs) return cached.config;
    const row = await this.hwRepo.findOne({
      where: { code: deviceId, category: CATEGORY, enabled: true },
    });
    if (!row) throw new Error(`4G 断路器 ${deviceId} 不存在、类型不符或已禁用`);
    let addressing: { gatewayId?: string; clientId?: string };
    try {
      addressing = JSON.parse(row.addressing ?? '{}') as { gatewayId?: string; clientId?: string };
    } catch {
      throw new Error(`4G 断路器 ${deviceId} 的 addressing 不是有效 JSON`);
    }
    const config = {
      gatewayId: (addressing.gatewayId ?? '').trim(),
      clientId: (addressing.clientId ?? row.serialNo ?? '').trim(),
    };
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.gatewayId)) {
      throw new Error(`4G 断路器 ${deviceId} 的 gatewayId 无效`);
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(config.clientId)) {
      throw new Error(`4G 断路器 ${deviceId} 的 clientId 无效`);
    }
    const rows = await this.hwRepo.find({ where: { category: CATEGORY, enabled: true } });
    for (const other of rows) {
      if (other.code === deviceId) continue;
      try {
        const a = JSON.parse(other.addressing ?? '{}') as { gatewayId?: string; clientId?: string };
        const otherClientId = (a.clientId ?? other.serialNo ?? '').trim();
        if ((a.gatewayId ?? '').trim() === config.gatewayId && otherClientId === config.clientId) {
          throw new Error(`4G 断路器 ${deviceId} 与 ${other.code} 的 gatewayId/clientId 重复`);
        }
      } catch (error) {
        if ((error as Error).message.includes('重复')) throw error;
      }
    }
    this.dbCache.set(deviceId, { config, at: now });
    return config;
  }

  private childKey(gatewayId: string, clientId: string): string {
    return `${gatewayId}/${clientId}`;
  }

  private mockMeasurements(deviceId: string): BreakerMeasurements {
    const on = this.mockOn.get(deviceId) ?? false;
    return {
      voltages: on ? [220, 0, 0] : [0, 0, 0],
      currents: on ? [5, 0, 0] : [0, 0, 0],
      leakageCurrent: 0,
      powers: on ? [1100, 0, 0, 1100] : [0, 0, 0, 0],
      energies: [0, 0, 0, 0],
      temperatures: [25, 0, 0, 0],
      powerFactor: 0,
      frequency: 0,
      mode: 0,
      switchState: on ? 'closed' : 'open',
      alarms: decodeElectricStatus(0),
    };
  }
}
