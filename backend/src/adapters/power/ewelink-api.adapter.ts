import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import {
  BreakerMeasurements,
  SwitchState,
} from './epa-breaker-registers';
import { EwelinkDevicesService } from '../../integrations/ewelink/ewelink-devices.service';

/** addressing 结构（同步时写入） */
interface EwelinkAddressing {
  deviceId: string;
  uiid: number;
  channel: number;
  familyId?: string | null;
}

/**
 * 易微联 eWeLink 云开关适配器（2026-10-08）。
 *
 * 与 HperforApiAdapter 同形状，作为一种新的云设备连接方式接入电源回路：
 *   - gatewayCode 对应 hardware_unit（category='power-breaker-ewelink'），
 *     addressing 里存 {deviceId, uiid, channel}；
 *   - 控制 / 状态走易微联 OAuth2.0 v2 REST（由 EwelinkDevicesService 完成签名/授权）。
 *
 * 市售易微联开关/插座多数只回报开关态；带功耗监测的型号 params 另带
 * voltage/current/power/kwh，本适配器一并映射，没有则填 0。
 */
@Injectable()
export class EwelinkApiAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'power';
  }

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    @Optional()
    @InjectRepository(HardwareUnit)
    private readonly hwRepo?: Repository<HardwareUnit>,
    @Optional() private readonly devices?: EwelinkDevicesService,
  ) {
    super(config, logger);
  }

  /** 合闸（送电） */
  async turnOn(
    gatewayCode: string,
    _p: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<{ on: boolean; switchState: SwitchState }>> {
    return this.run(gatewayCode, 'turnOn', ctx, async () => {
      if (this.isMock() || !this.devices) {
        return { on: true, switchState: 'closed' as SwitchState };
      }
      const addr = await this.resolveAddressing(gatewayCode);
      await this.devices.setSwitch(addr.deviceId, addr.uiid, addr.channel, true);
      return { on: true, switchState: 'closed' as SwitchState };
    });
  }

  /** 分闸（断电） */
  async turnOff(
    gatewayCode: string,
    _p: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<{ on: boolean; switchState: SwitchState }>> {
    return this.run(gatewayCode, 'turnOff', ctx, async () => {
      if (this.isMock() || !this.devices) {
        return { on: false, switchState: 'open' as SwitchState };
      }
      const addr = await this.resolveAddressing(gatewayCode);
      await this.devices.setSwitch(addr.deviceId, addr.uiid, addr.channel, false);
      return { on: false, switchState: 'open' as SwitchState };
    });
  }

  /** 读全量计量（开关态必有；电压/电流/功率/电量视型号而定） */
  async getMeasurements(
    gatewayCode: string,
    _p: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BreakerMeasurements>> {
    return this.run(gatewayCode, 'getMeasurements', ctx, async () => {
      const addr = await this.resolveAddressing(gatewayCode);
      if (this.isMock() || !this.devices) {
        return this.mockMeasurements(addr?.channel ?? 0);
      }
      const { params } = await this.devices.getRawParams(addr.deviceId);
      return this.mapParams(params, addr.channel);
    });
  }

  async getStatus(
    gatewayCode: string,
    _p: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<{ on: boolean; switchState: SwitchState }>> {
    const r = await this.getMeasurements(gatewayCode, _p, ctx);
    if (!r.ok || !r.data) {
      return { ...r, data: undefined };
    }
    const on = r.data.switchState === 'closed';
    return { ...r, data: { on, switchState: r.data.switchState } };
  }

  async healthCheck(
    gatewayCode: string,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<{ ok: boolean }>> {
    return this.run(gatewayCode, 'healthCheck', ctx, async () => {
      const addr = await this.resolveAddressing(gatewayCode);
      if (this.isMock() || !this.devices) return { ok: true };
      await this.devices.getRawParams(addr.deviceId);
      return { ok: true };
    });
  }

  // ============ 内部 ============

  private async resolveAddressing(gatewayCode: string): Promise<EwelinkAddressing> {
    if (!this.hwRepo) throw new Error('硬件仓库未装载');
    const hw = await this.hwRepo.findOne({ where: { code: gatewayCode } });
    if (!hw?.addressing) throw new Error(`hardware_unit ${gatewayCode} 缺少 addressing`);
    try {
      const addr = JSON.parse(hw.addressing) as EwelinkAddressing;
      if (!addr.deviceId) throw new Error('addressing.deviceId 缺失');
      return { ...addr, uiid: addr.uiid ?? 0, channel: addr.channel ?? 0 };
    } catch (e) {
      throw new Error(`addressing 解析失败: ${(e as Error).message}`);
    }
  }

  /** 原始 params → 统一 BreakerMeasurements */
  private mapParams(params: any, channel: number): BreakerMeasurements {
    const on = this.readSwitch(params, channel);
    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    // 多数型号用 voltage/current/power；部分计量固件把单相放在 phase_0_v/c/p
    // (totalPower 为瞬时功率)，标准字段优先、缺失时回落到别名，不影响其他型号。
    const voltage = num(params.voltage ?? params.phase_0_v);
    const current = num(params.current ?? params.phase_0_c);
    const power = num(params.power ?? params.phase_0_p ?? params.totalPower);
    const energy = num(params.kwh ?? params.totalKwh ?? params.powerKwh?.total);
    return {
      voltages: [voltage, 0, 0],
      currents: [current, 0, 0],
      leakageCurrent: 0,
      powers: [power, 0, 0, power],
      energies: [energy, 0, 0, energy],
      temperatures: [0, 0, 0, 0],
      powerFactor: num(params.powerFactor ?? params.factor ?? 0),
      frequency: num(params.freq ?? 0),
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

  /** 读某通道开关态：单路 params.switch，多路 params.switches[channel].switch。
   *  注意易微联回报口径不一致：控制命令接受字符串 'on'/'off'，但部分固件
   *  (如计量开关 fw 1.2.1) 回报的是布尔 true/false；两种都必须识别，否则会
   *  把实际 on 的设备误判成 off，导致电源页状态错乱、操作看似无效。 */
  private readSwitch(params: any, channel: number): boolean {
    if (typeof params.switch === 'string') return params.switch === 'on';
    if (typeof params.switch === 'boolean') return params.switch;
    if (Array.isArray(params.switches)) {
      const hit = params.switches.find((s: any) => Number(s.outlet ?? 0) === channel);
      if (typeof hit?.switch === 'boolean') return hit.switch;
      if (typeof hit?.switch === 'string') return hit.switch === 'on';
    }
    return false;
  }

  private mockMeasurements(channel: number): BreakerMeasurements {
    return {
      voltages: [0, 0, 0],
      currents: [0, 0, 0],
      leakageCurrent: 0,
      powers: [0, 0, 0, 0],
      energies: [0, 0, 0, 0],
      temperatures: [0, 0, 0, 0],
      powerFactor: 0,
      frequency: 0,
      mode: 0,
      switchState: 'open',
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
    void channel;
  }

  static describe(): import('../driver-descriptor').DriverDescriptor {
    return {
      kind: 'ewelink-cloud',
      displayName: '易微联 eWeLink 云开关 (OAuth2.0 REST)',
      vendor: 'eWeLink',
      category: 'power-breaker-ewelink',
      protocol: 'http-json',
      capabilities: ['turn_on', 'turn_off', 'get_status', 'get_measurements', 'health_check'],
      defaultAddressing: { deviceId: '', channel: 0 },
      paramSchema: {
        deviceId: {
          type: 'string',
          label: '易微联设备 id（/v2/device/thing 返回，同步时自动写入）',
          required: true,
          placeholder: 'xxxxxxxx',
        },
        channel: { type: 'number', label: '多路插座通道 outlet（单路为 0）', default: 0 },
      },
      remark:
        '市售易微联开关/插座经酷宅云（开发者平台 dev.ewelink.cn，OAuth2.0 授权码模式）接入：' +
        '设备 /v2/device/thing、状态读写 /v2/device/thing/status。AppID/Secret 走环境变量 ' +
        'EWELINK_APP_ID/EWELINK_APP_SECRET；在集成页发起授权并点"同步设备"即可导入。' +
        '免费 AppID 限额 5 万次/月。适合后续批量采购低价易微联设备。',
    };
  }
}
