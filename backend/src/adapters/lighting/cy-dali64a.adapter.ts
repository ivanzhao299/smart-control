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

/**
 * 网关连接注册 key — 按 slaveId 拆开, 每个 DALI 网关独立追踪在线 / 故障状态.
 *
 * 历史: 之前是一个常量 'lighting-dali-cy64a', 不管打到哪个 slaveId 都汇报到这个 key.
 * 单网关场景 OK, 但加了 GW-DALI-2 后, 2 号网关的在线状态没法独立展示, 用户看
 * UI 永远只有"1 个 DALI 网关", 以为 #2 没上线.
 *
 * 新格式: lighting-dali-cy64a-<slaveId>, e.g. lighting-dali-cy64a-1 / -2
 * 兼容老 alert: 加一个 LEGACY_KEY, 启动时 auto-resolve 它的残留 alert
 */
const GATEWAY_KEY_PREFIX = 'lighting-dali-cy64a';
const LEGACY_GATEWAY_KEY = 'lighting-dali-cy64a'; // 老 key, 启动时清残留
function gatewayKeyForSlave(slaveId: number): string {
  return `${GATEWAY_KEY_PREFIX}-${slaveId}`;
}

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

  /** DALI 组号 → 网关 slaveId 路由表 (多网关场景, 5s TTL).
   *  从所有 hardware_unit category='dali-gateway' 的 addressing.groups 字段汇总. */
  private gatewayMapCache: { groupToSlave: Map<number, number>; at: number } = {
    groupToSlave: new Map(),
    at: 0,
  };

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
      // Modbus RTU over TCP 是长会话, 复用 socket 省每次重建的 20-40ms
      // (PERFORMANCE_AUDIT P0-#1)
      keepAlive: true,
      idleTimeoutMs: 30_000,
    });
    this.modbus = new ModbusRtuClient(tcp, this.cfg.defaultSlaveId, this.cfg.frameIntervalMs);
    // 用来在 modbus 调用前检测 env 是否变化, 变了就重建 TcpClient
    this.modbusHost = this.cfg.host;
    this.modbusPort = this.cfg.port;

    if (!this.isMock()) {
      // 启动注册 default slaveId 网关, 其他 slaveId 等首次 modbus 调用 / 健康检查时按需注册
      this.registry.register(gatewayKeyForSlave(this.cfg.defaultSlaveId), this.endpoint);
      // 老单 key 'lighting-dali-cy64a' 已废弃, 残留 alert 通过 AlertBanner X 按钮清理
      // (adapter 没注入 AlertService, 避免 alert 模块循环依赖)
    }

    this.logger.info(
      `CyDali64aAdapter ready (host=${this.cfg.host}:${this.cfg.port} defaultSlaveId=${this.cfg.defaultSlaveId})`,
      { context: 'CyDali64aAdapter' },
    );
  }

  // ============ 公共 API ============

  /**
   * 健康检查 — 从 DB 拉所有 cy-dali64a 网关, 逐个 probe (并行).
   * 任何一个失败就视为整体 fail 抛错 (DeviceHealthService 会按这个判 offline).
   * 每个网关的具体在线/失败状态独立写到对应 slaveId 的 ConnectionRegistry 条目.
   */
  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run(gatewayKeyForSlave(this.cfg.defaultSlaveId), 'healthCheck', ctx, async () => {
      const slaveIds = await this.getAllConfiguredSlaveIds();
      const results = await Promise.allSettled(
        slaveIds.map(async (sid) => {
          // 确保注册过 (DB 里新加的网关首次 probe 时 register)
          this.registry.register(gatewayKeyForSlave(sid), this.endpoint);
          // 读 group 1 亮度寄存器探活 (group 1 不一定真存在, 但 modbus 层只要响应就算通)
          await this.readWithFault(sid, groupBaseReg(1) + 1, 1, ctx?.signal);
        }),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        const errs = failed.map((r) => (r.status === 'rejected' ? r.reason?.message ?? String(r.reason) : ''));
        throw new Error(`部分网关探活失败 (${failed.length}/${slaveIds.length}): ${errs.join('; ')}`);
      }
      return { ok: true as const };
    });
  }

  async turnOn(
    deviceId: string,
    params: CommandParams = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.run(deviceId, 'turnOn', ctx, async () => {
      const addr = await this.parseAddressing(params, deviceId);
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
      const addr = await this.parseAddressing(params, deviceId);
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
      const addr = await this.parseAddressing(params, deviceId);
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
      const addr = await this.parseAddressing(params, deviceId);
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
      const addr = await this.parseAddressing({}, deviceId);
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
      const slaveId = await this.resolveSlaveIdForGroup(zoneId);
      const addr: Required<DaliAddressing> = {
        slaveId,
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
    this.gatewayMapCache = { groupToSlave: new Map(), at: 0 };
  }

  /**
   * 拉所有 dali-gateway hardware_unit 的 slaveId 列表 (去重, 升序).
   * healthCheck 用这个逐个 probe; 没 DB 数据时退回 defaultSlaveId 单网关.
   */
  private async getAllConfiguredSlaveIds(): Promise<number[]> {
    const fallback = [this.cfg.defaultSlaveId];
    if (!this.hwRepo) return fallback;
    try {
      const rows = await this.hwRepo.find({ where: { category: 'dali-gateway' } });
      const set = new Set<number>();
      for (const row of rows) {
        if (!row.enabled) continue; // 禁用的网关跳过 probe
        if (!row.addressing) continue;
        try {
          const a = JSON.parse(row.addressing) as { slaveId?: number };
          if (typeof a.slaveId === 'number' && a.slaveId >= 1 && a.slaveId <= 247) {
            set.add(a.slaveId);
          }
        } catch { /* 单条配置错不影响其他 */ }
      }
      if (set.size === 0) return fallback;
      return Array.from(set).sort((a, b) => a - b);
    } catch {
      return fallback;
    }
  }

  /**
   * 多网关支持: 读所有 hardware_unit category='dali-gateway' 行, 把它们的
   * addressing.groups (number[]) 跟 addressing.slaveId 拼成 Map<group, slaveId>.
   *
   * 现场 (2026-05-30 后): 2 台 CY-DALI64A 共用一根 RS485 (CONV-RTU-1),
   *   GW-DALI-1 slaveId=1 负责 1F group 1-7
   *   GW-DALI-2 slaveId=2 负责 2F group 8-12
   *
   * 没配置 groups 字段的网关 (或老数据) 默认用其 slaveId 作 fallback,
   * 不会破坏单网关现场.
   */
  private async getGatewayGroupMap(): Promise<Map<number, number>> {
    if (!this.hwRepo) return new Map();
    const now = Date.now();
    if (now - this.gatewayMapCache.at < this.DB_CACHE_TTL_MS) {
      return this.gatewayMapCache.groupToSlave;
    }
    const map = new Map<number, number>();
    try {
      const rows = await this.hwRepo.find({ where: { category: 'dali-gateway' } });
      for (const row of rows) {
        if (!row.addressing) continue;
        try {
          const a = JSON.parse(row.addressing) as { slaveId?: number; groups?: number[] };
          if (typeof a.slaveId !== 'number' || !Array.isArray(a.groups)) continue;
          for (const g of a.groups) {
            if (Number.isInteger(g) && g >= 1 && g <= 16) {
              map.set(g, a.slaveId);
            }
          }
        } catch { /* 非 JSON 也 OK, 跳过 */ }
      }
      this.gatewayMapCache = { groupToSlave: map, at: now };
      return map;
    } catch (err) {
      this.logger.warn(`getGatewayGroupMap 失败: ${(err as Error).message}`, { context: 'CyDali64aAdapter' });
      this.gatewayMapCache = { groupToSlave: new Map(), at: now };
      return new Map();
    }
  }

  /** 给一个 DALI 组号选 slaveId; DB 里没声明就用 defaultSlaveId (兼容老单网关) */
  private async resolveSlaveIdForGroup(groupNo: number): Promise<number> {
    const map = await this.getGatewayGroupMap();
    return map.get(groupNo) ?? this.cfg.defaultSlaveId;
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
      keepAlive: true,
      idleTimeoutMs: 30_000,
    });
    this.modbus = new ModbusRtuClient(tcp, this.cfg.defaultSlaveId, this.cfg.frameIntervalMs);
    this.modbusHost = host;
    this.modbusPort = port;
    this.cfg.host = host;
    this.cfg.port = port;
    this.endpoint = `tcp://${host}:${port}`;
    if (!this.isMock()) {
      // 所有已知 slaveId 都重新 register, endpoint 跟主 host:port 一致
      void this.getAllConfiguredSlaveIds().then((sids) => {
        for (const sid of sids) {
          this.registry.register(gatewayKeyForSlave(sid), this.endpoint);
        }
      }).catch(() => { /* DB 拉不到, 至少默认那台已经注册过了 */ });
    }
  }

  /** Sprint-08 设备健康检查 — 单 slaveId 探活, 给 device-status.service 用 */
  async ping(ctx?: AdapterContext): Promise<void> {
    await this.syncRuntime();
    const sid = this.cfg.defaultSlaveId;
    try {
      await this.modbus.readHoldingRegisters(groupBaseReg(1) + 1, 1, sid, ctx?.signal);
      this.registry.markOnline(gatewayKeyForSlave(sid));
    } catch (err) {
      const dErr = classifyError('lighting', err);
      this.registry.markFailure(gatewayKeyForSlave(sid), dErr.message, false);
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

  /**
   * 解析寻址: 优先 deviceId (JSON), 其次默认 group=1.
   *
   * 多网关路由 (2026-05-30 起):
   *   - 显式带 slaveId 的最高优先 (用户知道自己在干嘛, e.g. dali-poke 端口)
   *   - 只给 group → 查 DB gateway map 找 slaveId, 没命中 fallback 到默认
   *   - 只给 short → 沿用默认 slaveId (短地址直控通常在调试)
   */
  private async parseAddressing(_params: CommandParams, deviceId: string): Promise<Required<DaliAddressing>> {
    let merged: DaliAddressing = {};
    try {
      merged = JSON.parse(deviceId) as DaliAddressing;
    } catch {
      // deviceId 不是 JSON, 用默认
    }
    if (typeof merged.short === 'number') {
      const slaveId = merged.slaveId ?? this.cfg.defaultSlaveId;
      return { slaveId, group: 0, short: merged.short };
    }
    const group = merged.group ?? 1;
    const slaveId = merged.slaveId ?? await this.resolveSlaveIdForGroup(group);
    return { slaveId, group, short: 0 };
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
    const key = gatewayKeyForSlave(slaveId);
    // 没 register 过的 slaveId (运行时新增网关) 立即注册一下, 这样 markOnline 才有目标
    this.registry.register(key, this.endpoint);
    try {
      const out = await this.modbus.readHoldingRegisters(address, qty, slaveId, signal);
      this.registry.markOnline(key);
      return out;
    } catch (err) {
      const dErr = classifyError('lighting', err);
      this.registry.markFailure(key, dErr.message, true);
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
    const key = gatewayKeyForSlave(slaveId);
    this.registry.register(key, this.endpoint);
    try {
      await this.modbus.writeSingleRegister(address, value, slaveId, signal);
      this.registry.markOnline(key);
    } catch (err) {
      const dErr = classifyError('lighting', err);
      this.registry.markFailure(key, dErr.message, true);
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
    const key = gatewayKeyForSlave(slaveId);
    this.registry.register(key, this.endpoint);
    try {
      await this.modbus.writeMultipleRegisters(address, values, slaveId, signal);
      this.registry.markOnline(key);
    } catch (err) {
      const dErr = classifyError('lighting', err);
      this.registry.markFailure(key, dErr.message, true);
      throw dErr;
    }
  }
}
