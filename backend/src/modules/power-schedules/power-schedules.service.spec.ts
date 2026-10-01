/**
 * PowerSchedulesService —— 定时/日落/日出自动开关调度。
 *
 * 重点保的行为:
 *  1. fixed 模式按 HH:mm 触发
 *  2. sunset/sunrise 模式以参考时点 + offsetMin 得到触发时刻 (绝对时间, 跨午夜正确)
 *  3. offsetMin 范围 ±600 (前后 10 小时), 越界拒绝
 *  4. 星期匹配按"触发日"过滤
 *  5. 极昼/极夜 (参考时点 null) 不触发
 *  6. nextRun 返回下一次触发时间 (供 PWA 展示)
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
      opts.hwAddressing === null
        ? null
        : { code: 'CB4G-LIGHT-1', addressing: opts.hwAddressing ?? JSON.stringify({ fId: 'x', lat: 35.0685, lng: 118.1868 }) },
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

describe('PowerSchedulesService · fixed 模式动作', () => {
  it('fire on → PowerCircuitsService.turnOn(circuitId)', async () => {
    const { svc, circuits } = makeService();
    await (svc as any).fire(schedule({ action: 'on' }), new Date());
    expect(circuits.turnOn).toHaveBeenCalledWith(101);
    expect(circuits.turnOff).not.toHaveBeenCalled();
  });

  it('fire off → turnOff(circuitId)', async () => {
    const { svc, circuits } = makeService();
    await (svc as any).fire(schedule({ action: 'off' }), new Date());
    expect(circuits.turnOff).toHaveBeenCalledWith(101);
  });

  it('fire 失败只记日志, 不抛 (调度循环不能崩)', async () => {
    const bad = makeService();
    bad.circuits.turnOn.mockRejectedValue(new Error('平台超时'));
    await expect(
      (bad.svc as any).fire(schedule({ action: 'on' }), new Date()),
    ).resolves.toBeUndefined();
  });
});

describe('PowerSchedulesService · triggerDate 触发时刻', () => {
  const anchor = new Date(2026, 9, 1, 12, 0); // 锚点日 2026-10-01

  it('fixed: 触发时刻 = 锚点日当天 HH:mm', async () => {
    const { svc } = makeService();
    const t = await (svc as any).triggerDate(schedule({ mode: 'fixed', time: '18:30' }), anchor);
    expect(t.getFullYear()).toBe(2026);
    expect(t.getMonth()).toBe(9);
    expect(t.getDate()).toBe(1);
    expect(t.getHours()).toBe(18);
    expect(t.getMinutes()).toBe(30);
  });

  it('sunset offset 0: 触发时刻 = 锚点日日落 (~18 点)', async () => {
    const { svc } = makeService();
    const t: Date = await (svc as any).triggerDate(schedule({ mode: 'sunset', offsetMin: 0 }), anchor);
    expect(t.getHours()).toBeGreaterThanOrEqual(17);
    expect(t.getHours()).toBeLessThan(19);
  });

  it('sunset -30: 比日落时刻早 30 分钟', async () => {
    const { svc } = makeService();
    const base: Date = await (svc as any).triggerDate(schedule({ mode: 'sunset', offsetMin: 0 }), anchor);
    const shifted: Date = await (svc as any).triggerDate(schedule({ mode: 'sunset', offsetMin: -30 }), anchor);
    expect(base.getTime() - shifted.getTime()).toBe(30 * 60_000);
  });

  it('跨日: sunset +600 (10 小时) → 落到锚点次日凌晨, 日期 +1', async () => {
    const { svc } = makeService();
    const t: Date = await (svc as any).triggerDate(schedule({ mode: 'sunset', offsetMin: 600 }), anchor);
    expect(t.getDate()).toBe(2); // 10-01 → 10-02
    expect(t.getHours()).toBeLessThan(6); // 凌晨
  });

  it('跨日: sunrise -600 (10 小时) → 落到锚点前一日晚间, 日期 -1', async () => {
    const { svc } = makeService();
    const t: Date = await (svc as any).triggerDate(schedule({ mode: 'sunrise', offsetMin: -600 }), anchor);
    expect(t.getMonth()).toBe(8); // 10-01 → 09-30 (9 月)
    expect(t.getDate()).toBe(30);
    expect(t.getHours()).toBeGreaterThanOrEqual(18); // 晚间
  });

  it('sunrise offset 0: 触发时刻 = 锚点日日出 (~6 点)', async () => {
    const { svc } = makeService();
    const t: Date = await (svc as any).triggerDate(schedule({ mode: 'sunrise', offsetMin: 0 }), anchor);
    expect(t.getHours()).toBeGreaterThanOrEqual(5);
    expect(t.getHours()).toBeLessThan(7);
  });
});

describe('PowerSchedulesService · offsetMin 校验 (±600 / 10 小时)', () => {
  const { svc } = makeService();
  const base = { circuitId: 101, action: 'on', mode: 'sunset' };

  it('+600 / -600 通过', () => {
    expect(() => (svc as any).assertValid({ ...base, offsetMin: 600 })).not.toThrow();
    expect(() => (svc as any).assertValid({ ...base, offsetMin: -600 })).not.toThrow();
  });
  it('+601 / -601 拒绝', () => {
    expect(() => (svc as any).assertValid({ ...base, offsetMin: 601 })).toThrow();
    expect(() => (svc as any).assertValid({ ...base, offsetMin: -601 })).toThrow();
  });
  it('非整数拒绝', () => {
    expect(() => (svc as any).assertValid({ ...base, offsetMin: 1.5 })).toThrow();
  });
});

describe('PowerSchedulesService · 坐标解析', () => {
  it('addressing 含经纬度 → 采用', async () => {
    const { svc } = makeService({
      hwAddressing: JSON.stringify({ fId: 'x', lat: 39.9, lng: 116.4 }),
    });
    const coord = await (svc as any).resolveCoord(101);
    expect(coord).toEqual({ lat: 39.9, lng: 116.4 });
  });

  it('addressing 无经纬度 → 回落园区默认', async () => {
    const { svc } = makeService({ hwAddressing: JSON.stringify({ fId: 'x' }) });
    const coord = await (svc as any).resolveCoord(101);
    expect(coord.lat).toBeCloseTo(35.0685, 3);
    expect(coord.lng).toBeCloseTo(118.1868, 3);
  });
});

describe('PowerSchedulesService · 星期匹配 (按触发日)', () => {
  const { svc } = makeService();
  it('weekdays=1,3,5: 周二(2)/周四(4)不触发, 周一(1)/周五(5)触发', () => {
    expect((svc as any).matchesWeekday(schedule({ weekdays: '1,3,5' }), 2)).toBe(false);
    expect((svc as any).matchesWeekday(schedule({ weekdays: '1,3,5' }), 4)).toBe(false);
    expect((svc as any).matchesWeekday(schedule({ weekdays: '1,3,5' }), 1)).toBe(true);
    expect((svc as any).matchesWeekday(schedule({ weekdays: '1,3,5' }), 5)).toBe(true);
  });
  it('weekdays 为空 → 每天触发', () => {
    expect((svc as any).matchesWeekday(schedule({ weekdays: null }), 4)).toBe(true);
  });
});

describe('PowerSchedulesService · nextRun 展示', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fixed 23:59 且现在 12:00 → 下一次今天 23:59', async () => {
    const { svc } = makeService({ rows: [schedule({ mode: 'fixed', time: '23:59', action: 'off' })] });
    jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 9, 1, 12, 0).getTime());
    const next = await svc.nextRun(101);
    expect(next).not.toBeNull();
    expect(next!.action).toBe('off');
    const at = new Date(next!.at);
    expect(at.getHours()).toBe(23);
    expect(at.getMinutes()).toBe(59);
  });

  it('无 enabled 规则 → null', async () => {
    const { svc } = makeService({ rows: [schedule({ enabled: false })] });
    expect(await svc.nextRun(101)).toBeNull();
  });
});
