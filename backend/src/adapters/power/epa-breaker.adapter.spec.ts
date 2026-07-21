/**
 * EpaBreakerAdapter —— describe() 契约 + mock 路径行为。
 *
 * 真机路径(真实 Modbus 收发)靠 epa-breaker-registers.spec.ts 的 16 个金标准测试
 * 保证编解码正确; 这里只测 adapter 层能装配、describe() 契约稳定、mock 态自洽。
 */
import type { Logger } from 'winston';
import type { ConfigService } from '@nestjs/config';
import { EpaBreakerAdapter } from './epa-breaker.adapter';

const fakeLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

/** mock=true 的 ConfigService: 让 adapter 走 mock 路径, 不碰真机 */
function mockConfig(): ConfigService {
  return {
    getOrThrow: () => ({ mock: true, mockLatencyMs: 0 }),
  } as unknown as ConfigService;
}

function makeAdapter(): EpaBreakerAdapter {
  return new EpaBreakerAdapter(mockConfig(), fakeLogger());
}

describe('EpaBreakerAdapter · describe() 驱动目录契约', () => {
  const d = EpaBreakerAdapter.describe();

  it('kind 稳定为 epa-breaker(改名会破坏外键关联)', () => {
    expect(d.kind).toBe('epa-breaker');
  });
  it('category=power-breaker, protocol=modbus-rtu', () => {
    expect(d.category).toBe('power-breaker');
    expect(d.protocol).toBe('modbus-rtu');
  });
  it('能力含合闸/分闸/读状态/计量', () => {
    expect(d.capabilities).toEqual(
      expect.arrayContaining(['turn_on', 'turn_off', 'get_status', 'get_measurements']),
    );
  });
  it('paramSchema 必填 IP, 有端口/从机号默认值(前端据此生成表单)', () => {
    expect(d.paramSchema?.ip?.required).toBe(true);
    expect(d.paramSchema?.port?.default).toBe(502);
    expect(d.paramSchema?.slaveId?.default).toBe(1);
  });
});

describe('EpaBreakerAdapter · mock 路径自洽', () => {
  it('合闸后 getStatus=on/closed, 分闸后 off/open', async () => {
    const a = makeAdapter();
    const on = await a.turnOn('breaker-led');
    expect(on.ok).toBe(true);
    expect(on.data).toEqual({ on: true, switchState: 'closed' });

    const st1 = await a.getStatus('breaker-led');
    expect(st1.data).toEqual({ on: true, switchState: 'closed' });

    const off = await a.turnOff('breaker-led');
    expect(off.data).toEqual({ on: false, switchState: 'open' });

    const st2 = await a.getStatus('breaker-led');
    expect(st2.data).toEqual({ on: false, switchState: 'open' });
  });

  it('合闸时计量有读数(三相电压~220/功率>0), 分闸时归零', async () => {
    const a = makeAdapter();
    await a.turnOn('b1');
    const onM = await a.getMeasurements('b1');
    expect(onM.ok).toBe(true);
    expect(onM.data!.voltages[0]).toBeGreaterThan(200);
    expect(onM.data!.powers[3]).toBeGreaterThan(0); // 总功率
    expect(onM.data!.frequency).toBe(50);

    await a.turnOff('b1');
    const offM = await a.getMeasurements('b1');
    expect(offM.data!.voltages).toEqual([0, 0, 0]);
    expect(offM.data!.powers[3]).toBe(0);
    expect(offM.data!.switchState).toBe('open');
  });

  it('多台断路器状态互不干扰', async () => {
    const a = makeAdapter();
    await a.turnOn('b1');
    await a.turnOff('b2');
    expect((await a.getStatus('b1')).data!.on).toBe(true);
    expect((await a.getStatus('b2')).data!.on).toBe(false);
  });

  it('mock 态 healthCheck 通过', async () => {
    const a = makeAdapter();
    const h = await a.healthCheck();
    expect(h.ok).toBe(true);
    expect(h.data).toEqual({ ok: true });
  });
});
