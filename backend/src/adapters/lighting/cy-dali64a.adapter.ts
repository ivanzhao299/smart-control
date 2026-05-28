import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { TcpClient } from '../transports/tcp-client';
import { ModbusRtuClient } from '../transports/modbus-rtu';
import { AdapterConnectionRegistry } from '../connection-registry';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { classifyError } from '../errors';
import type { BrightnessState } from './mock-dali.adapter';
import {
  brightnessPctToRaw,
  brightnessRawToPct,
  fadeSecToCode,
  groupBaseReg,
  kelvinToCode,
  parseFaultMatrix,
  parseOnlineMatrix,
  REG_FAULT_START,
  REG_ONLINE_START,
  REG_SCENE_RECALL,
  sceneRegisterValue,
  shortBaseReg,
} from './cy-dali64a-registers';

const GATEWAY_KEY = 'lighting-dali-cy64a';

interface DaliAddressing {
  /** 网关从机地址 (拨码盘 1-63), 缺省取 env DALI_RTU_SLAVE_ID */
  slaveId?: number;
  /** 组号 1-16 */
  group?: number;
  /** 短地址 1-64 */
  short?: number;
}

interface CommandParams {
  value?: number; // 亮度百分比 0-100
  /** 渐变时间 (秒); 不填默认 0 = 立即 */
  fadeSec?: number;
  /** 色温 K (2500-6500); 仅 DT8 驱动有效 */
  kelvin?: number;
  /** 场景号 1-16 (recallScene 用) */
  scene?: string | number;
}

/**
 * 真实 DALI 适配器 — 元创智控 CY-DALI64A 网关
 * 走 RS485 → Modbus RTU, 通过 RTU/TCP 转换器 (USR-TCP232 / Moxa MGate) 接入 TCP 客户端
 *
 * 设备 address (来自 device.entity.address JSON) 约定:
 *   {"slaveId": 1, "group": 3}   控制 1 号网关的 3 组
 *   {"slaveId": 1, "short": 17}  控制 1 号网关的 17 号短地址 (单灯)
 *
 * env:
 *   DALI_RTU_HOST          RTU↔TCP 转换器 IP, 默认 192.168.50.20
 *   DALI_RTU_PORT          转换器 TCP 端口, 默认 502
 *   DALI_RTU_SLAVE_ID      默认从机地址, 默认 1
 *   DALI_RTU_FRAME_INTERVAL_MS  帧间隔 (≥150), 默认 200
 *   DALI_RTU_DEFAULT_FADE_SEC   默认渐变时间, 默认 0.7
 */
@Injectable()
export class CyDali64aAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'lighting';
  }

  private modbus: ModbusRtuClient;
  private modbusHost!: string;
  private modbusPort!: number;
  private readonly cfg: {
    host: string;
    port: number;
    defaultSlaveId: number;
    timeoutMs: number;
    retries: number;
    frameIntervalMs: number;
    defaultFadeSec: number;
  };
  private endpoint: string;

  /** DB 配置缓存 — 5s TTL, 避免每次 modbus 都查 */
  private dbCache: { host?: string; port?: number; at: number } = { at: 0 };
  private readonly DB_CACHE_TTL_MS = 5000;

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
  ) {
    super(config, logger);
    this.cfg = {
      host: process.env.DALI_RTU_HOST ?? '192.168.50.20',
      port: Number.parseInt(process.env.DALI_RTU_PORT ?? '502', 10),
      defaultSlaveId: Number.parseInt(process.env.DALI_RTU_SLAVE_ID ?? '1', 10),
      timeoutMs: Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10),
      retries: Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10),
      frameIntervalMs: Number.parseInt(process.env.DALI_RTU_FRAME_INTERVAL_MS ?? '200', 10),
      defaultFadeSec: Number.parseFloat(process.env.DALI_RTU_DEFAULT_FADE_SEC ?? '0.7'),
    };
    this.endpoint = `tcp://${this.cfg.host}:${this.cfg.port}`;

    const tcp = new TcpClient({
      host: this.cfg.host,
      port: this.cfg.port,
      timeoutMs: this.cfg.timeoutMs,
      deviceType: 'lighting',
    });
    this.modbus = new ModbusRtuClient(tcp, this.cfg.defaultSlaveId, this.cfg.frameIntervalMs);
    // 用来在 modbus 调用前检测 env 是否变化, 变了就重建 TcpClient
    this.modbusHost = this.cfg.host;
    this.modbusPort = this.cfg.port;

    if (!this.isMock()) this.registry.register(GATEWAY_KEY, this.endpoint);

    this.logger.info(
      `CyDali64aAdapter ready (host=${this.cfg.host}:${this.cfg.port} slaveId=${this.cfg.defaultSlaveId})`,
      { context: 'CyDali64aAdapter' },
    );
  }

  // ============ 公共 API ============

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run(GATEWAY_KEY, 'healthCheck', ctx, async () => {
      // 读 1 个寄存器作为探活 (随便读组 1 亮度)
      await this.readWithFault(this.cfg.defaultSlaveId, groupBaseReg(1) + 1, 1, ctx?.signal);
      return { ok: true as const };
    });
  }

  async turnOn(
    deviceId: string,
    params: CommandParams = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.run(deviceId, 'turnOn', ctx, async () => {
      const addr = this.parseAddressing(params, deviceId);
      const pct = params.value ?? 100;
      await this.writeFadeBrightness(addr, params.fadeSec, brightnessPctToRaw(pct), ctx?.signal);
      return { brightness: pct, on: true };
    });
  }

  async turnOff(
    deviceId: string,
    params: CommandParams = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.run(deviceId, 'turnOff', ctx, async () => {
      const addr = this.parseAddressing(params, deviceId);
      await this.writeFadeBrightness(addr, params.fadeSec, 0, ctx?.signal);
      return { brightness: 0, on: false };
    });
  }

  async setBrightness(
    deviceId: string,
    params: CommandParams = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.run(deviceId, 'setBrightness', ctx, async () => {
      const addr = this.parseAddressing(params, deviceId);
      const pct = Math.max(0, Math.min(100, Number(params.value ?? 0)));
      const raw = brightnessPctToRaw(pct);
      if (typeof params.kelvin === 'number') {
        await this.writeFadeBrightnessKelvin(
          addr,
          params.fadeSec,
          raw,
          kelvinToCode(params.kelvin),
          ctx?.signal,
        );
      } else {
        await this.writeFadeBrightness(addr, params.fadeSec, raw, ctx?.signal);
      }
      return { brightness: pct, on: pct > 0 };
    });
  }

  async recallScene(
    deviceId: string,
    params: CommandParams = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<{ scene: number }>> {
    return this.run(deviceId, 'recallScene', ctx, async () => {
      const addr = this.parseAddressing(params, deviceId);
      const sceneNo = Number(params.scene);
      if (!Number.isInteger(sceneNo) || sceneNo < 1 || sceneNo > 16) {
        throw new Error(`scene 必须是 1-16, got ${params.scene}`);
      }
      const fadeCode = fadeSecToCode(params.fadeSec ?? this.cfg.defaultFadeSec);
      const regVal = sceneRegisterValue(sceneNo, fadeCode);
      await this.writeWithFault(addr.slaveId, REG_SCENE_RECALL, regVal, ctx?.signal);
      return { scene: sceneNo };
    });
  }

  async getStatus(
    deviceId: string,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      const addr = this.parseAddressing({}, deviceId);
      const base = this.baseRegisterOf(addr);
      // 读 2 个寄存器: 亮度 (base+1) + 色温 (base+2) — 文档第 9 页示例
      const words = await this.readWithFault(addr.slaveId, base + 1, 2, ctx?.signal);
      const pct = brightnessRawToPct(words[0]);
      return { brightness: pct, on: pct > 0 };
    });
  }

  async setZoneBrightness(
    zoneId: number,
    value: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState & { zone: number }>> {
    return this.run(`zone-${zoneId}`, 'setZoneBrightness', ctx, async () => {
      const addr: Required<DaliAddressing> = {
        slaveId: this.cfg.defaultSlaveId,
        group: zoneId,
        short: 0,
      };
      const pct = Math.max(0, Math.min(100, Number(value)));
      await this.writeFadeBrightness(addr, undefined, brightnessPctToRaw(pct), ctx?.signal);
      return { brightness: pct, on: pct > 0, zone: zoneId };
    });
  }

  /** 暴露给诊断 — 看实际 modbus client 在跑哪个 host */
  getRuntimeHost(): string {
    return this.modbusHost;
  }
  getRuntimePort(): number {
    return this.modbusPort;
  }

  /** P2 — 给 DriverRegistryService 注册用 */
  static describe(): import('../driver-descriptor').DriverDescriptor {
    return {
      kind: 'cy-dali64a',
      displayName: '元创智控 CY-DALI64A (DALI 网关)',
      vendor: '元创智控',
      category: 'dali-gateway',
      protocol: 'modbus-rtu-over-tcp',
      capabilities: [
        'turn_on', 'turn_off', 'set_brightness', 'set_color_temp',
        'recall_scene', 'get_status', 'set_zone_brightness', 'health_check',
      ],
      defaultAddressing: { slaveId: 1, port: 502, frameIntervalMs: 200, daliStart: 1, daliCount: 64 },
      paramSchema: {
        ip:               { type: 'string', label: 'RTU↔TCP 转换器 IP', required: true, placeholder: '192.168.x.x' },
        port:             { type: 'number', label: 'TCP 端口', default: 502, min: 1, max: 65535 },
        slaveId:          { type: 'number', label: 'Modbus 从机号', default: 1, min: 1, max: 247 },
        frameIntervalMs:  { type: 'number', label: '帧间隔 (ms)', default: 200, min: 50, max: 2000 },
        defaultFadeSec:   { type: 'number', label: '默认渐变秒数', default: 0.7, min: 0, max: 90 },
      },
      remark: 'DALI 2.0 总线网关, 64 个短地址, 16 个 group, 16 个 scene. 走 Modbus RTU 帧, 通过 USR-TCP232 转 TCP 接入.',
    };
  }

  /**
   * 查 DB 里 CONV-RTU-1 那条硬件记录, 提取 ip 和 addressing.port. 5s TTL 缓存.
   * 返回 null 表示 DB 不可用或没找到 — 调用方应回退到 env.
   */
  private async getConfigFromDb(): Promise<{ host?: string; port?: number } | null> {
    if (!this.hwRepo) return null;
    const now = Date.now();
    if (now - this.dbCache.at < this.DB_CACHE_TTL_MS) {
      return { host: this.dbCache.host, port: this.dbCache.port };
    }
    try {
      const row = await this.hwRepo.findOne({ where: { code: 'CONV-RTU-1' } });
      if (!row) {
        this.dbCache = { at: now };
        return null;
      }
      let port: number | undefined;
      if (row.addressing) {
        try {
          const parsed = JSON.parse(row.addressing) as { port?: number };
          if (typeof parsed.port === 'number') port = parsed.port;
        } catch {/* addressing 不是 JSON 也 OK */}
      }
      this.dbCache = { host: row.ip ?? undefined, port, at: now };
      return { host: row.ip ?? undefined, port };
    } catch (err) {
      this.logger.warn(`getConfigFromDb 失败: ${(err as Error).message}`, { context: 'CyDali64aAdapter' });
      this.dbCache = { at: now };
      return null;
    }
  }

  /**
   * 让后台 / 测试代码能主动清空缓存 (e.g. PUT /api/hardware/:id 成功后).
   */
  invalidateConfigCache(): void {
    this.dbCache = { at: 0 };
  }

  /**
   * 每次 modbus 调用前: DB > env > default 三级取 host:port, 跟实际 client 当前 host/port
   * 比较, 不同就重建 TcpClient + ModbusRtuClient, 实现"后台改 IP 即时生效, 不需要重启".
   */
  private async syncRuntime(): Promise<void> {
    const db = await this.getConfigFromDb();
    const envHost = process.env.DALI_RTU_HOST;
    const envPort = process.env.DALI_RTU_PORT ? Number.parseInt(process.env.DALI_RTU_PORT, 10) : undefined;
    const host = db?.host ?? envHost ?? '192.168.50.20';
    const port = db?.port ?? envPort ?? 502;
    if (host === this.modbusHost && port === this.modbusPort) return;
    const source = db?.host ? 'db' : envHost ? 'env' : 'default';
    this.logger.warn(
      `CyDali64aAdapter rewiring: ${this.modbusHost}:${this.modbusPort} → ${host}:${port} (source=${source})`,
      { context: 'CyDali64aAdapter' },
    );
    const tcp = new TcpClient({
      host,
      port,
      timeoutMs: this.cfg.timeoutMs,
      deviceType: 'lighting',
    });
    this.modbus = new ModbusRtuClient(tcp, this.cfg.defaultSlaveId, this.cfg.frameIntervalMs);
    this.modbusHost = host;
    this.modbusPort = port;
    this.cfg.host = host;
    this.cfg.port = port;
    this.endpoint = `tcp://${host}:${port}`;
    if (!this.isMock()) {
      // register 现在是幂等的, 已存在会更新 endpoint + 清旧 lastError
      this.registry.register(GATEWAY_KEY, this.endpoint);
    }
  }

  /** Sprint-08 设备健康检查使用; 现在简化为读 1 个寄存器 */
  async ping(ctx?: AdapterContext): Promise<void> {
    await this.syncRuntime();
    try {
      await this.modbus.readHoldingRegisters(
        groupBaseReg(1) + 1,
        1,
        this.cfg.defaultSlaveId,
        ctx?.signal,
      );
      this.registry.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('lighting', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, false);
      throw dErr;
    }
  }

  /** 读 64 个驱动的在线状态 (寄存器 0x0281-0x0284) */
  async readOnlineMatrix(slaveId = this.cfg.defaultSlaveId, signal?: AbortSignal): Promise<boolean[]> {
    const words = await this.readWithFault(slaveId, REG_ONLINE_START, 4, signal);
    return parseOnlineMatrix(words);
  }

  /** 读 64 个驱动的故障状态 (寄存器 0x0285-0x0288) */
  async readFaultMatrix(slaveId = this.cfg.defaultSlaveId, signal?: AbortSignal): Promise<boolean[]> {
    const words = await this.readWithFault(slaveId, REG_FAULT_START, 4, signal);
    return parseFaultMatrix(words);
  }

  // ============ 内部工具 ============

  /** 解析寻址: 优先 params (CommandParams 没有寻址字段, 兜底), 其次 deviceId (JSON), 最后退化到 group=1 */
  private parseAddressing(_params: CommandParams, deviceId: string): Required<DaliAddressing> {
    let merged: DaliAddressing = {};
    try {
      merged = JSON.parse(deviceId) as DaliAddressing;
    } catch {
      // deviceId 不是 JSON, 用默认
    }
    const slaveId = merged.slaveId ?? this.cfg.defaultSlaveId;
    if (typeof merged.short === 'number') {
      return { slaveId, group: 0, short: merged.short };
    }
    return { slaveId, group: merged.group ?? 1, short: 0 };
  }

  private baseRegisterOf(addr: Required<DaliAddressing>): number {
    return addr.short > 0 ? shortBaseReg(addr.short) : groupBaseReg(addr.group);
  }

  /** 写 [渐变, 亮度] 2 个寄存器 (FC 0x10) — 对应文档 4.1 / 5.1 */
  private async writeFadeBrightness(
    addr: Required<DaliAddressing>,
    fadeSec: number | undefined,
    rawBrightness: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const base = this.baseRegisterOf(addr);
    const fadeCode = fadeSecToCode(fadeSec ?? this.cfg.defaultFadeSec);
    await this.writeMultiWithFault(addr.slaveId, base, [fadeCode, rawBrightness & 0xff], signal);
  }

  /** 写 [渐变, 亮度, 色温] 3 个寄存器 (FC 0x10) — 对应文档 4.2 / 5.2 */
  private async writeFadeBrightnessKelvin(
    addr: Required<DaliAddressing>,
    fadeSec: number | undefined,
    rawBrightness: number,
    kelvinCode: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const base = this.baseRegisterOf(addr);
    const fadeCode = fadeSecToCode(fadeSec ?? this.cfg.defaultFadeSec);
    await this.writeMultiWithFault(
      addr.slaveId,
      base,
      [fadeCode, rawBrightness & 0xff, kelvinCode & 0xff],
      signal,
    );
  }

  // ============ Modbus 调用包装 (失败时标记网关 fault) ============

  private async readWithFault(
    slaveId: number,
    address: number,
    qty: number,
    signal?: AbortSignal,
  ): Promise<number[]> {
    await this.syncRuntime();
    try {
      const out = await this.modbus.readHoldingRegisters(address, qty, slaveId, signal);
      this.registry.markOnline(GATEWAY_KEY);
      return out;
    } catch (err) {
      const dErr = classifyError('lighting', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }
  }

  private async writeWithFault(
    slaveId: number,
    address: number,
    value: number,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.syncRuntime();
    try {
      await this.modbus.writeSingleRegister(address, value, slaveId, signal);
      this.registry.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('lighting', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }
  }

  private async writeMultiWithFault(
    slaveId: number,
    address: number,
    values: number[],
    signal?: AbortSignal,
  ): Promise<void> {
    await this.syncRuntime();
    try {
      await this.modbus.writeMultipleRegisters(address, values, slaveId, signal);
      this.registry.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('lighting', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }
  }
}
