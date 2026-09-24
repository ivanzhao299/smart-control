import { ConfigService } from '@nestjs/config';
import type { GinlongConfig, RootConfig } from '../../common/config/configuration';
import type { GinlongStationRecord, GinlongStationStatusVo } from './ginlong.client';
import { normalizePv, PvService } from './pv.service';

// 锦浪云 userStationList 真实返回 (2026-09-22 实测) 的关键字段精简样本: E4楼 / E5楼。
const E4: GinlongStationRecord = {
  id: '1299184320439465739',
  stationName: '金湖科创产业园E4楼',
  capacity: 789.94,
  capacity1: 789.94,
  power: 170.05,
  power1: 170050.0,
  capacityPercent: 0.215,
  dayEnergy: 3.229,
  dayEnergy1: 3228.9,
  monthEnergy: 70.147,
  monthEnergy1: 70146.6,
  yearEnergy: 137.411,
  yearEnergy1: 137411.2,
  allEnergy: 137.416,
  allEnergy1: 137416.0,
  monthCarbonDioxide: 88.8,
  inverterCount: 6,
  inverterOnlineCount: 6,
  state: 1,
  condTxtD: '晴',
  dataTimestampStr: '2026-09-22 16:11:13',
};
const E5: GinlongStationRecord = {
  id: '1299184320439465730',
  stationName: '金湖科创产业园E5楼',
  capacity: 809.625,
  capacity1: 809.625,
  power: 169.07,
  power1: 169070.0,
  capacityPercent: 0.209,
  dayEnergy: 3.243,
  dayEnergy1: 3242.7,
  monthEnergy: 71.8,
  monthEnergy1: 71800.2,
  yearEnergy: 140.843,
  yearEnergy1: 140843.0,
  allEnergy: 140.848,
  allEnergy1: 140848.0,
  monthCarbonDioxide: 88.68,
  inverterCount: 7,
  inverterOnlineCount: 7,
  state: 1,
  condTxtD: '晴',
  dataTimestampStr: '2026-09-22 16:11:13',
};
const STATUS: GinlongStationStatusVo = { all: 2, normal: 2, fault: 0, offline: 0 };

describe('normalizePv 归一化', () => {
  const overview = normalizePv([E4, E5], STATUS, '2026-09-22T08:11:14.000Z');

  it('聚合电站数量与状态', () => {
    expect(overview.enabled).toBe(true);
    expect(overview.ok).toBe(true);
    expect(overview.stationCount).toBe(2);
    expect(overview.normalCount).toBe(2);
    expect(overview.offlineCount).toBe(0);
    expect(overview.weather).toBe('晴');
    expect(overview.dataTime).toBe('2026-09-22 16:11:13');
  });

  it('正确合计装机/实时功率/利用率', () => {
    expect(overview.totals?.capacityKw).toBeCloseTo(1599.57, 1);
    expect(overview.totals?.currentPowerKw).toBeCloseTo(339.12, 2);
    expect(overview.totals?.utilization).toBeCloseTo(339.12 / 1599.565, 2);
  });

  it('正确合计电量 (kWh) 与减碳', () => {
    expect(overview.totals?.todayKwh).toBeCloseTo(6471.6, 1);
    expect(overview.totals?.monthKwh).toBeCloseTo(141946.8, 1);
    expect(overview.totals?.yearKwh).toBeCloseTo(278254.2, 1);
    expect(overview.totals?.totalKwh).toBeCloseTo(278264.0, 1);
    expect(overview.totals?.monthCarbonT).toBeCloseTo(177.48, 1);
  });

  it('合计逆变器在线数', () => {
    expect(overview.totals?.inverterTotal).toBe(13);
    expect(overview.totals?.inverterOnline).toBe(13);
    expect(overview.stations.map((s) => s.online)).toEqual([true, true]);
  });

  it('单站电量优先取 kWh 字段, 单位正确', () => {
    expect(overview.stations[0].todayKwh).toBeCloseTo(3228.9, 1);
    expect(overview.stations[0].capacityKw).toBeCloseTo(789.94, 2);
    expect(overview.stations[1].currentPowerKw).toBeCloseTo(169.07, 2);
  });

  it('空电站列表返回零值而不抛错', () => {
    const empty = normalizePv([], {}, '2026-09-22T08:11:14.000Z');
    expect(empty.stationCount).toBe(0);
    expect(empty.totals?.currentPowerKw).toBe(0);
    expect(empty.totals?.inverterOnline).toBe(0);
  });
});

describe('PvService 缓存与容错', () => {
  const enabledCfg: GinlongConfig = {
    enabled: true,
    baseUrl: 'https://example.test:13333',
    keyId: 'k',
    keySecret: 's',
    refreshIntervalMs: 60_000,
    timeoutMs: 5000,
  };

  function makeService(cfg: GinlongConfig): PvService {
    const config = { getOrThrow: () => cfg } as unknown as ConfigService<RootConfig>;
    return new PvService(config);
  }

  it('未配置凭证时 enabled=false 且不报错', () => {
    const svc = makeService({ ...enabledCfg, enabled: false, keyId: '', keySecret: '' });
    const o = svc.getOverview();
    expect(o.enabled).toBe(false);
    expect(o.loading).toBe(false);
  });

  it('拉取失败但已有缓存时保留旧数据并标记 stale', async () => {
    const svc = makeService(enabledCfg);
    let shouldFail = false;
    (svc as unknown as { client: unknown }).client = {
      fetchStationList: async () => {
        if (shouldFail) throw new Error('network down');
        return { records: [E4, E5], statusVo: STATUS, raw: {} };
      },
    };

    await svc.refresh();
    expect(svc.getOverview().ok).toBe(true);
    expect(svc.getOverview().stale).toBe(false);
    expect(svc.getOverview().totals?.currentPowerKw).toBeCloseTo(339.12, 2);

    shouldFail = true;
    await svc.refresh();
    const degraded = svc.getOverview();
    expect(degraded.stale).toBe(true);
    expect(degraded.error).toContain('network down');
    // 旧数据仍在, 大屏不闪断。
    expect(degraded.totals?.currentPowerKw).toBeCloseTo(339.12, 2);
  });

  it('首次拉取即失败时 ok=false 且不抛异常', async () => {
    const svc = makeService(enabledCfg);
    (svc as unknown as { client: unknown }).client = {
      fetchStationList: async () => {
        throw new Error('boom');
      },
    };
    await svc.refresh();
    const o = svc.getOverview();
    expect(o.ok).toBe(false);
    expect(o.error).toContain('boom');
  });
});
