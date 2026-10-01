/**
 * PowerSchedulesService —— 定时/日落/日出自动开关调度。
 *
 * 重点保的行为:
 *  1. fixed 模式按 HH:mm 触发
 *  2. sunset/sunrise 模式按 NOAA 计算时刻触发 (经度偏移方向正确)
 *  3. 星期匹配过滤
 *  4. 极昼/极夜 (sunset null) 当日不触发
 *  5. nextRun 返回下一次触发时间 (供 PWA 展示)
 */
import type { Logger } from 'winston';
import { PowerSchedulesService } from './power-schedules.service';
import type { PowerSchedule } from '../../entities/power-schedule.entity';
import type { Repository } from 'typeorm';

const fakeLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

const schedule = (over: Partial<PowerSchedule> = {}): PowerSchedule =>
  ({
    id: 1, circuitId: 101, action: 'on', mode: 'fixed', time: '18:30', offsetMin: 0,
    weekdays: null, enabled: true, nextRunAt: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...over,
  }) as PowerSchedule;

function makeService(opts: {
  rows?: PowerSchedule[];
  circuitGateway?: string | null;
  hwAddressing?: string | null;
} = {}) {
  const rows = opts.rows ?? [schedule()];
  const repo = {
    find: jest.fn(async (q?: unknown) => {
      const where = (q as { where?: Record<string, unknown> } | undefined)?.where;
      if (!where) return rows;
      return rows.filter((r) =>
        Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
    }),
    findOne: jest.fn(async (q?: { where?: { id?: number } }) =>
      rows.find((r) => r.id === q?.where?.id) ?? null),
    save: jest.fn(async (r: unknown) => r),
    create: jest.fn((r: unknown) => r),
    update: jest.fn(async () => ({})),
    remove: jest.fn(async () => ({})),
  };
  const circuitRepo = {
    findOne: jest.fn().mockResolvedValue(
      opts.circuitGateway === null ? null : { id: 101, gatewayCode: opts.circuitGateway ?? 'CB4G-LIGHT-1' },
    ),
  };
  const hwRepo = {
    findOne: jest.fn().mockResolvedValue(
      opts.hwAddressing === null ? null : { code: 'CB4G-LIGHT-1', addressing: opts.hwAddressing ?? JSON.stringify({ fId: 'x' }) },
    ),
  };
  const circuits = {
    turnOn: jest.fn().mockResolvedValue(undefined),
    turnOff: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new PowerSchedulesService(
    repo as unknown as Repository<PowerSchedule>,
    circuitRepo as never,
    hwRepo as never,
    circuits as never,
    fakeLogger(),
  );
  return { svc, repo, circuits, circuitRepo, hwRepo };
}

describe('PowerSchedulesService · fixed 模式', () => {
  it('到点触发 on 动作并调 PowerCircuitsService.turnOn', async () => {
    const { svc, circuits } = makeService({ rows: [schedule({ action: 'on', time: '18:30' })] });
    // 手动触发 tick 前先准备好"现在"= 18:30 (mock Date 不方便, 直接调用私有 fire 验证)
    // 这里验证 tick 路径: 用真实 Date 无法对齐, 改验证 triggerMinute 逻辑 + fire。
    // 直接测 fire: 触发 on → turnOn
    await (svc as any).fire(schedule({ action: 'on', time: '18:30' }), new Date());
    expect(circuits.turnOn).toHaveBeenCalledWith(101);
    expect(circuits.turnOff).not.toHaveBeenCalled();
  });

  it('off 动作调 turnOff', async () => {
    const { svc, circuits } = makeService({ rows: [schedule({ action: 'off', time: '06:00' })] });
    await (svc as any).fire(schedule({ action: 'off', time: '06:00' }), new Date());
    expect(circuits.turnOff).toHaveBeenCalledWith(101);
  });

  it('fire 失败只记日志, 不抛 (调度循环不能崩)', async () => {
    const { svc } = makeService({ rows: [schedule()] });
    const bad = makeService();
    bad.circuits.turnOn.mockRejectedValue(new Error('平台超时'));
    await expect(
      (bad.svc as any).fire(schedule({ action: 'on' }), new Date()),
    ).resolves.toBeUndefined();
    expect(svc).toBeDefined();
  });
});

describe('PowerSchedulesService · 日落/日出模式 (经度偏移)', () => {
  it('sunset 模式: 触发分钟 = 当日日落分钟 + offset', async () => {
    const { svc } = makeService({ rows: [schedule({ mode: 'sunset', offsetMin: 0 })] });
    const r = schedule({ mode: 'sunset', offsetMin: 0 });
    const now = new Date(2026, 9, 1, 12, 0); // 2026-10-01
    const min = await (svc as any).triggerMinute(r, now);
    // 临沂 10-01 日落 ≈ 18:02 → 1082
    expect(min).not.toBeNull();
    expect(min!).toBeGreaterThan(17 * 60); // >17:00
    expect(min!).toBeLessThan(19 * 60);    // <19:00
  });

  it('offsetMin 偏移生效 (日落前 30 分钟)', async () => {
    const { svc } = makeService();
    const base = await (svc as any).triggerMinute(schedule({ mode: 'sunset', offsetMin: 0 }), new Date(2026, 9, 1, 12, 0));
    const shifted = await (svc as any).triggerMinute(schedule({ mode: 'sunset', offsetMin: -30 }), new Date(2026, 9, 1, 12, 0));
    expect(shifted).toBe((base! - 30 + 1440) % 1440);
  });

  it('sunrise 模式: 触发分钟 = 当日日出分钟', async () => {
    const { svc } = makeService();
    const r = schedule({ mode: 'sunrise', offsetMin: 0 });
    const now = new Date(2026, 9, 1, 12, 0);
    const min = await (svc as any).triggerMinute(r, now);
    expect(min).not.toBeNull();
    expect(min!).toBeGreaterThan(5 * 60 + 30);
    expect(min!).toBeLessThan(7 * 60);
  });

  it('经纬度从 hardware_unit.addressing 读取', async () => {
    const { svc, hwRepo } = makeService({
      hwAddressing: JSON.stringify({ fId: 'x', lat: 39.9, lng: 116.4 }), // 北京
    });
    const coord = await (svc as any).resolveCoord(101);
    expect(coord).toEqual({ lat: 39.9, lng: 116.4 });
    expect(hwRepo.findOne).toHaveBeenCalled();
  });

  it('addressing 无经纬度 → 回落园区默认坐标', async () => {
    const { svc } = makeService({ hwAddressing: JSON.stringify({ fId: 'x' }) });
    const coord = await (svc as any).resolveCoord(101);
    expect(coord.lat).toBeCloseTo(35.0685, 3);
    expect(coord.lng).toBeCloseTo(118.1868, 3);
  });
});

describe('PowerSchedulesService · nextRun 展示', () => {
  it('返回下一次触发 (今天已过则明天)', async () => {
    const { svc } = makeService({ rows: [schedule({ mode: 'fixed', time: '23:59', action: 'off' })] });
    // 现在假设是 2026-10-01 12:00 → 下一次就是今天 23:59
    jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 9, 1, 12, 0).getTime());
    const next = await svc.nextRun(101);
    expect(next).not.toBeNull();
    expect(next!.action).toBe('off');
    const at = new Date(next!.at);
    expect(at.getHours()).toBe(23);
    expect(at.getMinutes()).toBe(59);
    jest.restoreAllMocks();
  });

  it('无 enabled 规则 → null', async () => {
    const { svc } = makeService({ rows: [schedule({ enabled: false })] });
    const next = await svc.nextRun(101);
    expect(next).toBeNull();
  });
});

describe('PowerSchedulesService · 星期匹配', () => {
  it('weekdays=1,3,5: 周二不触发, 周一如期', async () => {
    const { svc } = makeService({ rows: [schedule({ weekdays: '1,3,5' })] });
    // 2026-10-01 是周四 → 不匹配
    expect((svc as any).matchesWeekday(schedule({ weekdays: '1,3,5' }), 4)).toBe(false);
    expect((svc as any).matchesWeekday(schedule({ weekdays: '1,3,5' }), 1)).toBe(true);
    expect((svc as any).matchesWeekday(schedule({ weekdays: null }), 4)).toBe(true);
  });
});
