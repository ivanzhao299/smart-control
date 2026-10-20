import { ConfigService } from '@nestjs/config';
import { NovaLedAdapter } from './nova-led.adapter';
import {
  frameSetLayer,
  VX_CARD_SLOT,
  VX_SOURCE,
} from './nova-vx1000-protocol';
import {
  DeviceProtocolError,
  DeviceTimeoutError,
} from '../errors';

const layerFrame = frameSetLayer({
  layerNo: 1,
  source: VX_SOURCE.HDMI20,
  cardSlot: VX_CARD_SLOT.HDMI20,
  width: 3612,
  height: 1462,
  startX: 0,
  startY: 0,
  priority: 0,
  opacity: 0x64,
  switchOn: true,
});

const okResponse = Buffer.concat([Buffer.from([0xaa, 0x55]), layerFrame.subarray(2)]);

const makeAdapter = (): {
  adapter: NovaLedAdapter;
  logger: { info: jest.Mock; warn: jest.Mock };
} => {
  const config = {
    getOrThrow: jest.fn(() => ({ mock: false, mockLatencyMs: 0 })),
  } as unknown as ConfigService;
  const logger = { info: jest.fn(), warn: jest.fn() };
  const registry = {
    register: jest.fn(),
    markOnline: jest.fn(),
    markFailure: jest.fn(),
  } as never;
  const adapter = new NovaLedAdapter(config, logger as never, registry);
  return { adapter, logger };
};

const setTcp = (
  adapter: NovaLedAdapter,
  sendAndReadAll: jest.Mock,
  sendAndExpect?: jest.Mock,
): void => {
  const tcp = {
    sendAndReadAll,
    sendAndExpect: sendAndExpect ?? jest.fn(),
  };
  (adapter as unknown as { tcp: typeof tcp }).tcp = tcp;
};

const internals = (adapter: NovaLedAdapter): {
  fastReconnect: boolean;
  fastReconnectTimer?: unknown;
  fastReconnectProbe: () => Promise<void>;
} => adapter as unknown as {
  fastReconnect: boolean;
  fastReconnectTimer?: unknown;
  fastReconnectProbe: () => Promise<void>;
};

describe('Nova V2460 variable-length response timing', () => {
  it('finishes a layer switch after a short quiet window instead of waiting for 64 bytes', async () => {
    const { adapter } = makeAdapter();
    const sendAndReadAll = jest.fn(async () => okResponse);
    const sendAndExpect = jest.fn();
    setTcp(adapter, sendAndReadAll, sendAndExpect);

    await expect(
      adapter.switchInput('LED-NOVA-1', { input: 'video' }),
    ).resolves.toMatchObject({ ok: true });
    expect(sendAndReadAll).toHaveBeenCalledWith(
      layerFrame,
      120,
      3000,
      undefined,
    );
    expect(sendAndExpect).not.toHaveBeenCalled();
  });
});

describe('Nova V2460 command in-request retry', () => {
  it('retries a transient connect timeout once and then succeeds', async () => {
    const { adapter } = makeAdapter();
    const sendAndReadAll = jest
      .fn()
      .mockRejectedValueOnce(
        new DeviceTimeoutError('led', 'tcp connect timed out after 3000ms to 192.168.50.30:5200'),
      )
      .mockResolvedValueOnce(okResponse);
    setTcp(adapter, sendAndReadAll);

    await expect(
      adapter.switchInput('LED-NOVA-1', { input: 'video' }),
    ).resolves.toMatchObject({ ok: true });
    expect(sendAndReadAll).toHaveBeenCalledTimes(2);
    expect(internals(adapter).fastReconnect).toBe(false);
  });

  it('retries a transient empty-frame (0B) protocol error', async () => {
    const { adapter } = makeAdapter();
    const sendAndReadAll = jest
      .fn()
      .mockRejectedValueOnce(
        new DeviceProtocolError('led', 'bad Nova response: frame too short (0B)'),
      )
      .mockResolvedValueOnce(okResponse);
    setTcp(adapter, sendAndReadAll);

    await expect(
      adapter.switchInput('LED-NOVA-1', { input: 'video' }),
    ).resolves.toMatchObject({ ok: true });
    expect(sendAndReadAll).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient protocol error', async () => {
    const { adapter } = makeAdapter();
    const sendAndReadAll = jest
      .fn()
      .mockRejectedValue(new DeviceProtocolError('led', 'unrelated protocol failure'));
    setTcp(adapter, sendAndReadAll);

    const r = await adapter.switchInput('LED-NOVA-1', { input: 'video' });
    expect(r).toMatchObject({ ok: false });
    expect(sendAndReadAll).toHaveBeenCalledTimes(1);
    adapter.onModuleDestroy();
  });
});

describe('Nova V2460 fast reconnect on network outage', () => {
  it('starts fast reconnect probing after retries are exhausted', async () => {
    const { adapter } = makeAdapter();
    const sendAndReadAll = jest
      .fn()
      .mockRejectedValue(
        new DeviceTimeoutError('led', 'tcp connect timed out after 3000ms to 192.168.50.30:5200'),
      );
    setTcp(adapter, sendAndReadAll);

    const r = await adapter.switchInput('LED-NOVA-1', { input: 'video' });
    expect(r).toMatchObject({ ok: false });
    // 两次尝试耗尽（首次 + 1 次重试）
    expect(sendAndReadAll).toHaveBeenCalledTimes(2);
    // 快速重连已启动（每 15s 探测）
    const s = internals(adapter);
    expect(s.fastReconnect).toBe(true);
    expect(s.fastReconnectTimer).toBeDefined();
    adapter.onModuleDestroy();
  });

  it('immediately runs fullscreen self-heal when a fast probe succeeds', async () => {
    const { adapter, logger } = makeAdapter();
    // 1) 启动阶段：命令全部失败 → 触发快速重连
    const sendAndReadAll = jest
      .fn()
      .mockRejectedValue(
        new DeviceTimeoutError('led', 'tcp connect timed out after 3000ms'),
      );
    // ping 始终成功（网络此刻已恢复）
    const sendAndExpect = jest
      .fn()
      .mockResolvedValue(Buffer.from([0xaa, 0x55, 0x00, 0x00]));
    setTcp(adapter, sendAndReadAll, sendAndExpect);

    const r = await adapter.switchInput('LED-NOVA-1', { input: 'video' });
    expect(r).toMatchObject({ ok: false });
    expect(internals(adapter).fastReconnect).toBe(true);

    // 2) 网络恢复：后续命令成功，手动触发一次快速探测
    sendAndReadAll.mockResolvedValue(okResponse);
    await internals(adapter).fastReconnectProbe();

    // 3) 快速重连已停止，且自愈（SetLayer + DisplayMode NORMAL）已下发
    const s = internals(adapter);
    expect(s.fastReconnect).toBe(false);
    expect(s.fastReconnectTimer).toBeUndefined();
    // 探测成功后的自愈调用：SetLayer / DisplayMode / SavePreset（均走 sendAndReadAll）
    expect(sendAndReadAll.mock.calls.length).toBeGreaterThanOrEqual(3);
    // 恢复事件以 warn 级记录（生产可见）
    expect(logger.warn).toHaveBeenCalled();
  });
});
