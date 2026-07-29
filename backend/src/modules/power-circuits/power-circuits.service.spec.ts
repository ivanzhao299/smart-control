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
    // 按 code 匹配, 不匹配返回 null —— 2026-07-27 修: 原来无条件返回 row,
    // onModuleInit 里 healProjectorSeqChannel 查 seq-4/seq-5 也拿到这行
    // 1f-led 测试数据, 把它的 relayChannel 改成 5, CI 每次推送都红一次。
    // 生产不受影响 (真库按 code 各查各行), 纯测试桩失真。
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
    const { svc } = makeService();
    const m = await svc.breakerMeasurements(4);
    expect(m.temperatures).toHaveLength(4);
    expect(m.leakageCurrent).toBe(0.003);
    expect(m.alarms.any).toBe(false);
  });
});

describe('PowerCircuitsService · 开机联动 (2026-07-28 业主: LED→功放 / 投影→融合器)', () => {
  const seqRow = (over: Partial<PowerCircuit> = {}): PowerCircuit =>
    circuitRow({
      id: 15, code: 'seq-5', name: '投影仪', category: 'audio-seq',
      gatewayCode: 'AUDIO-PWR-SEQ-1', relayChannel: 5,
      ...over,
    });

  /** 时序器/断路器混排的多行桩: findOne 按 code / id, find 按 category 过滤 */
  function makeLinkService(rows: PowerCircuit[], opts: { failChannel?: number } = {}) {
    const repo = {
      findOne: jest.fn(async (q?: { where?: { code?: string; id?: number } }) =>
        rows.find((r) => (q?.where?.code !== undefined ? r.code === q.where.code : r.id === q?.where?.id)) ?? null),
      find: jest.fn(async (q?: { where?: { category?: string } }) =>
        rows.filter((r) => !q?.where?.category || r.category === q.where.category)),
      save: jest.fn(async (r: unknown) => r),
      create: jest.fn((r: unknown) => r),
    };
    // gatewayCode 决定路由: AUDIO-PWR-SEQ-1 → 时序器, BREAKER-LED-1 → 断路器
    const hwRepo = {
      findOne: jest.fn(async (q?: { where?: { code?: string } }) =>
        q?.where?.code === 'AUDIO-PWR-SEQ-1'
          ? { code: 'AUDIO-PWR-SEQ-1', category: 'audio-power', enabled: true }
          : { code: 'BREAKER-LED-1', category: 'power-breaker', enabled: true }),
    };
    const ok = (data: unknown) => ({ ok: true, data, deviceId: 'x', command: 'c', mock: false, durationMs: 1 });
    const breaker = {
      turnOn: jest.fn().mockResolvedValue(ok({ on: true, switchState: 'closed' })),
      turnOff: jest.fn().mockResolvedValue(ok({ on: false, switchState: 'open' })),
      getMeasurements: jest.fn().mockResolvedValue(ok(measurements())),
    };
    const epo = {
      setChannel: jest.fn(async (ch: number) => {
        if (ch === opts.failChannel) throw new Error(`COM1 write failed (ch ${ch})`);
      }),
      readStatus: jest.fn().mockResolvedValue(ok({ channels: Array(8).fill(false) })),
    };
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
    return { svc, epo, breaker };
  }

  it('开投影仪 (seq-5) → 融合器 (seq-4) 跟着开', async () => {
    const rows = [seqRow(), seqRow({ id: 14, code: 'seq-4', name: '视频融合器', relayChannel: 4 })];
    const { svc, epo } = makeLinkService(rows);
    await svc.turnOn(15);
    expect(epo.setChannel).toHaveBeenCalledWith(5, true);
    expect(epo.setChannel).toHaveBeenCalledWith(4, true);
  });

  it('关投影仪只关 seq-5 —— "关"不联动 (投影页卡片自己管同关)', async () => {
    const rows = [seqRow(), seqRow({ id: 14, code: 'seq-4', name: '视频融合器', relayChannel: 4 })];
    const { svc, epo } = makeLinkService(rows);
    await svc.turnOff(15);
    expect(epo.setChannel).toHaveBeenCalledTimes(1);
    expect(epo.setChannel).toHaveBeenCalledWith(5, false);
  });

  it('开 LED 总闸 (1f-led) → 按名字找到「LED大屏功放」那路时序器跟着开', async () => {
    const rows = [
      circuitRow(), // id=4 1f-led 断路器
      seqRow({ id: 12, code: 'seq-2', name: 'LED大屏功放', relayChannel: 2 }),
    ];
    const { svc, epo, breaker } = makeLinkService(rows);
    await svc.turnOn(4);
    expect(breaker.turnOn).toHaveBeenCalledWith('1f-led');
    expect(epo.setChannel).toHaveBeenCalledWith(2, true);
  });

  it('时序器里没有名含 LED/大屏+功放 的路 → 联动跳过不报错', async () => {
    const rows = [circuitRow(), seqRow({ id: 12, code: 'seq-2', name: '时序 2 路', relayChannel: 2 })];
    const { svc, epo } = makeLinkService(rows);
    await svc.turnOn(4);
    expect(epo.setChannel).not.toHaveBeenCalled();
  });

  it('联动那路下发失败 → 主开关仍返回成功 (只记日志)', async () => {
    const rows = [seqRow(), seqRow({ id: 14, code: 'seq-4', name: '视频融合器', relayChannel: 4 })];
    const { svc, epo } = makeLinkService(rows, { failChannel: 4 });
    await expect(svc.turnOn(15)).resolves.toBeDefined();
    expect(epo.setChannel).toHaveBeenCalledWith(5, true);
  });
});
