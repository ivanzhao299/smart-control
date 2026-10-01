import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { AdapterConnectionRegistry } from '../connection-registry';
import type { BreakerMeasurements, SwitchState } from './epa-breaker-registers';
import type { BreakerState } from './epa-breaker.adapter';

const GATEWAY_KEY = 'power-hperfor-api';

/**
 * HPERFOR ePa-CB 智能断路器 —— 4G 版（内置 4G 模块，走华普云 ePa 智电云平台 Web API）。
 *
 * 与 485 版（EpaBreakerAdapter，Modbus RTU 经有人转换器）以及 MQTT 版
 * （EpaMqttBreakerAdapter）完全独立、并存：
 *   - 4G 设备不以 Modbus 从机地址区分，而是平台内 fId（设备 SN 绑定）。
 *   - 平台入口 https://www.hperfor.com/homeschool，账号密码在环境变量：
 *       HPERFOR_API_USERNAME / HPERFOR_API_PASSWORD
 *   - 每台设备在 hardware_unit(category='power-breaker-web') 的 addressing 里存
 *     {"fId":"2105...","password":"0"}（password 为设备本地 4 位密码，默认 0）。
 *
 * 【category 说明】main 已把 'power-breaker-4g' 分配给 MQTT 断路器（EpaMqttBreakerAdapter），
 *   本适配器走华普云 Web API，使用独立 category 'power-breaker-web'，避免与 MQTT 路由撞车。
 *
 * 【实测结论 2026-10-01】
 *   - 登录 POST /homeschool/login {userName,password} → JWT（7 天有效），
 *     后续请求带 Authorization 头。401/700 时重新登录。
 *   - 控制走 /biz/t-device/send（批量接口）：{fIds:[fId], fCmdType}
 *       fCmdType: 3=分闸 4=合闸 5=上锁 —— 实测稳定，一次返回「设备回应成功」。
 *     ⚠️ /app/device6/send-onoff 单台接口在设备省电休眠时超时（设备醒来窗口才响应），
 *        不用它做控制；查询开关状态也不用它。
 *   - 状态走 /biz/t-device/devices：records[].switchStatus（1=合/0=分），
 *     同时含 tOnline / fLastOnlineTime 在线信息。
 *   - 计量走 /app/device6/device-elec：{fId, isSendCmd:false} → data.table
 *     = [["温度（℃）", 输入, 输出], ["电压（ V）", L, N], ["电流（ A）", L, N],
 *        ["功率（W）", L, N]]。单相设备 L 有值、N 基本为 0。
 *
 * mock 态（MOCK_MODE=true）：纯内存开关，不触网 —— 本地单测/CI 安全。
 */
@Injectable()
export class HperforApiAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'power';
  }

  /** 单台断路器: addressing 里的 fId 缓存 */
  private fIdCache = new Map<string, string>();
  /** mock 态: code -> on */
  private mockOn = new Map<string, boolean>();

  private token: string | null = null;
  private tokenExpiresAt = 0;
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly dbCache: { rows: Array<HardwareUnit>; at: number } = { rows: [], at: 0 };
  private readonly DB_CACHE_TTL_MS = 5000;

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    @Optional() private readonly registry?: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
  ) {
    super(config, logger);
    this.baseUrl = process.env.HPERFOR_API_BASE_URL ?? 'https://www.hperfor.com/homeschool';
    this.username = process.env.HPERFOR_API_USERNAME ?? '';
    this.password = process.env.HPERFOR_API_PASSWORD ?? '';
  }

  // ============ 对外命令（与 EpaBreakerAdapter / EpaMqttBreakerAdapter 同形状） ============

  /** 合闸（送电） */
  async turnOn(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<BreakerState>> {
    return this.run(deviceId, 'turnOn', ctx, async () => {
      if (this.isMock()) {
        this.mockOn.set(deviceId, true);
        return { on: true, switchState: 'closed' as SwitchState };
      }
      await this.sendCmd(deviceId, 4); // 4 = 合闸
      return { on: true, switchState: 'closed' as SwitchState };
    });
  }

  /** 分闸（断电） */
  async turnOff(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<BreakerState>> {
    return this.run(deviceId, 'turnOff', ctx, async () => {
      if (this.isMock()) {
        this.mockOn.set(deviceId, false);
        return { on: false, switchState: 'open' as SwitchState };
      }
      await this.sendCmd(deviceId, 3); // 3 = 分闸
      return { on: false, switchState: 'open' as SwitchState };
    });
  }

  /** 读开关状态（平台 /biz/t-device/devices 的 switchStatus） */
  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<BreakerState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      if (this.isMock()) {
        const on = this.mockOn.get(deviceId) ?? false;
        return { on, switchState: (on ? 'closed' : 'open') as SwitchState };
      }
      return this.getDeviceStatus(deviceId);
    });
  }

  /** 读全套计量（平台 /app/device6/device-elec） */
  async getMeasurements(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<BreakerMeasurements>> {
    return this.run(deviceId, 'getMeasurements', ctx, async () => {
      if (this.isMock()) return this.mockMeasurements(deviceId);
      const [elec, status] = await Promise.all([
        this.fetchDeviceElec(deviceId),
        this.getDeviceStatus(deviceId),
      ]);
      return this.mapMeasurements(elec, status.on);
    });
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run(GATEWAY_KEY, 'healthCheck', ctx, async () => {
      if (this.isMock()) return { ok: true as const };
      // 拉一次设备列表即可：验证 token 有效 + 平台可达
      const token = await this.ensureToken();
      if (!token) throw new Error('华普云平台登录失败（请检查 HPERFOR_API_USERNAME/PASSWORD）');
      await this.fetchDevices(token);
      return { ok: true as const };
    });
  }

  // ============ 内部：平台调用 ============

  /** 登录拿 JWT；401/过期自动重登 */
  private async ensureToken(): Promise<string | null> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    if (!this.username || !this.password) {
      this.logger.warn('HPERFOR_API_USERNAME/PASSWORD 未配置', { context: 'HperforApiAdapter' });
      return null;
    }
    try {
      const resp = await fetch(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: this.username, password: this.password }),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await resp.json()) as { code?: number; data?: string; message?: string };
      if (!resp.ok || json.code !== 200 || !json.data) {
        this.logger.warn(`华普云登录失败: ${json.message ?? resp.status}`, { context: 'HperforApiAdapter' });
        return null;
      }
      this.token = json.data;
      // JWT 有效 7 天；留 1 小时余量提前重登
      const exp = this.parseJwtExp(this.token);
      this.tokenExpiresAt = exp ? (exp - 3600) * 1000 : Date.now() + 6 * 24 * 3600 * 1000;
      this.logger.info('华普云平台登录成功（token 续期）', { context: 'HperforApiAdapter' });
      return this.token;
    } catch (err) {
      this.logger.warn(`华普云登录异常: ${(err as Error).message}`, { context: 'HperforApiAdapter' });
      return null;
    }
  }

  private parseJwtExp(token: string): number | null {
    try {
      const payload = token.split('.')[1];
      const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return typeof json.exp === 'number' ? json.exp : null;
    } catch {
      return null;
    }
  }

  /** 批量控制：fCmdType 3=分闸 4=合闸 5=上锁 */
  private async sendCmd(deviceId: string, fCmdType: number): Promise<void> {
    const token = await this.ensureToken();
    if (!token) throw new Error('华普云未登录');
    const fId = await this.resolveFId(deviceId);
    const resp = await fetch(`${this.baseUrl}/biz/t-device/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ fIds: [fId], fCmdType }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await resp.json()) as { code?: number; success?: boolean; data?: string; message?: string };
    if (!resp.ok || json.code !== 200 || !json.success) {
      throw new Error(`华普云控制失败: ${json.message ?? resp.status}`);
    }
    // data 形如 "CB28100573 设备回应成功\r\n" —— 含设备号回应即成功
    if (json.data && !json.data.includes('成功')) {
      throw new Error(`华普云控制未获设备回应: ${json.data}`);
    }
    this.registry?.markOnline(GATEWAY_KEY);
  }

  /** 设备列表 → 单台开关状态（switchStatus 1=合 0=分） */
  private async getDeviceStatus(deviceId: string): Promise<BreakerState> {
    const token = await this.ensureToken();
    if (!token) throw new Error('华普云未登录');
    const fId = await this.resolveFId(deviceId);
    const devices = await this.fetchDevices(token);
    const row = devices.find((d) => d.fId === fId);
    if (!row) throw new Error(`平台未找到设备 fId=${fId}（deviceId=${deviceId}）`);
    const on = row.switchStatus === 1;
    return { on, switchState: (on ? 'closed' : 'open') as SwitchState };
  }

  /** 拉平台设备列表（records 数组） */
  private async fetchDevices(token: string): Promise<Array<PlatformDevice>> {
    const resp = await fetch(`${this.baseUrl}/biz/t-device/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({
        condition: { keyword: '', select_type: 'id', product_id: '', isList: true },
        current: 1,
        size: 100,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await resp.json()) as {
      code?: number;
      data?: { records?: Array<PlatformDevice> };
      message?: string;
    };
    if (!resp.ok || json.code !== 200 || !json.data?.records) {
      throw new Error(`华普云设备列表失败: ${json.message ?? resp.status}`);
    }
    this.registry?.markOnline(GATEWAY_KEY);
    return json.data.records;
  }

  /** 计量：device-elec → data.table（L/N 两列实测值） */
  private async fetchDeviceElec(deviceId: string): Promise<Array<[string, number, number]>> {
    const token = await this.ensureToken();
    if (!token) throw new Error('华普云未登录');
    const fId = await this.resolveFId(deviceId);
    const resp = await fetch(`${this.baseUrl}/app/device6/device-elec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ fId, isSendCmd: false }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await resp.json()) as {
      code?: number;
      data?: { table?: Array<[string, number, number]> };
      message?: string;
    };
    if (!resp.ok || json.code !== 200 || !json.data?.table) {
      throw new Error(`华普云计量失败: ${json.message ?? resp.status}`);
    }
    this.registry?.markOnline(GATEWAY_KEY);
    return json.data.table;
  }

  /** device-elec table → BreakerMeasurements（单相设备：L 相有值，N≈0） */
  private mapMeasurements(table: Array<[string, number, number]>, on: boolean): BreakerMeasurements {
    const get = (name: string): number | undefined => {
      const row = table.find((r) => r[0].includes(name));
      return row ? (row[1] as number) : undefined;
    };
    const voltage = get('电压') ?? 0;
    const current = get('电流') ?? 0;
    const power = get('功率') ?? 0;
    const temp = get('温度') ?? 0;
    return {
      voltages: [voltage, 0, 0],
      currents: [current, 0, 0],
      leakageCurrent: 0,
      powers: [power, 0, 0, power],
      energies: [0, 0, 0, 0],
      temperatures: [temp, 0, 0, 0],
      powerFactor: 0,
      frequency: 0,
      mode: 0,
      switchState: (on ? 'closed' : 'open') as SwitchState,
      alarms: {
        overVoltage: [false, false, false],
        underVoltage: [false, false, false],
        overCurrent: [false, false, false],
        leakage: false,
        overPower: [false, false, false, false],
        overHeat: [false, false, false, false],
        overEnergy: [false, false, false, false],
        any: false,
      },
    };
  }

  /** hardware_unit(code) → addressing.fId（5s 缓存） */
  private async resolveFId(deviceId: string): Promise<string> {
    const cached = this.fIdCache.get(deviceId);
    if (cached) return cached;
    const hw = await this.findHwByCode(deviceId);
    if (!hw || !hw.addressing) throw new Error(`hardware_unit ${deviceId} 不存在或未配置 addressing`);
    const addr = JSON.parse(hw.addressing) as { fId?: string };
    if (!addr.fId) throw new Error(`hardware_unit ${deviceId} addressing 缺 fId`);
    this.fIdCache.set(deviceId, addr.fId);
    return addr.fId;
  }

  /** 按 code 找 power-breaker-web 硬件（DB 5s 缓存，热更新） */
  private async findHwByCode(code: string): Promise<HardwareUnit | null> {
    if (!this.hwRepo) return null;
    const now = Date.now();
    if (now - this.dbCache.at >= this.DB_CACHE_TTL_MS) {
      try {
        this.dbCache.rows = await this.hwRepo.find({ where: { category: 'power-breaker-web' } });
      } catch (err) {
        this.logger.warn(`findHwByCode 查询失败: ${(err as Error).message}`, { context: 'HperforApiAdapter' });
      }
      this.dbCache.at = now;
    }
    return this.dbCache.rows.find((r) => r.code === code) ?? null;
  }

  // ============ mock 读数 ============

  private mockMeasurements(deviceId: string): BreakerMeasurements {
    const on = this.mockOn.get(deviceId) ?? false;
    return {
      voltages: on ? [220.1, 0, 0] : [0, 0, 0],
      currents: on ? [5.2, 0, 0] : [0, 0, 0],
      leakageCurrent: 0.001,
      powers: on ? [1144, 0, 0, 1144] : [0, 0, 0, 0],
      energies: [88.6, 0, 0, 88.6],
      temperatures: [31.2, 30.9, 0, 0],
      powerFactor: 0.95,
      frequency: 50,
      mode: 0,
      switchState: on ? 'closed' : 'open',
      alarms: {
        overVoltage: [false, false, false],
        underVoltage: [false, false, false],
        overCurrent: [false, false, false],
        leakage: false,
        overPower: [false, false, false, false],
        overHeat: [false, false, false, false],
        overEnergy: [false, false, false, false],
        any: false,
      },
    };
  }

  /** 给 DriverRegistryService 注册用 */
  static describe(): import('../driver-descriptor').DriverDescriptor {
    return {
      kind: 'hperfor-web',
      displayName: 'HPERFOR ePa-CB 智能断路器 (4G 华普云 Web API)',
      vendor: 'HPERFOR',
      category: 'power-breaker-web',
      protocol: 'http-json',
      capabilities: ['turn_on', 'turn_off', 'get_status', 'get_measurements', 'health_check'],
      defaultAddressing: { fId: '' },
      paramSchema: {
        fId: {
          type: 'string',
          label: '平台设备 fId（华普云 /biz/t-device/devices 返回）',
          required: true,
          placeholder: '2105528302251905025',
        },
        password: { type: 'string', label: '设备密码（默认 0）', default: '0' },
      },
      remark:
        '4G 版断路器走华普云 ePa 智电云平台（https://www.hperfor.com/homeschool）：' +
        '控制 /biz/t-device/send（3分/4合/5锁）、状态 /biz/t-device/devices.switchStatus、' +
        '计量 /app/device6/device-elec。平台账号在环境变量 HPERFOR_API_USERNAME/PASSWORD。' +
        '2026-10-01 三台（庭院亮化/鱼池供氧/园区路灯）远程合闸实测通过。',
    };
  }
}

interface PlatformDevice {
  fId: string;
  fNumber?: string;
  fName?: string;
  switchStatus?: number;
  tOnline?: boolean;
  fLastOnlineTime?: string;
}
