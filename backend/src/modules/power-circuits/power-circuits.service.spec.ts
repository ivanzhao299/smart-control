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
} = {}) {
  const row = opts.row ?? circuitRow();
  const repo = {
    findOne: jest.fn().mockResolvedValue(row),
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
  );
  return { svc, repo, hwRepo, breaker, epo, adapter, row };
}

describe('PowerCircuitsService · 1f-led 回路自愈到真空开', () => {
  it('还指着从没到货的 RELAY-1F-1 → 改指 BREAKER-LED-1 并修额定值', async () => {
    const old = circuitRow({
      gatewayCode: 'RELAY-1F-1', relayChannel: 4,
      ratedVoltage: 220, ratedCurrent: 20, ratedPower: 3500, description: null,
    });
    const { svc, repo } = makeService({ row: old });
    await svc.onModuleInit();
    expect(old.gatewayCode).toBe('BREAKER-LED-1');
    expect(old.relayChannel).toBeNull();
    expect(old.ratedVoltage).toBe(380);
    expect(old.ratedCurrent).toBe(40);
    expect(old.ratedPower).toBe(19000);
    expect(repo.save).toHaveBeenCalled();
  });

  it('已经指向空开(或被人工改过) → 不再动它', async () => {
    const already = circuitRow({ gatewayCode: 'BREAKER-LED-1', ratedVoltage: 400 });
    const { svc } = makeService({ row: already });
    await svc.onModuleInit();
    expect(already.ratedVoltage).toBe(400); // 人工值保留
  });
});

describe('PowerCircuitsService · 断路器回路路由', () => {
  it('gatewayCode 指向 power-breaker 硬件 → 打真闸, 不碰时序器', async () => {
    const { svc, breaker, epo } = makeService();
    await svc.turnOn(4);
    expect(breaker.turnOn).toHaveBeenCalledWith('1f-led');
    expect(epo.setChannel).not.toHaveBeenCalled();
  });

  it('分闸走 turnOff', async () => {
    const { svc, breaker } = makeService();
    await svc.turnOff(4);
    expect(breaker.turnOff).toHaveBeenCalledWith('1f-led');
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
    const { svc, breaker } = makeService();
    await svc.detail(4);                             // 第 1 次读, 进缓存
    expect(breaker.getMeasurements).toHaveBeenCalledTimes(1);
    await svc.turnOff(4);                            // 应清缓存, 且 toView 再读一次
    expect(breaker.getMeasurements).toHaveBeenCalledTimes(2);
  });

  it('非断路器回路读 /breaker 全量计量要拒绝', async () => {
    const { svc } = makeService({ hwCategory: 'power-relay' });
    await expect(svc.breakerMeasurements(4)).rejects.toThrow(ConflictException);
  });

  it('断路器回路能拿到分相/温度/报警全量', async () => {
    const { svc } = makeService();
    const m = await svc.breakerMeasurements(4);
    expect(m.temperatures).toHaveLength(4);
    expect(m.leakageCurrent).toBe(0.003);
    expect(m.alarms.any).toBe(false);
  });
});
