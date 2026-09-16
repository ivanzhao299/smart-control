/**
 * EpaBreakerAdapter —— mock 路径行为。
 *
 * 真机路径(真实 Modbus 收发)靠 epa-breaker-registers.spec.ts 的 16 个金标准测试
 * 保证编解码正确；驱动目录契约由迁移测试覆盖，这里只测 adapter 层能装配、mock 态自洽。
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
