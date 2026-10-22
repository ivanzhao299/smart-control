/**
 * PowerCircuitsService —— 智能断路器回路的路由与读数。
 *
 * 重点保的是三件"错了会出事"的行为:
 *   1. 只有 gatewayCode 指向 category='power-breaker' 的 hardware_unit 才打真闸,
 *      别的回路(继电器/时序器/没接设备的)一律不许碰断路器
 *   2. 合分闸失败必须抛错 —— 前端绝不能显示"断电成功"而闸其实没动
 *   3. 读数失败要回落, 不能让整个电源页崩掉
 */
import type { Logger } from 'winston';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PowerCircuitsService } from './power-circuits.service';
import type { PowerCircuit } from '../../entities/power-circuit.entity';
import type { BreakerMeasurements } from '../../adapters/power/epa-breaker-registers';

const fakeLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

const circuitRow = (over: Partial<PowerCircuit> = {}): PowerCircuit =>
  ({
    id: 4, code: '1f-led', name: '一层 LED 大屏', floor: '1F', category: 'led',
    gatewayCode: 'BREAKER-LED-1', relayChannel: null, meterAddress: null,
    ratedVoltage: 380, ratedCurrent: 40, ratedPower: 19000,
    sortOrder: 30, icon: 'MonitorPlay', description: null, enabled: true,
    createdAt: new Date(), updatedAt: new Date(),
    ...over,
  }) as PowerCircuit;

/** 现场实测那台的读数形状 (三相 240V, 合闸带载) */
const measurements = (over: Partial<BreakerMeasurements> = {}): BreakerMeasurements =>
  ({
    voltages: [239.9, 240.1, 240.6],
    currents: [28.9, 31.2, 27.4],
    leakageCurrent: 0.003,
    powers: [6360, 6420, 6290, 19070],
    energies: [1.2, 1.3, 1.1, 3.6],
    temperatures: [29.71, 27.97, 28.39, 26.53],
    powerFactor: 0.95,
    frequency: 50,
    mode: 0,
    switchState: 'closed',
    alarms: {
      overVoltage: [false, false, false], underVoltage: [false, false, false],
      overCurrent: [false, false, false], leakage: false,
      overPower: [false, false, false, false], overHeat: [false, false, false, false],
      overEnergy: [false, false, false, false], any: false,
    },
    ...over,
  }) as BreakerMeasurements;

async function makeService(opts: {
  row?: PowerCircuit;
  /** 跳过构造后的首轮采集 (需要自行安排 getMeasurements 调用序列的路由测试) */
  skipCollect?: boolean;
  hwCategory?: string | null;
  hwEnabled?: boolean;
  breaker?: Partial<Record<'turnOn' | 'turnOff' | 'getMeasurements', jest.Mock>>;
  cloudBreaker?: Partial<Record<'turnOn' | 'turnOff' | 'getMeasurements', jest.Mock>>;
} = {}) {
  const row = opts.row ?? circuitRow();
  const repo = {
    findOne: jest.fn(async (q?: { where?: { code?: string } }) =>
      (q?.where?.code === undefined || q.where.code === row.code ? row : null)),
    find: jest.fn().mockResolvedValue([row]),
    save: jest.fn(async (r: unknown) => r),
    create: jest.fn((r: unknown) => r),
  };
  // 第五轮：域字典仓储。单测默认空字典（domainName 回落 null），不影响 on/off 逻辑。
  const domainRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    save: jest.fn(async (r: unknown) => r),
    create: jest.fn((r: unknown) => r),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  // 分区字典仓储：单测默认空字典（floorName 回落 code），ensureFloor 自动收录时静默成功。
  const floorRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    save: jest.fn(async (r: unknown) => r),
    create: jest.fn((r: unknown) => r),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const hwRepo = {
    find: jest.fn().mockResolvedValue(
      opts.hwCategory === null
        ? []
        : [{ code: 'BREAKER-LED-1', name: '测试硬件' }],
    ),
    findOne: jest.fn().mockResolvedValue(
      opts.hwCategory === null
        ? null
        : { code: 'BREAKER-LED-1', category: opts.hwCategory ?? 'power-breaker', enabled: opts.hwEnabled ?? true },
    ),
  };
  const ok = (data: unknown) => ({ ok: true, data, deviceId: 'x', command: 'c', mock: false, durationMs: 1 });
  const breaker = {
    turnOn: opts.breaker?.turnOn ?? jest.fn().mockResolvedValue(ok({ on: true, switchState: 'closed' })),
    turnOff: opts.breaker?.turnOff ?? jest.fn().mockResolvedValue(ok({ on: false, switchState: 'open' })),
    getMeasurements: opts.breaker?.getMeasurements ?? jest.fn().mockResolvedValue(ok(measurements())),
  };
  const cloudBreaker = {
    turnOn: opts.cloudBreaker?.turnOn ?? jest.fn().mockResolvedValue(ok({ on: true, switchState: 'closed' })),
    turnOff: opts.cloudBreaker?.turnOff ?? jest.fn().mockResolvedValue(ok({ on: false, switchState: 'open' })),
    getMeasurements: opts.cloudBreaker?.getMeasurements ?? jest.fn().mockResolvedValue(ok(measurements({
      voltages: [220, 0, 0], currents: [3, 0, 0], powers: [660, 0, 0, 660],
    }))),
  };
  const epo = { setChannel: jest.fn().mockResolvedValue(undefined) };
  const adapter = {
    circuitTurnOn: jest.fn().mockResolvedValue(ok({})),
    circuitTurnOff: jest.fn().mockResolvedValue(ok({})),
    circuitReadStatus: jest.fn().mockResolvedValue(ok({
      on: false, current: 0, voltage: 0, power: 0, powerFactor: 0, energy: 0, lastReadAt: '',
    })),
  };
  const svc = new PowerCircuitsService(
    repo as never, domainRepo as never, floorRepo as never, hwRepo as never, adapter as never,
    epo as never, breaker as never, fakeLogger(),
    undefined, cloudBreaker as never,
  );
  // 模拟后台采集循环: 构造后先采一轮填充快照 (运行时由 onModuleInit 定时做)
  if (!opts.skipCollect) {
    await (svc as unknown as { collectOnce: () => Promise<void> }).collectOnce();
  }
  return { svc, repo, hwRepo, breaker, cloudBreaker, epo, adapter, row };
}

describe('PowerCircuitsService · 断路器回路路由', () => {
  it('展厅操作员列表只返回现场确认的 7 路 1F 回路', async () => {
    const { svc, repo } = await makeService({ skipCollect: true });

    await svc.list({ role: 'operator' });

    const query = repo.find.mock.calls[0]?.[0] as {
      where?: { code?: { _value?: readonly string[] } };
    };
    expect(query.where?.code?._value).toEqual([
      'ewelink-02b88e41', // 展厅灯带
      'ewelink-02b8942a', // 展厅筒灯、射灯
      '1f-showroom',      // 沙盘展位
      'ewelink-02cbf4eb', // 金特夫展厅
      'ewelink-02cbf4ef', // 无纺布展厅
      'ewelink-02cbf50b', // 西展厅
      '1f-led',           // 一层 LED 大屏远程总闸
    ]);
  });

  it('播放页范围返回完整 LED/投影电源链路，不污染操作员电源页范围', async () => {
    const { svc, repo } = await makeService({ skipCollect: true });

    await svc.list({ role: 'operator', scope: 'player' });

    const query = repo.find.mock.calls[0]?.[0] as {
      where?: { code?: { _value?: readonly string[] } };
    };
    expect(query.where?.code?._value).toEqual([
      'seq55-6', 'seq-4', 'seq-2', '1f-led', 'seq55-4', 'seq55-8', 'seq-5',
    ]);
  });

  it('展厅操作员不能通过直接传入 id 操作白名单外的展厅回路', async () => {
    const { svc } = await makeService({
      row: circuitRow({ code: 'hall-extra', domainCode: 'hall' }),
    });

    await expect(svc.turnOnForRole(4, 'operator')).rejects.toThrow('7 路 1F');
  });

  it('展厅操作员通过播放器范围可以控制视频源回路', async () => {
    const { svc, row } = await makeService({
      row: circuitRow({ code: 'seq55-6', domainCode: 'hall', gatewayCode: null }),
    });

    await expect(svc.turnOnForRole(row.id, 'operator', 'player')).resolves.toBeDefined();
  });

  it('播放器范围不能越界控制未配置的回路', async () => {
    const { svc } = await makeService({
      row: circuitRow({ code: 'hall-extra', domainCode: 'hall' }),
    });

    await expect(svc.turnOnForRole(4, 'operator', 'player')).rejects.toThrow('显示设备电源链路');
  });

  it('gatewayCode 指向 power-breaker 硬件 → 打真闸, 不碰时序器', async () => {
    // 前置态 open (未合闸) 才会下发合闸; 轮询第一次给 closed 立即命中
    const gm = jest.fn()
      .mockResolvedValueOnce({ ok: true, data: measurements({ switchState: 'open', currents: [0, 0, 0] }) })
      .mockResolvedValue({ ok: true, data: measurements({ switchState: 'closed' }) });
    const { svc, breaker, epo } = await makeService({ skipCollect: true, breaker: { getMeasurements: gm } });
    await svc.turnOn(4);
    expect(breaker.turnOn).toHaveBeenCalledWith('BREAKER-LED-1');
    expect(epo.setChannel).not.toHaveBeenCalled();
  });

  it('分闸走 turnOff', async () => {
    const { svc, breaker } = await makeService();
    await svc.turnOff(4);
    expect(breaker.turnOff).toHaveBeenCalledWith('BREAKER-LED-1');
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('硬件不是 power-breaker(比如继电器) → 绝不打断路器', async () => {
    const { svc, breaker } = await makeService({ hwCategory: 'power-relay' });
    await svc.turnOn(4);
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('硬件被禁用 → 不打断路器', async () => {
    const { svc, breaker } = await makeService({ hwEnabled: false });
    await svc.turnOn(4);
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('power-breaker-4g 只路由到 MQTT 适配器', async () => {
    // 前置态 open 才下发; 轮询给 closed 立即命中
    const gm = jest.fn()
      .mockResolvedValueOnce({ ok: true, data: measurements({ switchState: 'open', currents: [0, 0, 0] }) })
      .mockResolvedValue({ ok: true, data: measurements({
        voltages: [220, 0, 0], currents: [3, 0, 0], powers: [660, 0, 0, 660] }) });
    const { svc, breaker, cloudBreaker } = await makeService({
      skipCollect: true,
      hwCategory: 'power-breaker-4g', cloudBreaker: { getMeasurements: gm },
    });
    await svc.turnOn(4);
    expect(cloudBreaker.turnOn).toHaveBeenCalledWith('BREAKER-LED-1');
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('回路没填 gatewayCode → 不打断路器', async () => {
    const { svc, breaker } = await makeService({ row: circuitRow({ gatewayCode: null }) });
    await svc.turnOn(4);
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('闸没动成必须抛错 —— 不许对前端谎报成功', async () => {
    const { svc, adapter } = await makeService({
      breaker: { turnOff: jest.fn().mockResolvedValue({ ok: false, error: '转换器超时' }) },
    });
    await expect(svc.turnOff(4)).rejects.toThrow(ConflictException);
    // 真闸失败后不该再去动 mock 状态, 否则页面会显示成已断电
    expect(adapter.circuitTurnOff).not.toHaveBeenCalled();
  });

  it('已合闸再 turnOn → 幂等, 不重复下发', async () => {
    const { svc, breaker } = await makeService(); // 默认 getMeasurements closed
    await svc.turnOn(4);
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('已分闸再 turnOff → 幂等, 不重复下发', async () => {
    const gm = jest.fn().mockResolvedValue({
      ok: true, data: measurements({ switchState: 'open', currents: [0, 0, 0] }),
    });
    const { svc, breaker } = await makeService({ breaker: { getMeasurements: gm } });
    await svc.turnOff(4);
    expect(breaker.turnOff).not.toHaveBeenCalled();
  });

  it('前置态读不到 (ok:false) → 保守照常下发, 不跳过', async () => {
    const gm = jest.fn()
      .mockResolvedValueOnce({ ok: false, error: 'timeout' })
      .mockResolvedValue({ ok: true, data: measurements({ switchState: 'closed' }) });
    const { svc, breaker } = await makeService({ skipCollect: true, breaker: { getMeasurements: gm } });
    await svc.turnOn(4);
    expect(breaker.turnOn).toHaveBeenCalledWith('BREAKER-LED-1');
  });
});

describe('PowerCircuitsService · 断路器实时读数', () => {
  it('读数取真机值: 电压三相平均, 电流取最重一相, 功率/电量取总', async () => {
    const { svc } = await makeService();
    const v = await svc.detail(4);
    expect(v.isBreaker).toBe(true);                  // 前端据此显示空开详情
    expect(v.reading.voltage).toBeCloseTo(240.2, 1); // (239.9+240.1+240.6)/3
    expect(v.reading.current).toBe(31.2);            // 最大相, 不是平均
    expect(v.reading.power).toBe(19070);             // 总功率
    expect(v.reading.energy).toBe(3.6);              // 总电量
    expect(v.reading.on).toBe(true);
  });

  it('分闸态 on=false', async () => {
    const { svc } = await makeService({
      breaker: { getMeasurements: jest.fn().mockResolvedValue({
        ok: true, data: measurements({ switchState: 'open', currents: [0, 0, 0] }),
      }) },
    });
    expect((await svc.detail(4)).reading.on).toBe(false);
  });

  it('4G 单相断路器只上传 A 相时，页面电压仍显示实际值', async () => {
    const { svc } = await makeService({ hwCategory: 'power-breaker-4g' });
    const view = await svc.detail(4);
    expect(view.isBreaker).toBe(true);
    expect(view.reading.voltage).toBe(220);
    expect(view.reading.power).toBe(660);
  });

  it('TTL 内复用缓存 —— 一次 list 不会把 485 打爆', async () => {
    const { svc, breaker } = await makeService();
    await svc.detail(4);
    await svc.detail(4);
    await svc.detail(4);
    expect(breaker.getMeasurements).toHaveBeenCalledTimes(1);
  });

  it('读不到时回落成全 0, 不抛错(电源页别整页崩)', async () => {
    const { svc } = await makeService({
      breaker: { getMeasurements: jest.fn().mockResolvedValue({ ok: false, error: '连接被拒绝' }) },
    });
    const v = await svc.detail(4);
    expect(v.reading.on).toBe(false);
    expect(v.reading.voltage).toBe(0);
    expect(v.name).toBe('一层 LED 大屏'); // 行字段照常返回
  });

  it('非断路器回路 isBreaker=false (前端不显示空开详情)', async () => {
    const { svc } = await makeService({ hwCategory: 'power-relay' });
    expect((await svc.detail(4)).isBreaker).toBe(false);
  });

  it('合分闸后快照即时刷新 —— 别拿旧读数糊弄前端', async () => {
    // 彻底版: detail/toView 只读快照、不打设备。makeService 已后台采集 1 次 (open);
    // turnOff 前置读当前态, 已是目标 open → 幂等不重发, 仅这 1 次 getMeasurements。
    // 合计 = 采集 1 + turnOff 前置 1 = 2 次。
    const { svc, breaker } = await makeService({
      breaker: { getMeasurements: jest.fn().mockResolvedValue({
        ok: true, data: measurements({ switchState: 'open', currents: [0, 0, 0] }),
      }) },
    });
    await svc.detail(4);                             // 读快照, 不打设备
    expect(breaker.getMeasurements).toHaveBeenCalledTimes(1);
    await svc.turnOff(4);
    expect(breaker.getMeasurements).toHaveBeenCalledTimes(2);
  });

  it('非断路器回路读 /breaker 全量计量要拒绝', async () => {
    const { svc } = await makeService({ hwCategory: 'power-relay' });
    await expect(svc.breakerMeasurements(4)).rejects.toThrow(ConflictException);
  });

  it('断路器回路能拿到分相/温度/报警全量', async () => {
    const { svc, breaker } = await makeService();
    const m = await svc.breakerMeasurements(4);
    expect(breaker.getMeasurements).toHaveBeenCalledWith('BREAKER-LED-1');
    expect(m.temperatures).toHaveLength(4);
    expect(m.leakageCurrent).toBe(0.003);
    expect(m.alarms.any).toBe(false);
  });
});

describe('PowerCircuitsService · 时序器后台采集快照', () => {
  const seqRows = (): PowerCircuit[] =>
    Array.from({ length: 8 }, (_, i) =>
      circuitRow({
        id: 100 + i, code: 'seq-' + (i + 1), name: '时序器回路' + (i + 1),
        category: 'audio', gatewayCode: 'AUDIO-PWR-SEQ-1', relayChannel: i + 1,
      }));
  const okResult = (data: unknown) => ({ ok: true, data, deviceId: 'x', command: 'c', mock: false, durationMs: 1 });
  const collect = (svc: PowerCircuitsService) =>
    (svc as unknown as { collectSequencer: () => Promise<void> }).collectSequencer();

  async function build(readStatusImpl: jest.Mock) {
    const rows = seqRows();
    const repo = {
      findOne: jest.fn(async (q?: { where: { id?: number } }) =>
        rows.find((r) => r.id === q?.where?.id) ?? null),
      find: jest.fn(async () => rows),
      save: jest.fn(async (r: unknown) => r),
      create: jest.fn((r: unknown) => r),
    };
    const hwRepo = {
      find: jest.fn(async () => [{ code: 'AUDIO-PWR-SEQ-1', name: '音响电源时序器' }]),
      findOne: jest.fn(async (q: { where: { code: string } }) =>
        q.where.code === 'AUDIO-PWR-SEQ-1'
          ? { code: 'AUDIO-PWR-SEQ-1', category: 'audio-power', enabled: true }
          : null),
    };
    const domainRepo = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      save: jest.fn(async (r: unknown) => r),
      create: jest.fn((r: unknown) => r),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    const floorRepo = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      save: jest.fn(async (r: unknown) => r),
      create: jest.fn((r: unknown) => r),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    const epo = { setChannel: jest.fn(async () => okResult({})), readStatus: readStatusImpl };
    const adapter = {
      circuitTurnOn: jest.fn(), circuitTurnOff: jest.fn(),
      circuitReadStatus: jest.fn(async () => okResult({ on: false })),
    };
    const breaker = { turnOn: jest.fn(), turnOff: jest.fn(), getMeasurements: jest.fn() };
    const cloudBreaker = { turnOn: jest.fn(), turnOff: jest.fn(), getMeasurements: jest.fn() };
    const svc = new PowerCircuitsService(
      repo as never, domainRepo as never, floorRepo as never, hwRepo as never, adapter as never,
      epo as never, breaker as never, fakeLogger(), undefined, cloudBreaker as never,
    );
    return { svc, epo };
  }

  it('list 未采集前不读设备、不阻塞, 状态回落 on=false', async () => {
    const readStatus = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return okResult({ channels: new Array(8).fill(true) });
    });
    const { svc } = await build(readStatus);
    const t0 = Date.now();
    const views = await svc.list();
    expect(readStatus).not.toHaveBeenCalled();
    expect(views.every((v) => v.reading.on === false)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('后台并发 collectSequencer 只触发一次 readStatus, 采完 list 反映真机', async () => {
    const channels = [true, false, true, false, false, false, true, false];
    const readStatus = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return okResult({ channels });
    });
    const { svc } = await build(readStatus);
    await Promise.all([collect(svc), collect(svc), collect(svc)]);
    expect(readStatus).toHaveBeenCalledTimes(1);
    const views = await svc.list();
    expect(views.map((v) => v.reading.on)).toEqual(channels);
  });

  it('采集失败保留上次好值, 不用失败/0 覆盖', async () => {
    const channels = [true, true, false, false, false, false, false, false];
    let n = 0;
    const readStatus = jest.fn(async () => {
      n += 1;
      return n === 1 ? okResult({ channels }) : { ok: false, error: 'timeout' };
    });
    const { svc } = await build(readStatus);
    await collect(svc);
    await collect(svc); // 失败
    const views = await svc.list();
    expect(views[0].reading.on).toBe(true);
    expect(views[2].reading.on).toBe(false);
  });

  it('单路操作乐观置位快照、不读真机, 随后后台校正', async () => {
    const readStatus = jest.fn(async () => okResult({ channels: new Array(8).fill(false) }));
    const { svc, epo } = await build(readStatus);
    await svc.turnOn(102); // seq-3, relayChannel 3
    expect(epo.setChannel).toHaveBeenCalledWith(3, true);
    expect(readStatus).not.toHaveBeenCalled();
    const views = await svc.list();
    expect(views[2].reading.on).toBe(true);
  });
});

describe('PowerCircuitsService · 第二台时序器 SEQ55 (双机独立采集/开关/按设备路由)', () => {
  const okResult = (data: unknown) => ({ ok: true, data, deviceId: 'x', command: 'c', mock: false, durationMs: 1 });
  const collect = (svc: PowerCircuitsService) =>
    (svc as unknown as { collectSequencer: () => Promise<void> }).collectSequencer();

  const epoRows = (): PowerCircuit[] =>
    Array.from({ length: 8 }, (_, i) =>
      circuitRow({
        id: 100 + i, code: 'seq-' + (i + 1), name: '时序器回路' + (i + 1),
        category: 'audio', gatewayCode: 'AUDIO-PWR-SEQ-1', relayChannel: i + 1,
      }));
  const seq55Rows = (): PowerCircuit[] =>
    Array.from({ length: 8 }, (_, i) =>
      circuitRow({
        id: 200 + i, code: 'seq55-' + (i + 1), name: '二台时序 CH' + (i + 1),
        category: 'audio-seq', gatewayCode: 'PWR-SEQ55-1', relayChannel: i + 1,
      }));

  type Hw = { code: string; category: string; enabled: boolean } | null;
  async function build(
    epoStatus: jest.Mock,
    seq55Status: jest.Mock,
    overrides: Record<string, Hw> = {},
  ) {
    const rows = [...epoRows(), ...seq55Rows()];
    const byCode: Record<string, Hw> = {
      'AUDIO-PWR-SEQ-1': { code: 'AUDIO-PWR-SEQ-1', category: 'audio-power', enabled: true },
      'PWR-SEQ55-1': { code: 'PWR-SEQ55-1', category: 'power-seq55', enabled: true },
      ...overrides,
    };
    const repo = {
      findOne: jest.fn(async (q?: { where?: { id?: number } }) =>
        rows.find((r) => r.id === q?.where?.id) ?? null),
      find: jest.fn(async () => rows),
      save: jest.fn(async (r: unknown) => r),
      create: jest.fn((r: unknown) => r),
    };
    const hwRepo = {
      find: jest.fn(async () => [
        { code: 'AUDIO-PWR-SEQ-1', name: '音响电源时序器' },
        { code: 'PWR-SEQ55-1', name: '第二台电源时序器 (SEQ55)' },
      ]),
      findOne: jest.fn(async (q: { where: { code: string } }): Promise<Hw> => byCode[q.where.code] ?? null),
    };
    const domainRepo = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      save: jest.fn(async (r: unknown) => r),
      create: jest.fn((r: unknown) => r),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    const floorRepo = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      save: jest.fn(async (r: unknown) => r),
      create: jest.fn((r: unknown) => r),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    const epo = {
      setAll: jest.fn(async () => okResult({ on: true })),
      setChannel: jest.fn(async () => okResult({})),
      readStatus: epoStatus,
    };
    const seq55 = {
      setAllSequential: jest.fn(async () => okResult({ on: true })),
      setAllSync: jest.fn(async () => okResult({ on: true })),
      setChannel: jest.fn(async () => okResult({})),
      readStatus: seq55Status,
    };
    const adapter = {
      circuitTurnOn: jest.fn(), circuitTurnOff: jest.fn(),
      circuitReadStatus: jest.fn(async () => okResult({ on: false })),
    };
    const breaker = { turnOn: jest.fn(), turnOff: jest.fn(), getMeasurements: jest.fn() };
    const cloudBreaker = { turnOn: jest.fn(), turnOff: jest.fn(), getMeasurements: jest.fn() };
    const svc = new PowerCircuitsService(
      repo as never, domainRepo as never, floorRepo as never, hwRepo as never, adapter as never,
      epo as never, breaker as never, fakeLogger(), seq55 as never, cloudBreaker as never,
    );
    return { svc, epo, seq55 };
  }

  const allOn = () => jest.fn(async () => okResult({ channels: new Array(8).fill(true) }));
  const allOff = () => jest.fn(async () => okResult({ channels: new Array(8).fill(false) }));

  it('两台各自采集: EPO 全亮 / SEQ55 全灭时, list 状态互不串台', async () => {
    const { svc, epo, seq55 } = await build(allOn(), allOff());
    await collect(svc);
    expect(epo.readStatus).toHaveBeenCalledTimes(1);
    expect(seq55.readStatus).toHaveBeenCalledTimes(1);
    const views = await svc.list();
    const epoViews = views.filter((v) => v.gatewayCode === 'AUDIO-PWR-SEQ-1');
    const seq55Views = views.filter((v) => v.gatewayCode === 'PWR-SEQ55-1');
    expect(epoViews.every((v) => v.reading.on)).toBe(true);
    expect(seq55Views.every((v) => v.reading.on)).toBe(false);
  });

  it('SEQ55 状态只来自它自己的快照: EPO 全灭 / SEQ55 位图 0x05(CH1,CH3 开)', async () => {
    const channels = [true, false, true, false, false, false, false, false];
    const { svc } = await build(allOff(), jest.fn(async () => okResult({ channels })));
    await collect(svc);
    const views = await svc.list();
    expect(views.filter((v) => v.gatewayCode === 'PWR-SEQ55-1').map((v) => v.reading.on)).toEqual(channels);
    expect(views.filter((v) => v.gatewayCode === 'AUDIO-PWR-SEQ-1').every((v) => !v.reading.on)).toBe(true);
  });

  it('SEQ55 单路开机: 调 setChannel(3,true) 并乐观置位, 不读真机', async () => {
    const { svc, seq55 } = await build(allOff(), allOff());
    await svc.turnOn(202); // seq55-3, relayChannel 3
    expect(seq55.setChannel).toHaveBeenCalledWith(3, true);
    const views = await svc.list();
    expect(views.find((v) => v.id === 202)?.reading.on).toBe(true);
  });

  it('gatewayName 批量填充: 两台分别带硬件中文名', async () => {
    const { svc } = await build(allOff(), allOff());
    const views = await svc.list();
    expect(views.find((v) => v.gatewayCode === 'PWR-SEQ55-1')?.gatewayName).toBe('第二台电源时序器 (SEQ55)');
    expect(views.find((v) => v.gatewayCode === 'AUDIO-PWR-SEQ-1')?.gatewayName).toBe('音响电源时序器');
  });

  it('sequencerAll 无 gatewayCode 抛 Conflict —— 不允许无差别同时控两台', async () => {
    const { svc } = await build(allOff(), allOff());
    await expect(svc.sequencerAll(true)).rejects.toThrow(ConflictException);
    await expect(svc.sequencerAll(true, '')).rejects.toThrow(ConflictException);
    await expect(svc.sequencerAll(true, '   ')).rejects.toThrow(ConflictException);
  });

  it('sequencerAll 开机: EPO 走 epo.setAll, 不碰 SEQ55', async () => {
    const { svc, epo, seq55 } = await build(allOff(), allOff());
    await svc.sequencerAll(true, 'AUDIO-PWR-SEQ-1');
    expect(epo.setAll).toHaveBeenCalledWith(true);
    expect(seq55.setAllSequential).not.toHaveBeenCalled();
  });

  it('sequencerAll 关机: SEQ55 走 setAllSequential(0D 顺序时序), 不碰 EPO', async () => {
    const { svc, epo, seq55 } = await build(allOff(), allOff());
    await svc.sequencerAll(false, 'PWR-SEQ55-1');
    expect(seq55.setAllSequential).toHaveBeenCalledWith(false);
    expect(epo.setAll).not.toHaveBeenCalled();
  });

  it('sequencerAll 设备不存在 → NotFound', async () => {
    const { svc } = await build(allOff(), allOff());
    await expect(svc.sequencerAll(true, 'NO-SUCH-GW')).rejects.toThrow(NotFoundException);
  });

  it('sequencerAll 指向非时序器硬件 → Conflict', async () => {
    const { svc } = await build(allOff(), allOff(), {
      'PWR-SEQ55-1': { code: 'PWR-SEQ55-1', category: 'power-relay', enabled: true },
    });
    await expect(svc.sequencerAll(true, 'PWR-SEQ55-1')).rejects.toThrow(ConflictException);
  });

  describe('EPO 窗口期逐路合成（EPO 状态字节只回目标态、读不到物理逐路，按固定延时合成）', () => {
    const bitmap = (svc: any, on: boolean, t: number, init?: boolean[]) =>
      svc
        .epoSyntheticChannels(on, t, init ?? null)
        .map((b: boolean) => (b ? '1' : '0'))
        .join('');

    it('开机: 按 1/3/5/…/15s 正序逐路开', async () => {
      const { svc } = await build(allOff(), allOff());
      const f = (t: number) => bitmap(svc, true, t);
      expect(f(0)).toBe('00000000');
      expect(f(1.5)).toBe('10000000');
      expect(f(3)).toBe('11000000');
      expect(f(4.5)).toBe('11000000');
      expect(f(6)).toBe('11100000');
      expect(f(7.5)).toBe('11110000');
      expect(f(9)).toBe('11111000');
      expect(f(10.5)).toBe('11111000');
      expect(f(12)).toBe('11111100');
      expect(f(13.5)).toBe('11111110');
      expect(f(15)).toBe('11111111');
    });

    it('关机: 按 15/13/…/1s 倒序逐路关', async () => {
      const { svc } = await build(allOff(), allOff());
      const f = (t: number) => bitmap(svc, false, t);
      expect(f(0)).toBe('11111111');
      expect(f(1.5)).toBe('11111110');
      expect(f(3)).toBe('11111100');
      expect(f(4.5)).toBe('11111100');
      expect(f(6)).toBe('11111000');
      expect(f(7.5)).toBe('11110000');
      expect(f(9)).toBe('11100000');
      expect(f(10.5)).toBe('11100000');
      expect(f(12)).toBe('11000000');
      expect(f(13.5)).toBe('10000000');
      expect(f(15)).toBe('00000000');
    });

    it('开机非标准初始态（CH2 已被手动开）：CH2 全程保持开、不被错误闪关', async () => {
      const { svc } = await build(allOff(), allOff());
      // CH2(index1) 初始已开
      const init = [false, true, false, false, false, false, false, false];
      const f = (t: number) => bitmap(svc, true, t, init);
      expect(f(0)).toBe('01000000');
      expect(f(1.5)).toBe('11000000'); // CH1 到点开, CH2 保持开（非 10000000）
      expect(f(3)).toBe('11000000');
      expect(f(4.5)).toBe('11000000');
      expect(f(6)).toBe('11100000');
      expect(f(9)).toBe('11111000');
      expect(f(12)).toBe('11111100');
      expect(f(13.5)).toBe('11111110');
      expect(f(15)).toBe('11111111');
    });

    it('关机非标准初始态（CH2 已被手动关）：CH2 全程保持关、不被错误点亮', async () => {
      const { svc } = await build(allOff(), allOff());
      // CH2(index1) 初始已关，其余全开
      const init = [true, false, true, true, true, true, true, true];
      const f = (t: number) => bitmap(svc, false, t, init);
      expect(f(0)).toBe('10111111');
      expect(f(1.5)).toBe('10111110'); // CH8 关, CH2 保持关
      expect(f(3)).toBe('10111100');
      expect(f(6)).toBe('10111000'); // CH5 关延时7 未到、仍开
      expect(f(9)).toBe('10100000');
      expect(f(12)).toBe('10000000');
      expect(f(13.5)).toBe('10000000');
      expect(f(15)).toBe('00000000');
    });
  });
});
