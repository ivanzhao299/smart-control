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
