import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { Device } from '../../entities/device.entity';
import { AdapterConnectionRegistry } from '../connection-registry';
import { classifyError, DeviceProtocolError } from '../errors';
import { withRetry } from '../retry';
import { TcpClient } from '../transports/tcp-client';
import { ModbusTcpClient } from '../transports/modbus-tcp';
import type { FanSpeed, HvacMode, HvacState } from './mock-hvac.adapter';
import {
  CTRL_OFFSET,
  ctrlBaseAddr,
  decodeIndoorState,
  FAN_TO_REG,
  IndoorAddress,
  MODE_TO_REG,
  parseIndoorAddress,
  stateBaseAddr,
  STATE_REGS_PER_INDOOR,
  tempToReg,
} from './zhonghong-mbt-protocol';

/** 网关扫描结果 — 现场实际挂载的内机清单 (见 scanGateway) */
export interface HvacGatewayScan {
  host: string;
  port: number;
  /** 空调品牌码, 奥克斯=15; 非 15 表示网关还没识别完, 数据不可信 */
  brand: number;
  type: number;
  /** 网关自报的内机数量 (寄存器 2002) */
  indoorCount: number;
  /** brand===15 才算数据就绪 */
  ready: boolean;
  /** 实际在线的内机号 (真实现场编号, 可能不是从 0 开始!) */
  onlineNs: number[];
  indoors: Array<{
    n: number;
    online: boolean;
    on: boolean;
    mode: string;
    temperature: number;
    roomTemp?: number;
    faultCode: number;
  }>;
  error?: string;
}

/**
 * HVAC 适配器 - 中弘 B 集控网关 (TCP 款)
 *
 * 协议: Modbus TCP, 默认 502 端口.
 * 部署: 2 台网关, 一台/外机, 直接接交换机 (无需 USR-TCP232).
 *
 * device.address (JSON) 决定路由到哪个网关 + 内机号:
 *   {"gwHost":"192.168.50.66","n":1}   // 1F 网关第 1 台内机
 *   {"gwHost":"192.168.50.67","n":6}   // 2F 网关第 6 台内机
 *
 * 注意: 现场内机号从 1 开始 (1F n=1..10, 2F n=1..12), 不是从 0.
 * 靠 GET /api/hvac/gateways/scan 实测确认, 别想当然按 0 起.
 *
 * 现场可通过修改设备表 address 字段重新分组, 无需改代码.
 */
@Injectable()
export class ModbusHvacAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'hvac';
  }

  /** 每个网关 IP 对应一个 Modbus TCP 客户端 (惰性创建) */
  private readonly clients = new Map<string, { modbus: ModbusTcpClient; key: string }>();
  private readonly timeoutMs: number;
  private readonly retries: number;

  /** DB 配置缓存 — 所有 hvac-gateway category 的 hardware_unit 的 ip 列表, 用于 ping 默认网关 */
  private dbCache: { gateways: Array<{ code: string; ip: string; port: number }>; at: number } = {
    gateways: [],
    at: 0,
  };
  private readonly DB_CACHE_TTL_MS = 5000;

  /** 内机序号(indoorIdx 1..N) → address JSON 映射缓存, 5s TTL */
  private idxCache: { map: Map<number, string>; at: number } = { map: new Map(), at: 0 };

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
    @Optional() @InjectRepository(Device) private readonly deviceRepo?: Repository<Device>,
  ) {
    super(config, logger);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
    this.retries = Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10);
  }

  /** 查 DB 里所有 hvac-gateway category 记录, 拿到当前实际 IP/Port. 5s TTL. */
  private async getGatewaysFromDb(): Promise<Array<{ code: string; ip: string; port: number }>> {
    if (!this.hwRepo) return [];
    const now = Date.now();
    if (now - this.dbCache.at < this.DB_CACHE_TTL_MS) {
      return this.dbCache.gateways;
    }
    try {
      const rows = await this.hwRepo.find({ where: { category: 'hvac-gateway' } });
      const gateways = rows
        .filter((r) => !!r.ip)
        .map((r) => {
          let port = 502;
          if (r.addressing) {
            try {
              const parsed = JSON.parse(r.addressing) as { port?: number };
              if (typeof parsed.port === 'number') port = parsed.port;
            } catch {
              /* 忽略非 JSON */
            }
          }
          return { code: r.code, ip: r.ip as string, port };
        });
      this.dbCache = { gateways, at: now };
      return gateways;
    } catch (err) {
      this.logger.warn(`getGatewaysFromDb 失败: ${(err as Error).message}`, {
        context: 'ModbusHvacAdapter',
      });
      this.dbCache = { gateways: [], at: now };
      return [];
    }
  }

  /** PUT /api/hardware/:id 成功后调, 让 ping 用最新 DB 配置, 同时清掉所有 TCP 客户端缓存. */
  invalidateConfigCache(): void {
    this.dbCache = { gateways: [], at: 0 };
    // 网关 IP 变了, 序号→address 映射里的 gwHost 也过期, 一并清
    this.idxCache = { map: new Map(), at: 0 };
    // 清掉所有 TCP 客户端, 让下次调用按最新 IP 重建.
    // 注意: device 表里的 gwHost 字段也需要后台同步改, 否则即使重建了 TCP 也是连旧 IP.
    // P3 会通过 hardware_unit.code 替换 IP 直挂的耦合.
    this.clients.clear();
  }

  /**
   * 内机序号(indoorIdx 1..N) → address JSON 映射. 5s TTL 缓存.
   *
   * 前端/场景按"楼层内机序号"下发 (1..22), 但适配器要 {gwHost,n} 地址.
   * 查 devices 表 category='hvac', 按 (楼层, n) 排序建立序号→address:
   *   1F 内机 (n=1..10) 排前 → 序号 1..10; 2F 接续 → 序号 11..22.
   * 跟 seed / HVAC_ZONES 的 indoorIdx 定义一致. address 用 DB 实时值,
   * 网关换 IP 时其 gwHost 自动跟随 (配合 HardwareService 的 gwHost 联动).
   */
  private async getIdxAddressMap(): Promise<Map<number, string>> {
    const now = Date.now();
    if (this.idxCache.map.size > 0 && now - this.idxCache.at < this.DB_CACHE_TTL_MS) {
      return this.idxCache.map;
    }
    const map = new Map<number, string>();
    for (const m of await this.listIndoorMeta()) map.set(m.idx, m.address);
    this.idxCache = { map, at: now };
    return map;
  }

  /**
   * 序号 → 内机元信息 (楼层 / 网关 / 物理机号 / 机型), 跟 getIdxAddressMap
   * **同一份排序口径**.
   *
   * 上层 (HvacController 灌 hvac_indoor 种子、前端展示机型) 需要的不只是
   * address。单独再实现一遍排序 = 迟早跟这里漂移, 序号错位的 bug 已经犯过一次
   * (2026-07-11 内机号错位), 所以这里只留一处排序, 两边都从它取。
   */
  async listIndoorMeta(): Promise<
    Array<{
      idx: number;
      floor: string;
      n: number;
      gwHost?: string;
      model?: string;
      kw?: number;
      address: string;
    }>
  > {
    if (!this.deviceRepo) return [];
    try {
      const rows = await this.deviceRepo.find({ where: { category: 'hvac' } });
      return rows
        .map((d) => {
          let a: { n?: number; gwHost?: string; model?: string; kw?: number } = {};
          try {
            a = JSON.parse(d.address ?? '{}') as typeof a;
          } catch {
            /* address 不是 JSON, 下面会被过滤掉 */
          }
          return {
            address: d.address ?? '',
            floor: d.floor ?? '',
            n: typeof a.n === 'number' ? a.n : null,
            gwHost: a.gwHost,
            model: a.model,
            kw: a.kw,
          };
        })
        .filter((x): x is typeof x & { n: number } => x.n !== null && !!x.address)
        .sort((a, b) => (a.floor === b.floor ? a.n - b.n : a.floor.localeCompare(b.floor)))
        .map((x, i) => ({
          idx: i + 1,
          floor: x.floor,
          n: x.n,
          gwHost: x.gwHost,
          model: x.model,
          kw: x.kw,
          address: x.address,
        }));
    } catch (err) {
      this.logger.warn(`listIndoorMeta 失败: ${(err as Error).message}`, {
        context: 'ModbusHvacAdapter',
      });
      return [];
    }
  }

  /**
   * deviceId 归一化: 前端传内机序号 ("1".."22"); 场景动作可能直接传 address JSON.
   * 纯数字序号 → 查表转 address JSON; 已是 JSON (以 { 开头) 原样返回.
   */
  private async normalizeDeviceId(deviceId: string): Promise<string> {
    const s = deviceId.trim();
    if (s.startsWith('{')) return s; // 已是 address JSON (场景动作直传)
    const idx = Number(s);
    if (!Number.isInteger(idx) || idx < 1) return s; // 非序号, 交给下游报错
    const addr = (await this.getIdxAddressMap()).get(idx);
    return addr ?? s;
  }

  /** P2 — 给 DriverRegistryService 注册用 */
  static describe(): import('../driver-descriptor').DriverDescriptor {
    return {
      kind: 'zhonghong-mbt',
      displayName: '中弘 ZHONGHONG B 集控网关 (TCP / VRF 空调)',
      vendor: '中弘 ZHONGHONG',
      category: 'hvac-gateway',
      protocol: 'modbus-tcp',
      capabilities: [
        'turn_on',
        'turn_off',
        'set_temperature',
        'set_mode',
        'set_fan_speed',
        'get_status',
        'health_check',
      ],
      defaultAddressing: {
        slaveId: 1,
        port: 502,
        maxIndoor: 64,
        protocol: 'MODBUS-TCP (MBT v3.2)',
      },
      paramSchema: {
        ip: { type: 'string', label: '网关 IP', required: true, placeholder: '192.168.x.x' },
        port: { type: 'number', label: 'TCP 端口', default: 502, min: 1, max: 65535 },
        slaveId: { type: 'number', label: 'Modbus 从机号', default: 1, min: 1, max: 247 },
        maxIndoor: { type: 'number', label: '最大内机数', default: 64, min: 1, max: 64 },
      },
      remark:
        '一台网关挂 1-64 台 VRF 内机, 走 Modbus TCP. 跟商用奥克斯/大金/美的等品牌 VRF 主机配对.',
    };
  }

  /** 拿到 deviceId 对应内机的网关客户端 + 网关 key */
  private async resolve(
    deviceId: string,
  ): Promise<{ addr: IndoorAddress; modbus: ModbusTcpClient; key: string }> {
    const normalized = await this.normalizeDeviceId(deviceId);
    const addr = parseIndoorAddress(normalized);
    if (!addr) {
      throw new DeviceProtocolError(
        'hvac',
        `invalid deviceId, expect indoorIdx(1..N) or JSON {gwHost,n}: ${deviceId}`,
      );
    }
    const key = `hvac-zh-${addr.gwHost}:${addr.gwPort ?? 502}`;
    let entry = this.clients.get(key);
    if (!entry) {
      const tcp = new TcpClient({
        host: addr.gwHost,
        port: addr.gwPort ?? 502,
        deviceType: 'hvac',
        timeoutMs: this.timeoutMs,
        // 中弘 B 集控走 Modbus TCP, 持久会话; 复用 socket 省每命令 30-60ms
        // (PERFORMANCE_AUDIT P0-#1)
        keepAlive: true,
        idleTimeoutMs: 30_000,
      });
      const modbus = new ModbusTcpClient(tcp, addr.slaveId ?? 1);
      this.clients.set(key, { modbus, key });
      if (!this.isMock())
        this.registry.register(key, `modbus-tcp://${addr.gwHost}:${addr.gwPort ?? 502}`);
      entry = { modbus, key };
    }
    return { addr, modbus: entry.modbus, key: entry.key };
  }

  /** 现场所有网关地址: DB > env > default 三级. 空调是多网关 (1F/2F 各一台). */
  private async listGatewayEndpoints(): Promise<Array<{ host: string; port: number }>> {
    const dbGateways = await this.getGatewaysFromDb();
    if (dbGateways.length > 0) return dbGateways.map((g) => ({ host: g.ip, port: g.port }));
    return [
      {
        host: process.env.HVAC_HOST ?? '192.168.50.66',
        port: Number.parseInt(process.env.HVAC_PORT ?? '502', 10),
      },
    ];
  }

  /** 探活单台网关; 成功/失败都写进 ConnectionRegistry 对应 key */
  private async pingGateway(host: string, port: number, ctx?: AdapterContext): Promise<void> {
    const slaveId = Number.parseInt(process.env.HVAC_DEFAULT_SLAVE_ID ?? '1', 10);
    const key = `hvac-zh-${host}:${port}`;
    let entry = this.clients.get(key);
    if (!entry) {
      const tcp = new TcpClient({
        host,
        port,
        deviceType: 'hvac',
        timeoutMs: this.timeoutMs,
        keepAlive: true,
        idleTimeoutMs: 30_000,
      });
      const modbus = new ModbusTcpClient(tcp, slaveId);
      this.clients.set(key, { modbus, key });
      if (!this.isMock()) this.registry.register(key, `modbus-tcp://${host}:${port}`);
      entry = { modbus, key };
    }
    try {
      // 读性能寄存器 2000 验证连接
      await entry.modbus.readHoldingRegisters(2000, 1, slaveId, ctx?.signal);
      this.registry.markOnline(key);
    } catch (err) {
      const dErr = classifyError('hvac', err);
      this.registry.markFailure(key, dErr.message, false);
      throw dErr;
    }
  }

  /** 兼容旧调用: 只探默认 (第一台) 网关 */
  async ping(ctx?: AdapterContext): Promise<void> {
    const [first] = await this.listGatewayEndpoints();
    await this.pingGateway(first.host, first.port, ctx);
  }

  /**
   * 探活**所有**网关, 不是只探第一台.
   *
   * 之前这里是 `await this.ping(ctx)` —— ping 取 `dbGateways[0]`, 于是 2F 那台
   * (192.168.50.67) 永远没被探过, ConnectionRegistry 里压根没有它的条目, 除非
   * 有人正好下发过一条 2F 的空调命令才会被 resolve() 惰性注册。表现就是
   * "2F 空调看着永远不在线"。多网关是现场常态, 探活必须按台遍历。
   */
  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run('hvac-gateway', 'healthCheck', ctx, async () => {
      const endpoints = await this.listGatewayEndpoints();
      const results = await Promise.allSettled(
        endpoints.map((e) => this.pingGateway(e.host, e.port, ctx)),
      );
      const failed = results
        .map((r, i) => ({ r, e: endpoints[i] }))
        .filter((x) => x.r.status === 'rejected');
      if (failed.length === endpoints.length) {
        // 全挂才算 healthCheck 失败 (触发上层重连退避); 部分挂由各自的
        // registry 条目如实反映, 不该让好的那台跟着背锅重连
        const errs = failed
          .map((x) => `${x.e.host}:${x.e.port} ${(x.r as PromiseRejectedResult).reason?.message}`)
          .join('; ');
        throw new Error(`所有空调网关探活失败 (${failed.length}/${endpoints.length}): ${errs}`);
      }
      return { ok: true as const };
    });
  }

  async turnOn(
    deviceId: string,
    _p: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'turnOn', ctx, async () => {
      const r = await this.resolve(deviceId);
      await this.writeReg(r, ctrlBaseAddr(r.addr.n) + CTRL_OFFSET.POWER, 1, ctx?.signal);
      return this.readState(r, ctx?.signal);
    });
  }

  async turnOff(
    deviceId: string,
    _p: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'turnOff', ctx, async () => {
      const r = await this.resolve(deviceId);
      await this.writeReg(r, ctrlBaseAddr(r.addr.n) + CTRL_OFFSET.POWER, 0, ctx?.signal);
      return this.readState(r, ctx?.signal);
    });
  }

  async setTemperature(
    deviceId: string,
    params: { value?: number; temperature?: number } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setTemperature', ctx, async () => {
      const v = Number(params.value ?? params.temperature);
      if (!Number.isFinite(v) || v < 16 || v > 32) {
        throw new DeviceProtocolError('hvac', `temperature out of range 16-32: ${v}`);
      }
      const r = await this.resolve(deviceId);
      await this.writeReg(r, ctrlBaseAddr(r.addr.n) + CTRL_OFFSET.TEMP, tempToReg(v), ctx?.signal);
      return this.readState(r, ctx?.signal);
    });
  }

  async setMode(
    deviceId: string,
    params: { mode?: HvacMode } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setMode', ctx, async () => {
      const mode = params.mode ?? 'auto';
      const regVal = MODE_TO_REG[mode];
      if (regVal === undefined) {
        throw new DeviceProtocolError('hvac', `invalid hvac mode: ${mode}`);
      }
      const r = await this.resolve(deviceId);
      await this.writeReg(r, ctrlBaseAddr(r.addr.n) + CTRL_OFFSET.MODE, regVal, ctx?.signal);
      return this.readState(r, ctx?.signal);
    });
  }

  async setFanSpeed(
    deviceId: string,
    params: { speed?: FanSpeed } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setFanSpeed', ctx, async () => {
      const speed = params.speed ?? 'auto';
      const regVal = FAN_TO_REG[speed];
      if (regVal === undefined) {
        throw new DeviceProtocolError('hvac', `invalid fan speed: ${speed}`);
      }
      const r = await this.resolve(deviceId);
      await this.writeReg(r, ctrlBaseAddr(r.addr.n) + CTRL_OFFSET.FAN, regVal, ctx?.signal);
      return this.readState(r, ctx?.signal);
    });
  }

  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      const r = await this.resolve(deviceId);
      return this.readState(r, ctx?.signal);
    });
  }

  /**
   * 扫描一台网关实际挂载的内机 — 现场调试 / 配置校准用.
   *
   * 中弘网关是单客户端: 后端占着连接时外部工具连不进去, 所以这个能力必须放在
   * 后端 (复用已有的 TCP 客户端). 读网关信息寄存器 2000-2005 (品牌/类型/内机数量)
   * + 逐台读 6*n 状态寄存器, 返回真实在线内机清单.
   *
   * 用途: 校验 devices 表配的 n 是否跟现场一致 (2026-07-11 就是靠它发现两台
   * 网关的实际内机都是从 n=1 起 — 1F n=1..10 / 2F n=1..12 — 而库里按 n=0 起配,
   * 整体错位一位: n=0 打给不存在的内机 (Modbus 层返回成功但现场无反应), 最后
   * 一台够不着, 中间全部张冠李戴).
   */
  async scanGateway(
    host: string,
    port = 502,
    maxIndoor = 16,
    slaveId = 1,
    signal?: AbortSignal,
  ): Promise<HvacGatewayScan> {
    const key = `hvac-zh-${host}:${port}`;
    let entry = this.clients.get(key);
    if (!entry) {
      const tcp = new TcpClient({
        host,
        port,
        deviceType: 'hvac',
        timeoutMs: this.timeoutMs,
        keepAlive: true,
        idleTimeoutMs: 30_000,
      });
      const modbus = new ModbusTcpClient(tcp, slaveId);
      this.clients.set(key, { modbus, key });
      if (!this.isMock()) this.registry.register(key, `modbus-tcp://${host}:${port}`);
      entry = { modbus, key };
    }

    // 网关信息: 2000=品牌码(奥克斯=15) 2001=类型 2002=内机数量 2003/2004=温度上下限
    const info = await entry.modbus.readHoldingRegisters(2000, 6, slaveId, signal);
    const indoors: HvacGatewayScan['indoors'] = [];
    for (let n = 0; n <= maxIndoor; n += 1) {
      try {
        const regs = await entry.modbus.readHoldingRegisters(
          stateBaseAddr(n),
          STATE_REGS_PER_INDOOR,
          slaveId,
          signal,
        );
        const st = decodeIndoorState(regs);
        indoors.push({
          n,
          online: st.online,
          on: st.on,
          mode: st.mode,
          temperature: st.temperature,
          roomTemp: st.roomTemp,
          faultCode: st.faultCode,
        });
      } catch {
        // 读不到这台就跳过 (地址越界会回 Modbus 异常码)
      }
    }
    return {
      host,
      port,
      brand: info[0],
      type: info[1],
      indoorCount: info[2],
      // brand 应为 15 (奥克斯); 非 15 说明网关还没识别完空调, 数据不可信
      ready: info[0] === 15,
      onlineNs: indoors.filter((i) => i.online).map((i) => i.n),
      indoors,
    };
  }

  /** 扫描 DB 里登记的所有 hvac 网关 */
  async scanAllGateways(
    maxIndoor = 16,
    signal?: AbortSignal,
  ): Promise<Array<HvacGatewayScan & { code: string }>> {
    const gws = await this.getGatewaysFromDb();
    const out: Array<HvacGatewayScan & { code: string }> = [];
    for (const gw of gws) {
      try {
        const scan = await this.scanGateway(gw.ip, gw.port, maxIndoor, 1, signal);
        out.push({ code: gw.code, ...scan });
      } catch (err) {
        out.push({
          code: gw.code,
          host: gw.ip,
          port: gw.port,
          brand: -1,
          type: -1,
          indoorCount: -1,
          ready: false,
          onlineNs: [],
          indoors: [],
          error: (err as Error).message,
        } as HvacGatewayScan & { code: string });
      }
    }
    return out;
  }

  // ============ 内部 ============

  private async writeReg(
    r: { addr: IndoorAddress; modbus: ModbusTcpClient; key: string },
    address: number,
    value: number,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await withRetry(
        () => r.modbus.writeSingleRegister(address, value, r.addr.slaveId ?? 1, signal),
        { retries: this.retries, timeoutMs: this.timeoutMs, signal },
      );
      this.registry.markOnline(r.key);
    } catch (err) {
      const dErr = classifyError('hvac', err);
      this.registry.markFailure(r.key, dErr.message, true);
      throw dErr;
    }
  }

  private async readState(
    r: { addr: IndoorAddress; modbus: ModbusTcpClient; key: string },
    signal?: AbortSignal,
  ): Promise<HvacState> {
    const base = stateBaseAddr(r.addr.n);
    let regs: number[];
    try {
      regs = await withRetry(
        () =>
          r.modbus.readHoldingRegisters(base, STATE_REGS_PER_INDOOR, r.addr.slaveId ?? 1, signal),
        { retries: this.retries, timeoutMs: this.timeoutMs, signal },
      );
      this.registry.markOnline(r.key);
    } catch (err) {
      const dErr = classifyError('hvac', err);
      this.registry.markFailure(r.key, dErr.message, true);
      throw dErr;
    }
    const state = decodeIndoorState(regs);
    return {
      on: state.on,
      mode: state.mode as HvacMode,
      temperature: state.temperature,
      fan: state.fan as FanSpeed,
      roomTemp: state.roomTemp,
    };
  }
}
