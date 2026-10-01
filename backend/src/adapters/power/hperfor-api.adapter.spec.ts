/**
 * HperforApiAdapter —— describe() 契约 + mock 路径行为。
 *
 * 真机路径(华普云 HTTP API 收发)已在 2026-10-01 现场实测(三台 4G 断路器合闸成功);
 * 这里只测 adapter 层装配、describe() 契约稳定、mock 态自洽、以及纯函数
 * mapMeasurements 的 L/N 表 → BreakerMeasurements 换算。
 */
import type { Logger } from 'winston';
import type { ConfigService } from '@nestjs/config';
import { HperforApiAdapter } from './hperfor-api.adapter';

const fakeLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

/** mock=true 的 ConfigService: 让 adapter 走 mock 路径, 不碰平台 */
function mockConfig(): ConfigService {
  return {
    getOrThrow: () => ({ mock: true, mockLatencyMs: 0 }),
  } as unknown as ConfigService;
}

function makeAdapter(): HperforApiAdapter {
  return new HperforApiAdapter(mockConfig(), fakeLogger());
}

describe('HperforApiAdapter · describe() 驱动目录契约', () => {
  const d = HperforApiAdapter.describe();

  it('kind 稳定为 hperfor-web(改名会破坏外键关联)', () => {
    expect(d.kind).toBe('hperfor-web');
  });
  it('category=power-breaker-web(与 485 版 power-breaker、MQTT 版 power-breaker-4g 隔离)', () => {
    expect(d.category).toBe('power-breaker-web');
    expect(d.protocol).toBe('http-json');
  });
  it('能力含合闸/分闸/读状态/计量', () => {
    expect(d.capabilities).toEqual(
      expect.arrayContaining(['turn_on', 'turn_off', 'get_status', 'get_measurements']),
    );
  });
  it('paramSchema 必填 fId(平台设备标识, 不是 Modbus 从机地址)', () => {
    expect(d.paramSchema?.fId?.required).toBe(true);
    expect(d.paramSchema?.password?.default).toBe('0');
  });
});

describe('HperforApiAdapter · mock 路径自洽', () => {
  it('合闸后 getStatus=on/closed, 分闸后 off/open', async () => {
    const a = makeAdapter();
    const on = await a.turnOn('CB4G-LIGHT-1');
    expect(on.ok).toBe(true);
    expect(on.data).toEqual({ on: true, switchState: 'closed' });

    const st1 = await a.getStatus('CB4G-LIGHT-1');
    expect(st1.data).toEqual({ on: true, switchState: 'closed' });

    const off = await a.turnOff('CB4G-LIGHT-1');
    expect(off.data).toEqual({ on: false, switchState: 'open' });

    const st2 = await a.getStatus('CB4G-LIGHT-1');
    expect(st2.data).toEqual({ on: false, switchState: 'open' });
  });

  it('合闸时计量有读数(单相电压~220/功率>0), 分闸时归零', async () => {
    const a = makeAdapter();
    await a.turnOn('b1');
    const onM = await a.getMeasurements('b1');
    expect(onM.ok).toBe(true);
    expect(onM.data!.voltages[0]).toBeGreaterThan(200);
    expect(onM.data!.voltages[1]).toBe(0); // 单相设备 B/C 相为 0
    expect(onM.data!.powers[3]).toBeGreaterThan(0); // 总功率
    expect(onM.data!.switchState).toBe('closed');

    await a.turnOff('b1');
    const offM = await a.getMeasurements('b1');
    expect(offM.data!.voltages).toEqual([0, 0, 0]);
    expect(offM.data!.powers[3]).toBe(0);
    expect(offM.data!.switchState).toBe('open');
  });

  it('多台断路器状态互不干扰(庭院亮化/鱼池供氧/园区路灯)', async () => {
    const a = makeAdapter();
    await a.turnOn('CB4G-LIGHT-1');
    await a.turnOff('CB4G-OXY-1');
    await a.turnOn('CB4G-ROAD-1');
    expect((await a.getStatus('CB4G-LIGHT-1')).data!.on).toBe(true);
    expect((await a.getStatus('CB4G-OXY-1')).data!.on).toBe(false);
    expect((await a.getStatus('CB4G-ROAD-1')).data!.on).toBe(true);
  });

  it('mock 态 healthCheck 通过', async () => {
    const a = makeAdapter();
    const h = await a.healthCheck();
    expect(h.ok).toBe(true);
    expect(h.data).toEqual({ ok: true });
  });
});

describe('HperforApiAdapter · mapMeasurements 纯函数(设备实测表 → BreakerMeasurements)', () => {
  // 实测返回(2026-10-01 园区路灯): [["温度（℃）",29.92,29.64],["电压（ V）",230.64,0.0],
  //  ["电流（ A）",0.03,0.0],["功率（W）",2.0,0.0]]
  it('L 相值映射到 A 相, B/C 相与 N 通道为 0', () => {
    const a = makeAdapter() as unknown as { mapMeasurements(t: Array<[string, number, number]>, on: boolean): import('./epa-breaker-registers').BreakerMeasurements };
    const table: Array<[string, number, number]> = [
      ['温度（℃）', 29.92, 29.64],
      ['电压（ V）', 230.64, 0.0],
      ['电流（ A）', 0.03, 0.0],
      ['功率（W）', 2.0, 0.0],
    ];
    const m = a.mapMeasurements(table, true);
    expect(m.voltages).toEqual([230.64, 0, 0]);
    expect(m.currents).toEqual([0.03, 0, 0]);
    expect(m.powers).toEqual([2, 0, 0, 2]);
    expect(m.temperatures[0]).toBe(29.92);
    expect(m.switchState).toBe('closed');
    expect(m.alarms.any).toBe(false);
  });

  it('分闸时 switchState=open(即使表里电压为 0)', () => {
    const a = makeAdapter() as unknown as { mapMeasurements(t: Array<[string, number, number]>, on: boolean): import('./epa-breaker-registers').BreakerMeasurements };
    const m = a.mapMeasurements([], false);
    expect(m.switchState).toBe('open');
    expect(m.voltages).toEqual([0, 0, 0]);
  });
});
