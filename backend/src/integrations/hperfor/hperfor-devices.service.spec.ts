import { ConflictException } from '@nestjs/common';
import type { HperforPlatformDevice } from '../../adapters/power/hperfor-api.adapter';
import { HperforDevicesService } from './hperfor-devices.service';

function makeDevice(over: Partial<HperforPlatformDevice>): HperforPlatformDevice {
  return {
    fId: '100',
    fNumber: 'CB28100000',
    fName: '测试开关',
    online: true,
    switchStatus: 0,
    lastOnlineTime: '',
    lat: 35.068,
    lng: 118.186,
    location: '临沂高新区',
    password: '0',
    ...over,
  };
}

describe('HperforDevicesService', () => {
  let units: any[];
  let circuits: any[];
  let unitIdSeq: number;
  let platform: any;
  let hwRepo: any;
  let circuitRepo: any;
  let svc: HperforDevicesService;

  beforeEach(() => {
    units = [];
    circuits = [];
    unitIdSeq = 100;
    platform = {
      isMockMode: jest.fn().mockReturnValue(false),
      isConfigured: jest.fn().mockReturnValue(true),
      listPlatformDevices: jest.fn(),
    };
    hwRepo = {
      find: jest.fn(async () => units),
      findOne: jest.fn(async ({ where }: any) => units.find((u) => u.id === where.id) ?? null),
      count: jest.fn(async () => units.filter((u) => u.enabled).length),
      create: jest.fn((v: any) => ({ id: ++unitIdSeq, ...v })),
      save: jest.fn(async (v: any) => {
        if (v.id == null) v.id = ++unitIdSeq;
        const i = units.findIndex((u) => u.id === v.id);
        if (i >= 0) units[i] = v;
        else units.push(v);
        return v;
      }),
    };
    circuitRepo = {
      find: jest.fn(async () => circuits),
      findOne: jest.fn(async ({ where }: any) =>
        circuits.find((c) => c.code === where.code) ?? null,
      ),
      create: jest.fn((v: any) => ({ ...v })),
      save: jest.fn(async (v: any) => {
        // 模拟 TypeORM save：同 code 视为更新（不重复插入）
        const i = circuits.findIndex((c) => c.code === v.code);
        if (i >= 0) circuits[i] = v;
        else circuits.push(v);
        return v;
      }),
    };
    svc = new HperforDevicesService(platform, hwRepo, circuitRepo);
  });

  /** 预置一台历史语义化 code 的华普云断路器（模拟已登记的 6 台之一） */
  function seedExisting(): void {
    units.push({
      id: 1,
      code: 'CB4G-SIGN-1',
      name: '楼顶大字 4G 断路器',
      category: 'power-breaker-web',
      vendor: 'ePa',
      model: 'ePa-CB (内置 4G)',
      driverKind: 'hperfor-web',
      serialNo: 'CB28100586',
      addressing: JSON.stringify({ fId: '999', password: '0', lat: 35.0, lng: 118.1 }),
      status: 'normal',
      enabled: true,
      location: '园区',
      floor: '园区',
    });
    circuits.push({
      code: 'roof-sign',
      name: '楼顶大字',
      gatewayCode: 'CB4G-SIGN-1',
      category: 'lighting',
      sortOrder: 230,
      enabled: true,
    });
  }

  it('新台在线：按 fNumber 生成 unit/circuit code，addressing 含 fId 与坐标', async () => {
    seedExisting();
    platform.listPlatformDevices.mockResolvedValue([
      makeDevice({ fId: '999', fNumber: 'CB28100586', fName: '楼顶大字' }),
      makeDevice({ fId: '888', fNumber: 'CB28100583', fName: '研发楼顶广告屏' }),
    ]);

    const r = await svc.syncToCatalog();

    expect(r.scanned).toBe(2);
    expect(r.imported).toBe(1);
    expect(r.circuits).toBe(1);
    expect(r.updated).toBe(1);
    expect(r.skipped).toHaveLength(0);

    const newUnit = units.find((u) => u.code === 'CB4G-CB28100583');
    expect(newUnit).toBeTruthy();
    expect(newUnit.category).toBe('power-breaker-web');
    expect(newUnit.driverKind).toBe('hperfor-web');
    expect(newUnit.name).toBe('研发楼顶广告屏 4G 断路器');
    const addr = JSON.parse(newUnit.addressing);
    expect(addr.fId).toBe('888');
    expect(addr.lat).toBeCloseTo(35.068);

    const newCircuit = circuits.find((c) => c.code === 'hperfor-cb28100583');
    expect(newCircuit).toBeTruthy();
    expect(newCircuit.gatewayCode).toBe('CB4G-CB28100583');
    expect(newCircuit.name).toBe('研发楼顶广告屏');
    expect(newCircuit.relayChannel).toBe(1);
    expect(newCircuit.sortOrder).toBeGreaterThan(230);
  });

  it('离线设备跳过，不建 unit/circuit', async () => {
    platform.listPlatformDevices.mockResolvedValue([
      makeDevice({ fId: '777', fName: '离线开关', online: false }),
    ]);
    const r = await svc.syncToCatalog();
    expect(r.imported).toBe(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toContain('离线');
    expect(units).toHaveLength(0);
    expect(circuits).toHaveLength(0);
  });

  it('幂等：重复同步不重复建，历史语义化 code 保持不变', async () => {
    seedExisting();
    platform.listPlatformDevices.mockResolvedValue([
      makeDevice({ fId: '999', fNumber: 'CB28100586', fName: '楼顶大字' }),
      makeDevice({ fId: '888', fNumber: 'CB28100583', fName: '研发楼顶广告屏' }),
    ]);
    await svc.syncToCatalog();
    const afterFirst = { units: units.length, circuits: circuits.length };
    // 第二次同步：888 已按 fId 登记，不应再新增
    const r2 = await svc.syncToCatalog();
    expect(r2.imported).toBe(0);
    expect(r2.updated).toBe(2);
    expect(units.length).toBe(afterFirst.units);
    expect(circuits.length).toBe(afterFirst.circuits);
    // 历史 code 未被自动规则覆盖
    expect(units.find((u) => u.code === 'CB4G-SIGN-1')).toBeTruthy();
    expect(units.find((u) => u.code === 'CB4G-CB28100586')).toBeFalsy();
  });

  it('本地 MOCK 模式同步抛 Conflict，不触网', async () => {
    platform.isMockMode.mockReturnValue(true);
    await expect(svc.syncToCatalog()).rejects.toBeInstanceOf(ConflictException);
    expect(platform.listPlatformDevices).not.toHaveBeenCalled();
  });

  it('listDevices 按 fId 标记 registered', async () => {
    seedExisting();
    platform.listPlatformDevices.mockResolvedValue([
      makeDevice({ fId: '999', fName: '楼顶大字' }),
      makeDevice({ fId: '888', fName: '研发楼顶广告屏' }),
    ]);
    const list = await svc.listDevices();
    const byId = Object.fromEntries(list.devices.map((d) => [d.fId, d]));
    expect(byId['999'].registered).toBe(true);
    expect(byId['999'].unitCode).toBe('CB4G-SIGN-1');
    expect(byId['888'].registered).toBe(false);
    expect(byId['888'].unitCode).toBeNull();
  });
});
