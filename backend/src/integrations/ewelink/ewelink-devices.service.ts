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

/** 云端限流（HTTP 429 / 纯文本 "invoke too fast"）专用错误，便于上层退避与友好提示 */
export class EwelinkRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EwelinkRateLimitError';
  }
}

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

/**
 * 构造「整机总开关」参数：一次下发 outlets 0..count-1 全部同值。
 * 用于 isSupportChannelSplit=false 的多路设备（官方 App 只显示一个总开关）。
 * 该类设备 denyFeatures 含 allOnOff，禁止用全开全关快捷命令，必须显式列出每一路。
 */
function buildGroupSwitchParams(
  outletCount: number,
  on: boolean,
  format: SwitchFormat,
): Record<string, unknown> {
  const value: boolean | string = format === 'boolean' ? on : on ? 'on' : 'off';
  return {
    switches: Array.from({ length: outletCount }, (_, outlet) => ({
      switch: value,
      outlet,
    })),
  };
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
  /**
   * 逻辑开关通道。普通设备 = 物理路数（单路 1 个；支持拆分的多路每路 1 个）；
   * 聚合设备（isSupportChannelSplit=false）只有 1 个「总开关」（channel=0，on=全部物理路闭合）。
   */
  channels: EwelinkSwitchChannel[];
  /** 该设备控制值口径（同步时写入 addressing） */
  switchFormat: SwitchFormat;
  /** 厂商是否支持把多路独立拆分成多个开关（itemData.isSupportChannelSplit） */
  isSupportChannelSplit: boolean;
  /** 是否聚合为一个总开关（物理多路、但官方 App 只呈现一个总开关） */
  grouped: boolean;
  /** 物理路数（outlet 数）；聚合整组下发时用到 */
  outletCount: number;
}

export interface SyncResult {
  scanned: number;
  imported: number;
  circuits: number;
  disabledUnits: number;
  disabledCircuits: number;
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

  // ============ 云端限流保护 ============
  // 官方限流：同一 IP 任意两次请求间隔 ≥500ms、5 分钟 ≤300 次。
  // 所有读写共用一个队列，并在 412 限流后进入冷却，避免多个页面/后台任务继续撞接口。
  private readonly paramsCache = new Map<string, { at: number; params: any }>();
  private static readonly PARAMS_CACHE_TTL_MS = 12_000;
  private static readonly MIN_CLOUD_GAP_MS = 600;
  private static readonly RATE_WINDOW_MS = 5 * 60 * 1000;
  private static readonly MAX_CALLS_PER_WINDOW = 300;
  private static readonly RATE_COOLDOWN_MS = 5 * 60 * 1000;
  private cloudChain: Promise<unknown> = Promise.resolve();
  private lastCloudCallAt = 0;
  private cloudCallTimes: number[] = [];
  private cloudCooldownUntil = 0;

  private async waitForCloudBudget(): Promise<void> {
    for (;;) {
      const now = Date.now();
      if (this.cloudCooldownUntil > now) {
        throw new EwelinkRateLimitError('易微联云接口正在限流冷却，请稍后再试');
      }
      this.cloudCallTimes = this.cloudCallTimes.filter(
        (at) => now - at < EwelinkDevicesService.RATE_WINDOW_MS,
      );
      const minGapUntil = this.lastCloudCallAt + EwelinkDevicesService.MIN_CLOUD_GAP_MS;
      const windowUntil = this.cloudCallTimes.length >= EwelinkDevicesService.MAX_CALLS_PER_WINDOW
        ? this.cloudCallTimes[0] + EwelinkDevicesService.RATE_WINDOW_MS
        : 0;
      const until = Math.max(minGapUntil, windowUntil);
      if (until <= now) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(until - now, 1000)));
    }
  }

  private markCloudRateLimited(message: string): void {
    this.cloudCooldownUntil = Math.max(
      this.cloudCooldownUntil,
      Date.now() + EwelinkDevicesService.RATE_COOLDOWN_MS,
    );
    this.logger.warn(`易微联云接口进入限流冷却: ${message.slice(0, 120)}`, {
      context: 'EwelinkDevicesService',
    });
  }

  /** 把云端调用排入全局串行队列，并保证官方频率窗口不被突破。 */
  private async throughCloud<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.waitForCloudBudget();
      this.lastCloudCallAt = Date.now();
      this.cloudCallTimes.push(this.lastCloudCallAt);
      return fn();
    };
    const queued = this.cloudChain.then(run, run);
    this.cloudChain = queued.then(() => undefined, () => undefined);
    return queued;
  }

  /** 清掉某设备缓存（控制后由乐观更新接管，不额外发请求） */
  private invalidateCache(deviceId: string): void {
    this.paramsCache.delete(deviceId);
  }

  /** 按原回报口径给 on 值（布尔设备给布尔，字符串设备给 'on'/'off'） */
  private static onValueFor(existing: unknown, on: boolean): boolean | string {
    return typeof existing === 'boolean' ? on : on ? 'on' : 'off';
  }

  /** 控制成功后乐观更新缓存（单路），保证 UI 即时回显且不额外触发云请求 */
  private optimisticSingle(deviceId: string, channel: number, on: boolean): void {
    const c = this.paramsCache.get(deviceId);
    if (!c) return;
    const p = c.params ?? {};
    if (channel === 0 && p.switch !== undefined && p.switch !== null) {
      p.switch = EwelinkDevicesService.onValueFor(p.switch, on);
    } else if (Array.isArray(p.switches)) {
      const hit = p.switches.find((s: any) => Number(s.outlet ?? 0) === channel);
      if (hit) hit.switch = EwelinkDevicesService.onValueFor(hit.switch, on);
    }
    c.at = Date.now();
    c.params = p;
  }

  /** 控制成功后乐观更新缓存（整组总开关，0..outletCount-1 全部同值） */
  private optimisticGroup(deviceId: string, outletCount: number, on: boolean): void {
    const c = this.paramsCache.get(deviceId);
    if (!c) return;
    const p = c.params ?? {};
    if (Array.isArray(p.switches)) {
      for (let i = 0; i < outletCount; i += 1) {
        const hit = p.switches.find((s: any) => Number(s.outlet ?? 0) === i);
        if (hit) hit.switch = EwelinkDevicesService.onValueFor(hit.switch, on);
      }
    }
    c.at = Date.now();
    c.params = p;
  }

  // ============ 云端读取 ============

  /** 拉全部 Thing，筛出开关类（params 带 switch / switches） */
  async listSwitchThings(): Promise<EwelinkSwitchThing[]> {
    const { token, region, familyId } = await this.auth.ensureAccessToken();
    const query = new URLSearchParams({ num: '0' });
    const json = await this.throughCloud(() =>
      this.signedGet(region, '/v2/device/thing', query, token),
    );
    if (json.error !== 0) throw new BadRequestException(`拉易微联设备失败: ${json.msg ?? json.error}`);
    const list: any[] = json.data?.thingList ?? [];
    const normalized = list
      .map((t) => this.normalize(t, familyId))
      .filter((t): t is EwelinkSwitchThing => t !== null);
    // 某些家庭/设备列表响应会把同一 deviceid 返回多次；同一物理设备只保留一份，
    // 否则管理页会重复呈现，后续同步还会反复覆盖同一条台账。
    const unique = new Map<string, EwelinkSwitchThing>();
    for (const thing of normalized) {
      const previous = unique.get(thing.deviceId);
      if (!previous) {
        unique.set(thing.deviceId, thing);
        continue;
      }
      // 同一设备重复返回时优先保留聚合视图，其次保留物理路数更多、在线的那份。
      const score = (x: EwelinkSwitchThing): number =>
        (x.grouped ? 1000 : 0) + (x.online ? 100 : 0) + x.outletCount;
      if (score(thing) > score(previous)) unique.set(thing.deviceId, thing);
    }
    return [...unique.values()];
  }

  /**
   * 读单台设备原始 params（/v2/device/thing/status type=1）。
   * TTL 内命中缓存直接返回（同一物理设备多个逻辑回路共享，避免重复云请求）；
   * 未命中则排入全局串行队列（≥550ms 间隔）。force=true 强制刷新。
   */
  async getRawParams(
    deviceId: string,
    opts: { force?: boolean } = {},
  ): Promise<{ params: any }> {
    const hit = (): { params: any } | null => {
      const c = this.paramsCache.get(deviceId);
      if (!opts.force && c && Date.now() - c.at < EwelinkDevicesService.PARAMS_CACHE_TTL_MS) {
        return { params: c.params };
      }
      return null;
    };
    const cached = hit();
    if (cached) return cached;
    return this.throughCloud(async () => {
      // 排队结束后二次确认：可能在等待期间已被其他请求刷新
      const cached2 = hit();
      if (cached2) return cached2;
      const { token, region } = await this.auth.ensureAccessToken();
      const query = new URLSearchParams({ id: deviceId, type: '1' });
      const json = await this.signedGet(region, '/v2/device/thing/status', query, token);
      if (json.error !== 0) {
        throw new BadRequestException(`读设备状态失败: ${json.msg ?? json.error}`);
      }
      const params = json.data?.params ?? {};
      this.paramsCache.set(deviceId, { at: Date.now(), params });
      return { params };
    });
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
    await this.throughCloud(async () => {
      let last: { error: number; msg?: string } | null = null;
      for (let i = 0; i < formats.length; i += 1) {
        const body = {
          type: 1,
          id: deviceId,
          params: buildSwitchParams(channel, on, formats[i]),
        };
        const json = await this.postThingStatus(region, body, token, appId);
        if (json.error === 0) {
          this.optimisticSingle(deviceId, channel, on);
          return;
        }
        last = json;
        if (json.error !== 4002) break; // 非参数协议错误，不换口径
      }
      this.invalidateCache(deviceId);
      throw new BadRequestException(`易微联控制失败: ${last?.msg ?? last?.error}`);
    });
  }

  /**
   * 控制整机总开关（聚合设备）：一次显式下发 0..outletCount-1 全部同值。
   * 该类设备 denyFeatures 含 allOnOff，不能用全开全关快捷命令，必须逐路列出。
   */
  async setGroupSwitch(
    deviceId: string,
    uiid: number,
    outletCount: number,
    on: boolean,
    format?: SwitchFormat,
  ): Promise<void> {
    const { token, region } = await this.auth.ensureAccessToken();
    const { appId } = await this.auth.getCredentials();
    void uiid;
    const formats: SwitchFormat[] = format ? [format] : ['string', 'boolean'];
    await this.throughCloud(async () => {
      let last: { error: number; msg?: string } | null = null;
      for (let i = 0; i < formats.length; i += 1) {
        const body = {
          type: 1,
          id: deviceId,
          params: buildGroupSwitchParams(outletCount, on, formats[i]),
        };
        const json = await this.postThingStatus(region, body, token, appId);
        if (json.error === 0) {
          this.optimisticGroup(deviceId, outletCount, on);
          return;
        }
        last = json;
        if (json.error !== 4002) break;
      }
      this.invalidateCache(deviceId);
      throw new BadRequestException(`易微联总开关控制失败: ${last?.msg ?? last?.error}`);
    });
  }

  /** POST /v2/device/thing/status（用户分类接口，带 X-CK-Appid；单次应用层命令） */
  private async postThingStatus(
    region: string,
    body: Record<string, unknown>,
    token: string,
    appId: string,
  ): Promise<{ error: number; msg?: string }> {
    const host = apiHostForRegion(region);
    return this.cloudFetch(
      `${host}/v2/device/thing/status`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-CK-Appid': appId,
          'X-CK-Nonce': makeNonce(8),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      },
      '控制',
    );
  }

  /**
   * 统一云端 fetch：识别 HTTP 429、纯文本限流和 JSON error=412。
   * 412 进入冷却后直接失败，不做立即重试，避免把云端限流窗口越撞越长。
   */
  private async cloudFetch(
    url: string,
    init: RequestInit,
    action: string,
  ): Promise<any> {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let attempt = 0; ; attempt += 1) {
      const resp = await fetch(url, init);
      const text = await resp.text();
      const rateLimited =
        resp.status === 429 || /invoke too fast/i.test(text);
      if (rateLimited) {
        if (attempt < 2) {
          await sleep(700 * (attempt + 1) + Math.floor(Math.random() * 300));
          continue;
        }
        const message = text.trim().slice(0, 60) || String(resp.status);
        this.markCloudRateLimited(message);
        throw new EwelinkRateLimitError(`易微联云接口限流，请稍后再试（${message}）`);
      }
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new BadRequestException(
          `易微联${action}返回异常（HTTP ${resp.status}）: ${text.trim().slice(0, 80) || '空响应'}`,
        );
      }
      const jsonRateLimited = json?.error === 412
        || /invoke too (much|fast)/i.test(String(json?.msg ?? ''));
      if (jsonRateLimited) {
        const message = String(json?.msg ?? 'error=412');
        this.markCloudRateLimited(message);
        throw new EwelinkRateLimitError(`易微联云接口限流，请稍后再试（${message.slice(0, 80)}）`);
      }
      return json;
    }
  }

  // ============ 同步进本地台账 ============

  /** 易微联云开关统一归入「展贸中心 1F」分区（业主 2026-10-21 拍板：四路展厅灯不放户外） */
  private static readonly CATALOG_FLOOR = '1F';

  /** 把云端开关设备 upsert 成 hardware_unit + power_circuit（幂等，按 deviceId/通道） */
  async syncToCatalog(): Promise<SyncResult> {
    const things = await this.listSwitchThings();
    const result: SyncResult = {
      scanned: things.length,
      imported: 0,
      circuits: 0,
      disabledUnits: 0,
      disabledCircuits: 0,
      skipped: [],
    };
    for (const t of things) {
      if (!t.online) {
        result.skipped.push(`${t.name}（离线，跳过）`);
        continue;
      }
      const short = t.deviceId.slice(-8);
      // 聚合设备（isSupportChannelSplit=false）只有 1 个总开关 → 1 个硬件单元/回路；
      // 支持拆分的多路才每通道一个；单路 1 个。
      for (const ch of t.channels) {
        const grouped = t.grouped;
        const suffix = grouped || t.channels.length === 1 ? '' : `-${ch.channel + 1}`;
        const unitCode = `EWE-${short}${suffix}`;
        const circuitCode = `ewelink-${short}${suffix}`;
        const displayName = grouped || t.channels.length === 1 ? t.name : `${t.name} ${ch.channel + 1}`;

        let unit = await this.hwRepo.findOne({ where: { code: unitCode } });
        const addressingObj: Record<string, unknown> = {
          deviceId: t.deviceId,
          familyId: t.familyId,
          uiid: t.uiid,
          channel: ch.channel,
          switchFormat: t.switchFormat,
        };
        if (grouped) {
          addressingObj.grouped = true;
          addressingObj.outletCount = t.outletCount;
        }
        const addressing = JSON.stringify(addressingObj);
        if (!unit) {
          unit = this.hwRepo.create({
            code: unitCode,
            name: displayName,
            category: 'power-breaker-ewelink',
            vendor: '易微联 eWeLink',
            model: `UIID ${t.uiid}`,
            driverKind: 'ewelink-cloud',
            addressing,
            floor: EwelinkDevicesService.CATALOG_FLOOR,
            enabled: true,
            status: 'normal',
          });
          await this.hwRepo.save(unit);
          result.imported += 1;
        } else {
          unit.name = displayName;
          unit.addressing = addressing;
          unit.floor = EwelinkDevicesService.CATALOG_FLOOR;
          unit.status = 'normal';
          await this.hwRepo.save(unit);
        }

        let circuit = await this.circuitRepo.findOne({ where: { code: circuitCode } });
        if (!circuit) {
          circuit = this.circuitRepo.create({
            code: circuitCode,
            name: displayName,
            floor: EwelinkDevicesService.CATALOG_FLOOR,
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
          circuit.floor = EwelinkDevicesService.CATALOG_FLOOR;
          await this.circuitRepo.save(circuit);
        }

        // 旧版本曾把不可拆分群组写成 -1/-2/-3/-4 多张卡。同步到新聚合卡后，
        // 必须软禁用同一 deviceId 的旧记录，否则它们仍会出现在电源页且寻址不可控。
        if (grouped) {
          await this.disableStaleGroupedEntries(t.deviceId, unitCode, circuitCode, result);
        }
      }
    }
    this.logger.info(
      `[eWeLink] 同步完成: 新增设备${result.imported} 新增回路${result.circuits} `
        + `停用旧设备${result.disabledUnits} 停用旧回路${result.disabledCircuits} 跳过${result.skipped.length}`,
      { context: 'EwelinkDevicesService' },
    );
    return result;
  }

  /**
   * 收敛同一易微联设备的旧拆分台账：只软禁用，不删除历史数据。
   * 既按 addressing.deviceId 匹配，也按旧版稳定 code 前缀兜底，兼容早期缺失寻址的记录。
   */
  private async disableStaleGroupedEntries(
    deviceId: string,
    expectedUnitCode: string,
    expectedCircuitCode: string,
    result: SyncResult,
  ): Promise<void> {
    const short = deviceId.slice(-8);
    const oldUnitPrefix = `EWE-${short}-`;
    const oldCircuitPrefix = `ewelink-${short}-`;
    const units = await this.hwRepo.find({ where: { category: 'power-breaker-ewelink' } });
    const staleUnits = units.filter((unit) => {
      if (!unit.enabled || unit.code === expectedUnitCode) return false;
      if (unit.code.startsWith(oldUnitPrefix)) return true;
      try {
        const addressing = unit.addressing ? JSON.parse(unit.addressing) : null;
        return addressing?.deviceId === deviceId;
      } catch {
        return false;
      }
    });
    for (const unit of staleUnits) {
      unit.enabled = false;
      await this.hwRepo.save(unit);
      result.disabledUnits += 1;
      const circuits = await this.circuitRepo.find({ where: { gatewayCode: unit.code } });
      for (const circuit of circuits) {
        if (!circuit.enabled) continue;
        circuit.enabled = false;
        await this.circuitRepo.save(circuit);
        result.disabledCircuits += 1;
      }
    }

    // 兜底处理旧回路残留（例如硬件单元曾被人工删除，但回路仍在）。
    const circuits = await this.circuitRepo.find({ where: { category: 'lighting' } });
    for (const circuit of circuits) {
      if (!circuit.enabled || circuit.code === expectedCircuitCode || !circuit.code.startsWith(oldCircuitPrefix)) continue;
      circuit.enabled = false;
      await this.circuitRepo.save(circuit);
      result.disabledCircuits += 1;
    }
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
    const deviceId = String(t.deviceid ?? t.id ?? '');
    const name = String(t.name ?? deviceId);
    const uiid = Number(t.extra?.uiid ?? t.uiid ?? 0);

    // 厂商是否支持把多路独立拆成多个开关。字段缺失时按「支持拆分」处理（兼容旧设备）。
    const splitRaw = t.isSupportChannelSplit ?? t.extra?.isSupportChannelSplit ?? params.isSupportChannelSplit;
    const denyFeatures = t.denyFeatures ?? t.extra?.denyFeatures ?? params.denyFeatures;
    const hasGroupedDenyFeature = Array.isArray(denyFeatures)
      && denyFeatures.some((feature: unknown) => String(feature).toLowerCase() === 'allonoff');
    const isSupportChannelSplit = splitRaw === undefined || splitRaw === null
      ? !hasGroupedDenyFeature
      : EwelinkDevicesService.parseBoolean(splitRaw, true);

    // 单路设备（顶层 params.switch）
    if (params.switch !== undefined && params.switch !== null) {
      return {
        deviceId, name, uiid,
        online: !!t.online,
        familyId: (t.family?.familyid as string) ?? familyId,
        channels: [{ channel: 0, on: EwelinkDevicesService.isOn(params.switch) }],
        switchFormat: detectSwitchFormat(params),
        isSupportChannelSplit: true,
        grouped: false,
        outletCount: 1,
      };
    }

    // 多路设备（params.switches[]）
    if (Array.isArray(params.switches) && params.switches.length > 0) {
      const physicalByOutlet = new Map<number, boolean>();
      for (const s of params.switches) {
        const outlet = Number(s?.outlet);
        if (!Number.isInteger(outlet) || outlet < 0) continue;
        // 云端偶尔重复回报同一个 outlet，后出现的状态视为最新值。
        physicalByOutlet.set(outlet, EwelinkDevicesService.isOn(s?.switch));
      }
      const physical: { outlet: number; on: boolean }[] = [...physicalByOutlet.entries()]
        .map(([outlet, on]) => ({ outlet, on }))
        .sort((a, b) => a.outlet - b.outlet);
      const outletCount = physical.length;
      if (outletCount === 0) return null;
      if (!isSupportChannelSplit) {
        // 聚合：官方 App 只呈现一个总开关。总开关 on = 所有物理路都闭合。
        const allOn = physical.every((p) => p.on);
        return {
          deviceId, name, uiid,
          online: !!t.online,
          familyId: (t.family?.familyid as string) ?? familyId,
          channels: [{ channel: 0, on: allOn }],
          switchFormat: detectSwitchFormat(params),
          isSupportChannelSplit: false,
          grouped: true,
          outletCount,
        };
      }
      // 支持拆分：每个 outlet 一个独立逻辑通道（保持原行为）
      return {
        deviceId, name, uiid,
        online: !!t.online,
        familyId: (t.family?.familyid as string) ?? familyId,
        channels: physical.map((p) => ({ channel: p.outlet, on: p.on })),
        switchFormat: detectSwitchFormat(params),
        isSupportChannelSplit: true,
        grouped: false,
        outletCount,
      };
    }

    return null;
  }

  private static parseBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['false', '0', 'no', 'off', 'n'].includes(normalized)) return false;
      if (['true', '1', 'yes', 'on', 'y'].includes(normalized)) return true;
    }
    return fallback;
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
    return this.cloudFetch(
      `${host}${path}?${query.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'X-CK-Appid': appId },
        signal: AbortSignal.timeout(12_000),
      },
      '查询',
    );
  }
}
