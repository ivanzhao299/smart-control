import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { apiHostForRegion, makeApiSign, makeNonce } from './ewelink-crypto';
import { EwelinkAuthService } from './ewelink-auth.service';

/** 开关值口径：标准协议为字符串 'on'/'off'；部分固件（如 UIID 226 fw 1.2.1）控制与回报均为布尔 */
export type SwitchFormat = 'boolean' | 'string';

/** 按口径构造一路开关参数（单路 params.switch；多路 params.switches[].outlet） */
function buildSwitchParams(
  channel: number,
  on: boolean,
  format: SwitchFormat,
): Record<string, unknown> {
  const value: boolean | string = format === 'boolean' ? on : on ? 'on' : 'off';
  return channel === 0
    ? { switch: value }
    : { switches: [{ switch: value, outlet: channel }] };
}

/** 从设备 params 推断开关口径（布尔/字符串），无法判断时回落标准字符串 */
function detectSwitchFormat(params: any): SwitchFormat {
  if (Array.isArray(params.switches) && params.switches.length > 0) {
    return typeof params.switches[0].switch === 'boolean' ? 'boolean' : 'string';
  }
  return typeof params.switch === 'boolean' ? 'boolean' : 'string';
}

/** 标准化的一路开关 */
export interface EwelinkSwitchChannel {
  /** outlet，单路为 0 */
  channel: number;
  on: boolean;
}

/** 标准化的开关类设备 */
export interface EwelinkSwitchThing {
  deviceId: string;
  name: string;
  uiid: number;
  online: boolean;
  familyId: string | null;
  channels: EwelinkSwitchChannel[];
  /** 该设备控制值口径（同步时写入 addressing） */
  switchFormat: SwitchFormat;
}

export interface SyncResult {
  scanned: number;
  imported: number;
  circuits: number;
  skipped: string[];
}

/**
 * eWeLink 设备服务：拉 Thing 列表、读/写开关状态、把开关设备同步进硬件台账与电源回路。
 */
@Injectable()
export class EwelinkDevicesService {
  constructor(
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    @InjectRepository(PowerCircuit) private readonly circuitRepo: Repository<PowerCircuit>,
    private readonly auth: EwelinkAuthService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  // ============ 云端读取 ============

  /** 拉全部 Thing，筛出开关类（params 带 switch / switches） */
  async listSwitchThings(): Promise<EwelinkSwitchThing[]> {
    const { token, region, familyId } = await this.auth.ensureAccessToken();
    const query = new URLSearchParams({ num: '0' });
    const json = await this.signedGet(region, '/v2/device/thing', query, token);
    if (json.error !== 0) throw new BadRequestException(`拉易微联设备失败: ${json.msg ?? json.error}`);
    const list: any[] = json.data?.thingList ?? [];
    return list
      .map((t) => this.normalize(t, familyId))
      .filter((t): t is EwelinkSwitchThing => t !== null);
  }

  /** 读单台设备原始 params（/v2/device/thing/status type=1） */
  async getRawParams(deviceId: string): Promise<{ params: any }> {
    const { token, region } = await this.auth.ensureAccessToken();
    const query = new URLSearchParams({ id: deviceId, type: '1' });
    const json = await this.signedGet(region, '/v2/device/thing/status', query, token);
    if (json.error !== 0) {
      throw new BadRequestException(`读设备状态失败: ${json.msg ?? json.error}`);
    }
    return { params: json.data?.params ?? {} };
  }

  /** 读单台设备的最新开关状态 */
  async getThing(deviceId: string): Promise<EwelinkSwitchThing> {
    const { familyId } = await this.auth.ensureAccessToken();
    const { params } = await this.getRawParams(deviceId);
    const normalized = this.normalize(
      { id: deviceId, uiid: 0, online: true, params },
      familyId,
    );
    if (!normalized) throw new BadRequestException('该设备不是开关类');
    return normalized;
  }

  /**
   * 控制一路开关。
   * format 已知时按设备口径一次下发；未知时先标准字符串，仅当 4002（参数协议/设备控制失败）
   * 才用布尔口径兜底重试，避免给标准设备造成多余请求。
   */
  async setSwitch(
    deviceId: string,
    uiid: number,
    channel: number,
    on: boolean,
    format?: SwitchFormat,
  ): Promise<void> {
    const { token, region } = await this.auth.ensureAccessToken();
    const { appId } = await this.auth.getCredentials();
    void uiid;
    const formats: SwitchFormat[] = format ? [format] : ['string', 'boolean'];
    let last: { error: number; msg?: string } | null = null;
    for (let i = 0; i < formats.length; i += 1) {
      const body = {
        type: 1,
        id: deviceId,
        params: buildSwitchParams(channel, on, formats[i]),
      };
      const json = await this.postThingStatus(region, body, token, appId);
      if (json.error === 0) return;
      last = json;
      if (json.error !== 4002) break; // 非参数协议错误，不换口径
    }
    throw new BadRequestException(`易微联控制失败: ${last?.msg ?? last?.error}`);
  }

  /** POST /v2/device/thing/status（用户分类接口，带 X-CK-Appid；单次应用层命令） */
  private async postThingStatus(
    region: string,
    body: Record<string, unknown>,
    token: string,
    appId: string,
  ): Promise<{ error: number; msg?: string }> {
    const host = apiHostForRegion(region);
    const resp = await fetch(`${host}/v2/device/thing/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-CK-Appid': appId,
        'X-CK-Nonce': makeNonce(8),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    return (await resp.json()) as { error: number; msg?: string };
  }

  // ============ 同步进本地台账 ============

  /** 把云端开关设备 upsert 成 hardware_unit + power_circuit（幂等，按 deviceId/通道） */
  async syncToCatalog(): Promise<SyncResult> {
    const things = await this.listSwitchThings();
    const result: SyncResult = { scanned: things.length, imported: 0, circuits: 0, skipped: [] };
    for (const t of things) {
      if (!t.online) {
        result.skipped.push(`${t.name}（离线，跳过）`);
        continue;
      }
      const short = t.deviceId.slice(-8);
      // 每通道一个硬件单元：gatewayCode 唯一确定 deviceId + channel，适配器无需额外参数
      for (const ch of t.channels) {
        const suffix = t.channels.length === 1 ? '' : `-${ch.channel + 1}`;
        const unitCode = `EWE-${short}${suffix}`;
        const circuitCode = `ewelink-${short}${suffix}`;
        const displayName = t.channels.length === 1 ? t.name : `${t.name} ${ch.channel + 1}`;

        let unit = await this.hwRepo.findOne({ where: { code: unitCode } });
        const addressing = JSON.stringify({
          deviceId: t.deviceId,
          familyId: t.familyId,
          uiid: t.uiid,
          channel: ch.channel,
          switchFormat: t.switchFormat,
        });
        if (!unit) {
          unit = this.hwRepo.create({
            code: unitCode,
            name: displayName,
            category: 'power-breaker-ewelink',
            vendor: '易微联 eWeLink',
            model: `UIID ${t.uiid}`,
            driverKind: 'ewelink-cloud',
            addressing,
            floor: '户外',
            enabled: true,
            status: 'normal',
          });
          await this.hwRepo.save(unit);
          result.imported += 1;
        } else {
          unit.name = displayName;
          unit.addressing = addressing;
          unit.status = 'normal';
          await this.hwRepo.save(unit);
        }

        let circuit = await this.circuitRepo.findOne({ where: { code: circuitCode } });
        if (!circuit) {
          circuit = this.circuitRepo.create({
            code: circuitCode,
            name: displayName,
            floor: '户外',
            category: 'lighting',
            gatewayCode: unitCode,
            relayChannel: ch.channel + 1,
            meterAddress: null,
            ratedVoltage: 220,
            ratedCurrent: 16,
            ratedPower: 0,
            sortOrder: 100,
            icon: 'Zap',
            enabled: true,
          });
          await this.circuitRepo.save(circuit);
          result.circuits += 1;
        } else {
          circuit.name = displayName;
          circuit.gatewayCode = unitCode;
          circuit.relayChannel = ch.channel + 1;
          await this.circuitRepo.save(circuit);
        }
      }
    }
    this.logger.info(
      `[eWeLink] 同步完成: 设备${result.imported} 回路${result.circuits} 跳过${result.skipped.length}`,
      { context: 'EwelinkDevicesService' },
    );
    return result;
  }

  // ============ 内部 ============

  /** 开关状态兼容：字符串 "on"/"off" 或布尔 true/false */
  private static isOn(v: unknown): boolean {
    return v === true || v === 'on';
  }

  private normalize(raw: any, familyId: string | null): EwelinkSwitchThing | null {
    // 真实 thingList 结构为 {itemType, itemData:{...}}，兼容平铺写法
    const t = raw && raw.itemData ? raw.itemData : raw;
    const params = t.params ?? {};
    const channels: EwelinkSwitchChannel[] = [];
    // 多路优先用 switches[]；否则用单路 switch（顶层）
    if (Array.isArray(params.switches) && params.switches.length > 0) {
      for (const s of params.switches) {
        channels.push({
          channel: Number(s.outlet ?? 0),
          on: EwelinkDevicesService.isOn(s.switch),
        });
      }
    } else if (params.switch !== undefined && params.switch !== null) {
      channels.push({ channel: 0, on: EwelinkDevicesService.isOn(params.switch) });
    }
    if (channels.length === 0) return null;
    channels.sort((a, b) => a.channel - b.channel);
    const deviceId = String(t.deviceid ?? t.id ?? '');
    return {
      deviceId,
      name: String(t.name ?? deviceId),
      uiid: Number(t.extra?.uiid ?? t.uiid ?? 0),
      online: !!t.online,
      // 设备自带 family 优先，回落到当前家庭
      familyId: (t.family?.familyid as string) ?? familyId,
      channels,
      switchFormat: detectSwitchFormat(params),
    };
  }

  private async signedGet(
    region: string,
    path: string,
    query: URLSearchParams,
    token: string,
  ): Promise<{ error: number; msg?: string; data?: any }> {
    // GET 签名：除 sign 外参数按名字母序以 & 连接
    const { appId, appSecret } = await this.auth.getCredentials();
    const pairs = [...query.entries()].sort(([a], [b]) => a.localeCompare(b));
    const canonical = pairs.map(([k, v]) => `${k}=${v}`).join('&');
    query.set('sign', makeApiSign(appSecret, canonical));
    const host = apiHostForRegion(region);
    const resp = await fetch(`${host}${path}?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-CK-Appid': appId },
      signal: AbortSignal.timeout(12_000),
    });
    return (await resp.json()) as any;
  }
}
