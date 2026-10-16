import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  HperforApiAdapter,
  HperforPlatformDevice,
} from '../../adapters/power/hperfor-api.adapter';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { PowerCircuit } from '../../entities/power-circuit.entity';

/** 华普云 4G 断路器在硬件台账里的固定类别 / 驱动 / 厂商 */
const HARDWARE_CATEGORY = 'power-breaker-web';
const DRIVER_KIND = 'hperfor-web';
const VENDOR = 'ePa';
const MODEL = 'ePa-CB (内置 4G)';
const DEFAULT_FLOOR = '园区';
const DEFAULT_PASSWORD = '0';
/** 新同步回路排序起点（既有路灯到 250，新台在其后递增 10） */
const SORT_BASE = 200;

export interface HperforCatalogEntry extends HperforPlatformDevice {
  /** 系统里是否已登记（按 fId 匹配） */
  registered: boolean;
  unitCode: string | null;
  circuitCode: string | null;
}

export interface HperforDeviceList {
  mock: boolean;
  configured: boolean;
  devices: HperforCatalogEntry[];
}

export interface HperforStatus {
  /** 本地 mock 模式（无真实平台，不触网） */
  mock: boolean;
  /** 是否配置了平台账号（HPERFOR_API_USERNAME/PASSWORD） */
  configured: boolean;
  /** 已登记的华普云断路器数量 */
  registeredCount: number;
}

export interface HperforSyncResult {
  /** 平台扫描到的设备数 */
  scanned: number;
  /** 新增设备数 */
  imported: number;
  /** 新增回路数 */
  circuits: number;
  /** 已存在、本次仅刷新名称/坐标的设备数 */
  updated: number;
  /** 跳过原因（离线等） */
  skipped: string[];
}

interface RegisteredRef {
  unitCode: string;
  circuitCode: string | null;
  unitId: number;
}

/**
 * 华普云 HPERFOR 设备同步（仿易微联）。
 *
 * 平台新增 ePa-CB 4G 断路器后，在平台命名好、设备通电上线，后台点「同步设备」即可
 * 幂等登记为 hardware_unit + power_circuit，无需再写代码迁移。
 *
 * 去重以平台 fId 为准（addressing.fId），不是 code：
 *   - 历史 6 台是语义化 code（CB4G-SIGN-1 等），同步时只刷新名称/坐标，绝不重建、不改 code；
 *   - 新台 code 自动取 CB4G-<fNumber> / hperfor-<fNumber小写>，保证唯一且稳定；
 *   - 离线设备跳过（避免导入无法控制的死设备）。
 */
@Injectable()
export class HperforDevicesService {
  private readonly logger = new Logger('HperforDevicesService');

  constructor(
    private readonly platform: HperforApiAdapter,
    @InjectRepository(HardwareUnit)
    private readonly hwRepo: Repository<HardwareUnit>,
    @InjectRepository(PowerCircuit)
    private readonly circuitRepo: Repository<PowerCircuit>,
  ) {}

  /** 接入状态：本地 mock / 平台账号是否配置 / 已登记数量 */
  async status(): Promise<HperforStatus> {
    const registeredCount = await this.hwRepo.count({
      where: { category: HARDWARE_CATEGORY, enabled: true },
    });
    return {
      mock: this.platform.isMockMode(),
      configured: this.platform.isConfigured(),
      registeredCount,
    };
  }

  /** 平台设备清单 + 是否已登记标记（按 fId 匹配，保护既有设备） */
  async listDevices(): Promise<HperforDeviceList> {
    const mock = this.platform.isMockMode();
    const configured = this.platform.isConfigured();
    if (mock) return { mock, configured, devices: [] };
    const remote = await this.platform.listPlatformDevices();
    const byFId = await this.mapRegisteredByFId();
    const devices: HperforCatalogEntry[] = remote.map((d) => {
      const reg = byFId.get(d.fId);
      return {
        ...d,
        registered: !!reg,
        unitCode: reg?.unitCode ?? null,
        circuitCode: reg?.circuitCode ?? null,
      };
    });
    return { mock, configured, devices };
  }

  /**
   * 同步：把平台在线设备幂等登记为 hardware_unit + power_circuit。
   * 已存在（按 fId）只刷新名称/坐标，新台建 unit+circuit，离线跳过。
   */
  async syncToCatalog(): Promise<HperforSyncResult> {
    if (this.platform.isMockMode()) {
      throw new ConflictException('当前为本地 MOCK 模式（未配置华普云账号），无法同步真实设备');
    }
    const remote = await this.platform.listPlatformDevices();
    const registered = await this.mapRegisteredByFId();

    const result: HperforSyncResult = {
      scanned: remote.length,
      imported: 0,
      circuits: 0,
      updated: 0,
      skipped: [],
    };

    // 现有华普云回路最大 sort_order，新台在其后递增 10，避免与既有排序冲突
    const refs = [...registered.values()];
    const unitCodes = refs.map((r) => r.unitCode);
    const existingCircuits = unitCodes.length
      ? await this.circuitRepo.find({ where: { gatewayCode: In(unitCodes) } })
      : [];
    let nextSort = existingCircuits.reduce((m, c) => Math.max(m, c.sortOrder), SORT_BASE);

    for (const d of remote) {
      if (!d.online) {
        result.skipped.push(`${d.fName}（离线）`);
        continue;
      }
      const existing = registered.get(d.fId);
      if (existing) {
        await this.updateExisting(existing, d);
        result.updated += 1;
        continue;
      }
      nextSort += 10;
      await this.importNew(d, nextSort);
      result.imported += 1;
      result.circuits += 1;
    }
    this.logger.log(
      `华普云同步：扫描 ${result.scanned}，新增 ${result.imported}，更新 ${result.updated}，` +
        `跳过离线 ${result.skipped.length}`,
    );
    return result;
  }

  /** 平台 fId → 已登记的 unit/circuit 引用（只查 power-breaker-web，解析 addressing.fId） */
  private async mapRegisteredByFId(): Promise<Map<string, RegisteredRef>> {
    const units = await this.hwRepo.find({ where: { category: HARDWARE_CATEGORY } });
    const unitCodes = units.map((u) => u.code);
    const circuits = unitCodes.length
      ? await this.circuitRepo.find({ where: { gatewayCode: In(unitCodes) } })
      : [];
    const circuitByUnit = new Map<string, string>();
    for (const c of circuits) {
      if (c.gatewayCode) circuitByUnit.set(c.gatewayCode, c.code);
    }

    const map = new Map<string, RegisteredRef>();
    for (const u of units) {
      const fId = this.extractFId(u.addressing);
      if (!fId) continue;
      map.set(fId, {
        unitCode: u.code,
        circuitCode: circuitByUnit.get(u.code) ?? null,
        unitId: u.id,
      });
    }
    return map;
  }

  private extractFId(addressing: string | null): string | null {
    if (!addressing) return null;
    try {
      const obj = JSON.parse(addressing) as { fId?: string | number };
      return obj.fId ? String(obj.fId) : null;
    } catch {
      return null;
    }
  }

  private buildAddressing(d: HperforPlatformDevice): string {
    return JSON.stringify({
      fId: d.fId,
      password: d.password || DEFAULT_PASSWORD,
      lat: d.lat,
      lng: d.lng,
    });
  }

  /** 已登记设备：平台改名/坐标变化时刷新，code 与人工配置一律不动 */
  private async updateExisting(existing: RegisteredRef, d: HperforPlatformDevice): Promise<void> {
    const unit = await this.hwRepo.findOne({ where: { id: existing.unitId } });
    if (unit) {
      const platformName = d.fName || d.fNumber;
      if (platformName && !unit.name.includes(platformName)) {
        unit.name = `${platformName} 4G 断路器`;
      }
      unit.addressing = this.buildAddressing(d);
      if (d.fNumber) unit.serialNo = d.fNumber;
      if (d.location) unit.location = d.location;
      unit.status = 'normal';
      await this.hwRepo.save(unit);
    }
    if (existing.circuitCode) {
      const circuit = await this.circuitRepo.findOne({ where: { code: existing.circuitCode } });
      if (circuit && d.fName) {
        circuit.name = d.fName;
        await this.circuitRepo.save(circuit);
      }
    }
  }

  /** 新台：unit + circuit 成对创建，名字取平台 fName */
  private async importNew(d: HperforPlatformDevice, sortOrder: number): Promise<void> {
    const fNumber = d.fNumber || d.fId.slice(-8);
    const unitCode = `CB4G-${fNumber}`;
    const circuitCode = `hperfor-${fNumber.toLowerCase()}`;
    const name = d.fName || fNumber;

    const unit = this.hwRepo.create({
      code: unitCode,
      name: `${name} 4G 断路器`,
      category: HARDWARE_CATEGORY as HardwareUnit['category'],
      vendor: VENDOR,
      model: MODEL,
      driverKind: DRIVER_KIND,
      serialNo: fNumber,
      location: d.location ?? DEFAULT_FLOOR,
      floor: DEFAULT_FLOOR,
      addressing: this.buildAddressing(d),
      status: 'normal',
      enabled: true,
    });
    await this.hwRepo.save(unit);

    const circuit = this.circuitRepo.create({
      code: circuitCode,
      name,
      floor: DEFAULT_FLOOR,
      category: 'lighting',
      gatewayCode: unitCode,
      relayChannel: 1,
      meterAddress: null,
      ratedVoltage: 220,
      ratedCurrent: 16,
      ratedPower: 0,
      sortOrder,
      icon: 'Zap',
      description: `${name}，华普云 4G 断路器远程控制（${fNumber}）`,
      enabled: true,
    });
    await this.circuitRepo.save(circuit);
  }
}
