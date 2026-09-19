/**
 * EpaBreakerAdapter —— mock 路径行为。
 *
 * 真机路径(真实 Modbus 收发)靠 epa-breaker-registers.spec.ts 的 16 个金标准测试
 * 保证编解码正确；驱动目录契约由迁移测试覆盖，这里只测 adapter 层能装配、mock 态自洽。
 */
import type { Logger } from 'winston';
import type { ConfigService } from '@nestjs/config';
import { EpaBreakerAdapter } from './epa-breaker.adapter';
import { TcpClient } from '../transports/tcp-client';
import { ModbusRtuClient } from '../transports/modbus-rtu';

const fakeLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

/** mock=true 的 ConfigService: 让 adapter 走 mock 路径, 不碰真机 */
function mockConfig(): ConfigService {
  return {
    getOrThrow: () => ({ mock: true, mockLatencyMs: 0 }),
  } as unknown as ConfigService;
}

function realConfig(): ConfigService {
  return {
    getOrThrow: () => ({ mock: false, mockLatencyMs: 0 }),
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

describe('EpaBreakerAdapter · 多断路器精确寻址', () => {
  afterEach(() => jest.restoreAllMocks());

  it('按 hardware code 查配置，并把同一转换器上的命令发给各自 slaveId', async () => {
    const rows = new Map([
      [
        'BREAKER-A',
        {
          code: 'BREAKER-A',
          category: 'power-breaker',
          enabled: true,
          ip: '192.168.50.21',
          addressing: '{"port":502,"slaveId":1}',
        },
      ],
      [
        'BREAKER-B',
        {
          code: 'BREAKER-B',
          category: 'power-breaker',
          enabled: true,
          ip: '192.168.50.21',
          addressing: '{"port":502,"slaveId":2}',
        },
      ],
    ]);
    const repo = {
      findOne: jest.fn(
        async (query: { where: { code: string } }) => rows.get(query.where.code) ?? null,
      ),
      find: jest.fn().mockResolvedValue(Array.from(rows.values())),
    };
    const frames: Buffer[] = [];
    jest.spyOn(TcpClient.prototype, 'sendAndExpect').mockImplementation(async (payload) => {
      const frame = Buffer.from(payload as Buffer);
      frames.push(frame);
      return frame;
    });

    const adapter = new EpaBreakerAdapter(realConfig(), fakeLogger(), undefined, repo as never);
    expect((await adapter.turnOn('BREAKER-A')).ok).toBe(true);
    expect((await adapter.turnOff('BREAKER-B')).ok).toBe(true);

    expect(frames.map((frame) => frame.readUInt8(0))).toEqual([1, 2]);
    expect(frames.map((frame) => frame.readUInt16BE(4))).toEqual([1, 2]);
    expect(repo.findOne).toHaveBeenNthCalledWith(1, {
      where: { code: 'BREAKER-A', category: 'power-breaker', enabled: true },
    });
    expect(repo.findOne).toHaveBeenNthCalledWith(2, {
      where: { code: 'BREAKER-B', category: 'power-breaker', enabled: true },
    });
  });

  it('未知或禁用的硬件编号直接拒绝，不回落到旧断路器', async () => {
    const repo = { findOne: jest.fn().mockResolvedValue(null) };
    const send = jest.spyOn(TcpClient.prototype, 'sendAndExpect');
    const adapter = new EpaBreakerAdapter(realConfig(), fakeLogger(), undefined, repo as never);

    const result = await adapter.turnOn('BREAKER-NOT-FOUND');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('不存在、类型不符或已禁用');
    expect(send).not.toHaveBeenCalled();
  });

  it('地址配置不合法时拒绝下发', async () => {
    const repo = {
      findOne: jest.fn().mockResolvedValue({
        code: 'BREAKER-BAD',
        category: 'power-breaker',
        enabled: true,
        ip: '192.168.50.21',
        addressing: '{"port":502,"slaveId":0}',
      }),
    };
    const send = jest.spyOn(TcpClient.prototype, 'sendAndExpect');
    const adapter = new EpaBreakerAdapter(realConfig(), fakeLogger(), undefined, repo as never);

    const result = await adapter.turnOn('BREAKER-BAD');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('slaveId 无效');
    expect(send).not.toHaveBeenCalled();
  });

  it('同一转换器下 slaveId 重复时拒绝下发，避免多台同时动作', async () => {
    const target = {
      code: 'BREAKER-A',
      category: 'power-breaker',
      enabled: true,
      ip: '192.168.50.21',
      addressing: '{"port":502,"slaveId":255}',
    };
    const duplicate = {
      code: 'BREAKER-B',
      category: 'power-breaker',
      enabled: true,
      ip: '192.168.50.21',
      addressing: '{"port":502,"slaveId":255}',
    };
    const repo = {
      findOne: jest.fn().mockResolvedValue(target),
      find: jest.fn().mockResolvedValue([target, duplicate]),
    };
    const send = jest.spyOn(TcpClient.prototype, 'sendAndExpect');
    const adapter = new EpaBreakerAdapter(realConfig(), fakeLogger(), undefined, repo as never);

    const result = await adapter.turnOn('BREAKER-A');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('slaveId 都是 255');
    expect(send).not.toHaveBeenCalled();
  });

  it('安全改址：先写物理地址、用新地址验读，再保存硬件台账', async () => {
    const row = {
      id: 11,
      code: 'BREAKER-NEW',
      category: 'power-breaker',
      enabled: true,
      ip: '192.168.50.21',
      addressing: '{"port":502,"slaveId":255,"cabinet":"A"}',
    };
    const repo = {
      findOne: jest.fn().mockResolvedValue(row),
      find: jest.fn().mockResolvedValue([row]),
      save: jest.fn(async (value: unknown) => value),
    };
    const frames: Buffer[] = [];
    jest.spyOn(TcpClient.prototype, 'sendAndExpect').mockImplementation(async (payload) => {
      const frame = Buffer.from(payload as Buffer);
      frames.push(frame);
      if (frame[1] === 0x06) return frame;
      const pdu = Buffer.from([1, 0x03, 0x04, 0x00, 0x32, 0x00, 0x01]);
      return Buffer.concat([pdu, ModbusRtuClient.crc16(pdu)]);
    });

    const adapter = new EpaBreakerAdapter(realConfig(), fakeLogger(), undefined, repo as never);
    const result = await adapter.changeSlaveId('BREAKER-NEW', 1);

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ oldSlaveId: 255, newSlaveId: 1, verified: true });
    expect(frames[0].subarray(0, 6)).toEqual(Buffer.from([255, 0x06, 0x01, 0x03, 0x00, 0x01]));
    expect(frames[1][0]).toBe(1);
    expect(JSON.parse(row.addressing)).toEqual({ port: 502, slaveId: 1, cabinet: 'A' });
    expect(repo.save).toHaveBeenCalledWith(row);
  });

  it('目标地址在同一 485 总线上已占用时拒绝改址', async () => {
    const target = {
      code: 'BREAKER-NEW',
      category: 'power-breaker',
      enabled: true,
      ip: '192.168.50.21',
      addressing: '{"port":502,"slaveId":255}',
    };
    const occupied = {
      code: 'BREAKER-EXISTING',
      category: 'power-breaker',
      enabled: true,
      ip: '192.168.50.21',
      addressing: '{"port":502,"slaveId":1}',
    };
    const repo = {
      findOne: jest.fn().mockResolvedValue(target),
      find: jest.fn().mockResolvedValue([target, occupied]),
      save: jest.fn(),
    };
    const send = jest.spyOn(TcpClient.prototype, 'sendAndExpect');
    const adapter = new EpaBreakerAdapter(realConfig(), fakeLogger(), undefined, repo as never);

    const result = await adapter.changeSlaveId('BREAKER-NEW', 1);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('slaveId 都是 1');
    expect(send).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });
});
