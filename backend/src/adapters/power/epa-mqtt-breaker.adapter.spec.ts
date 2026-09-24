import type { ConfigService } from '@nestjs/config';
import type { Logger } from 'winston';
import { EpaMqttBreakerAdapter } from './epa-mqtt-breaker.adapter';

const fakeLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

const mockConfig = (): ConfigService =>
  ({ getOrThrow: () => ({ mock: true, mockLatencyMs: 0 }) }) as unknown as ConfigService;

describe('EpaMqttBreakerAdapter mock path', () => {
  it('keeps each 4G circuit independent and exposes single-phase measurements', async () => {
    const adapter = new EpaMqttBreakerAdapter(mockConfig(), fakeLogger());
    await adapter.turnOn('OUTDOOR-LIGHT-1');
    await adapter.turnOff('PUMP-1');

    expect((await adapter.getStatus('OUTDOOR-LIGHT-1')).data).toEqual({
      on: true,
      switchState: 'closed',
    });
    expect((await adapter.getStatus('PUMP-1')).data).toEqual({
      on: false,
      switchState: 'open',
    });
    const m = (await adapter.getMeasurements('OUTDOOR-LIGHT-1')).data!;
    expect(m.voltages).toEqual([220, 0, 0]);
    expect(m.powers[3]).toBe(1100);
  });
});
