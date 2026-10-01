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
import { ConflictException } from '@nestjs/common';
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

function makeService(opts: {
  row?: PowerCircuit;
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
  const hwRepo = {
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
    repo as never, hwRepo as never, adapter as never, epo as never, breaker as never, fakeLogger(),
    undefined, cloudBreaker as never,
  );
  return { svc, repo, hwRepo, breaker, cloudBreaker, epo, adapter, row };
}

describe('PowerCircuitsService · 断路器回路路由', () => {
  it('gatewayCode 指向 power-breaker 硬件 → 打真闸, 不碰时序器', async () => {
    // 前置态 open (未合闸) 才会下发合闸; 轮询第一次给 closed 立即命中
    const gm = jest.fn()
      .mockResolvedValueOnce({ ok: true, data: measurements({ switchState: 'open', currents: [0, 0, 0] }) })
      .mockResolvedValue({ ok: true, data: measurements({ switchState: 'closed' }) });
    const { svc, breaker, epo } = makeService({ breaker: { getMeasurements: gm } });
    await svc.turnOn(4);
    expect(breaker.turnOn).toHaveBeenCalledWith('BREAKER-LED-1');
    expect(epo.setChannel).not.toHaveBeenCalled();
  });

  it('分闸走 turnOff', async () => {
    const { svc, breaker } = makeService();
    await svc.turnOff(4);
    expect(breaker.turnOff).toHaveBeenCalledWith('BREAKER-LED-1');
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('硬件不是 power-breaker(比如继电器) → 绝不打断路器', async () => {
    const { svc, breaker } = makeService({ hwCategory: 'power-relay' });
    await svc.turnOn(4);
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('硬件被禁用 → 不打断路器', async () => {
    const { svc, breaker } = makeService({ hwEnabled: false });
    await svc.turnOn(4);
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('power-breaker-4g 只路由到 MQTT 适配器', async () => {
    // 前置态 open 才下发; 轮询给 closed 立即命中
    const gm = jest.fn()
      .mockResolvedValueOnce({ ok: true, data: measurements({ switchState: 'open', currents: [0, 0, 0] }) })
      .mockResolvedValue({ ok: true, data: measurements({
        voltages: [220, 0, 0], currents: [3, 0, 0], powers: [660, 0, 0, 660] }) });
    const { svc, breaker, cloudBreaker } = makeService({
      hwCategory: 'power-breaker-4g', cloudBreaker: { getMeasurements: gm },
    });
    await svc.turnOn(4);
    expect(cloudBreaker.turnOn).toHaveBeenCalledWith('BREAKER-LED-1');
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('回路没填 gatewayCode → 不打断路器', async () => {
    const { svc, breaker } = makeService({ row: circuitRow({ gatewayCode: null }) });
    await svc.turnOn(4);
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('闸没动成必须抛错 —— 不许对前端谎报成功', async () => {
    const { svc, adapter } = makeService({
      breaker: { turnOff: jest.fn().mockResolvedValue({ ok: false, error: '转换器超时' }) },
    });
    await expect(svc.turnOff(4)).rejects.toThrow(ConflictException);
    // 真闸失败后不该再去动 mock 状态, 否则页面会显示成已断电
    expect(adapter.circuitTurnOff).not.toHaveBeenCalled();
  });

  it('已合闸再 turnOn → 幂等, 不重复下发', async () => {
    const { svc, breaker } = makeService(); // 默认 getMeasurements closed
    await svc.turnOn(4);
    expect(breaker.turnOn).not.toHaveBeenCalled();
  });

  it('已分闸再 turnOff → 幂等, 不重复下发', async () => {
    const gm = jest.fn().mockResolvedValue({
      ok: true, data: measurements({ switchState: 'open', currents: [0, 0, 0] }),
    });
    const { svc, breaker } = makeService({ breaker: { getMeasurements: gm } });
    await svc.turnOff(4);
    expect(breaker.turnOff).not.toHaveBeenCalled();
  });

  it('前置态读不到 (ok:false) → 保守照常下发, 不跳过', async () => {
    const gm = jest.fn()
      .mockResolvedValueOnce({ ok: false, error: 'timeout' })
      .mockResolvedValue({ ok: true, data: measurements({ switchState: 'closed' }) });
    const { svc, breaker } = makeService({ breaker: { getMeasurements: gm } });
    await svc.turnOn(4);
    expect(breaker.turnOn).toHaveBeenCalledWith('BREAKER-LED-1');
  });
});

describe('PowerCircuitsService · 断路器实时读数', () => {
  it('读数取真机值: 电压三相平均, 电流取最重一相, 功率/电量取总', async () => {
    const { svc } = makeService();
    const v = await svc.detail(4);
    expect(v.isBreaker).toBe(true);                  // 前端据此显示空开详情
    expect(v.reading.voltage).toBeCloseTo(240.2, 1); // (239.9+240.1+240.6)/3
    expect(v.reading.current).toBe(31.2);            // 最大相, 不是平均
    expect(v.reading.power).toBe(19070);             // 总功率
    expect(v.reading.energy).toBe(3.6);              // 总电量
    expect(v.reading.on).toBe(true);
  });

  it('分闸态 on=false', async () => {
    const { svc } = makeService({
      breaker: { getMeasurements: jest.fn().mockResolvedValue({
        ok: true, data: measurements({ switchState: 'open', currents: [0, 0, 0] }),
      }) },
    });
    expect((await svc.detail(4)).reading.on).toBe(false);
  });

  it('4G 单相断路器只上传 A 相时，页面电压仍显示实际值', async () => {
    const { svc } = makeService({ hwCategory: 'power-breaker-4g' });
    const view = await svc.detail(4);
    expect(view.isBreaker).toBe(true);
    expect(view.reading.voltage).toBe(220);
    expect(view.reading.power).toBe(660);
  });

  it('TTL 内复用缓存 —— 一次 list 不会把 485 打爆', async () => {
    const { svc, breaker } = makeService();
    await svc.detail(4);
    await svc.detail(4);
    await svc.detail(4);
    expect(breaker.getMeasurements).toHaveBeenCalledTimes(1);
  });

  it('读不到时回落成全 0, 不抛错(电源页别整页崩)', async () => {
    const { svc } = makeService({
      breaker: { getMeasurements: jest.fn().mockResolvedValue({ ok: false, error: '连接被拒绝' }) },
    });
    const v = await svc.detail(4);
    expect(v.reading.on).toBe(false);
    expect(v.reading.voltage).toBe(0);
    expect(v.name).toBe('一层 LED 大屏'); // 行字段照常返回
  });

  it('非断路器回路 isBreaker=false (前端不显示空开详情)', async () => {
    const { svc } = makeService({ hwCategory: 'power-relay' });
    expect((await svc.detail(4)).isBreaker).toBe(false);
  });

  it('合分闸后立刻失效缓存 —— 别拿旧读数糊弄前端', async () => {
    // 2026-07-24 起 switchCircuit 下发命令后会轮询 getMeasurements 等物理闸真正
    // 走完 (switchState 翻到目标态) 再返回 —— 否则命令回来比闸动作快, 前端拿旧
    // 状态覆盖乐观 UI, 按钮当场跳回。mock 直接给目标态 open, 轮询第一次就命中:
    // detail 1 次 + turnOff(轮询 1 次 + toView 重读 1 次) = 3 次。
    const { svc, breaker } = makeService({
      breaker: { getMeasurements: jest.fn().mockResolvedValue({
        ok: true, data: measurements({ switchState: 'open', currents: [0, 0, 0] }),
      }) },
    });
    await svc.detail(4);                             // 第 1 次读, 进缓存
    expect(breaker.getMeasurements).toHaveBeenCalledTimes(1);
    await svc.turnOff(4);
    expect(breaker.getMeasurements).toHaveBeenCalledTimes(3);
  });

  it('非断路器回路读 /breaker 全量计量要拒绝', async () => {
    const { svc } = makeService({ hwCategory: 'power-relay' });
    await expect(svc.breakerMeasurements(4)).rejects.toThrow(ConflictException);
  });

  it('断路器回路能拿到分相/温度/报警全量', async () => {
    const { svc, breaker } = makeService();
    const m = await svc.breakerMeasurements(4);
    expect(breaker.getMeasurements).toHaveBeenCalledWith('BREAKER-LED-1');
    expect(m.temperatures).toHaveLength(4);
    expect(m.leakageCurrent).toBe(0.003);
    expect(m.alarms.any).toBe(false);
  });
});
