import { CommandDispatcherService } from './command-dispatcher.service';

describe('CommandDispatcherService HVAC zone authority', () => {
  it('fans scene actions out through the maintained database membership', async () => {
    const turnOn = jest.fn(async (id: string) => ({
      ok: true,
      deviceId: id,
      command: 'turnOn',
      mock: true,
      durationMs: 1,
    }));
    const zoneRepo = {
      findOne: jest.fn().mockResolvedValue({ code: 'site-zone', name: '现场分区', enabled: true }),
    };
    const indoorRepo = {
      find: jest.fn().mockResolvedValue([
        { idx: 41, zoneCode: 'site-zone', enabled: true },
        { idx: 42, zoneCode: 'site-zone', enabled: true },
      ]),
    };
    const deviceStatus = { update: jest.fn().mockResolvedValue(undefined) };
    const service = new CommandDispatcherService(
      {} as any,
      {} as any,
      {} as any,
      { turnOn } as any,
      {} as any,
      deviceStatus as any,
      zoneRepo as any,
      indoorRepo as any,
      { warn: jest.fn() } as any,
    );

    const result = await service.dispatch({
      deviceType: 'hvac-zone',
      deviceId: 'site-zone',
      command: 'turnOn',
    });

    expect(zoneRepo.findOne).toHaveBeenCalledWith({
      where: { code: 'site-zone', enabled: true },
    });
    expect(indoorRepo.find).toHaveBeenCalledWith({
      where: { zoneCode: 'site-zone', enabled: true },
      order: { idx: 'ASC' },
    });
    expect(turnOn.mock.calls.map(([id]) => id)).toEqual(['41', '42']);
    expect(result).toMatchObject({
      ok: true,
      data: { zoneCode: 'site-zone', total: 2, okCount: 2 },
    });
  });
});

describe('CommandDispatcherService failure status mapping', () => {
  function setup(ledError: string) {
    const showWelcome = jest.fn(async () => ({
      ok: false,
      deviceId: 'led_1f_main',
      command: 'showWelcome',
      error: ledError,
      mock: false,
      durationMs: 3000,
    }));
    const deviceStatus = { update: jest.fn().mockResolvedValue(undefined) };
    const service = new CommandDispatcherService(
      {} as any,
      { showWelcome } as any,
      {} as any,
      {} as any,
      {} as any,
      deviceStatus as any,
      {} as any,
      {} as any,
      { warn: jest.fn() } as any,
    );
    return { service, deviceStatus };
  }

  it('TCP 连接超时(设备不可达)归类为 offline, 不计入需排查', async () => {
    const { service, deviceStatus } = setup(
      'tcp connect timed out after 3000ms to 192.168.50.30:5200',
    );
    await service.dispatch({ deviceType: 'led', deviceId: 'led_1f_main', command: 'showWelcome' });
    expect(deviceStatus.update).toHaveBeenCalledTimes(1);
    expect(deviceStatus.update.mock.calls[0][1]).toBe('offline');
  });

  it('连接被拒(ECONNREFUSED)归类为 offline', async () => {
    const { service, deviceStatus } = setup('connect ECONNREFUSED 192.168.50.30:5200');
    await service.dispatch({ deviceType: 'led', deviceId: 'led_1f_main', command: 'showWelcome' });
    expect(deviceStatus.update.mock.calls[0][1]).toBe('offline');
  });

  it('设备已连通但返回协议/业务错误归类为 error', async () => {
    const { service, deviceStatus } = setup('Nova 响应校验失败: payload CRC mismatch');
    await service.dispatch({ deviceType: 'led', deviceId: 'led_1f_main', command: 'showWelcome' });
    expect(deviceStatus.update.mock.calls[0][1]).toBe('error');
  });
});
