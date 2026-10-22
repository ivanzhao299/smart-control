import { SceneLightingService } from './scene-lighting.service';

describe('SceneLightingService', () => {
  it('broadcasts the target brightness to every enabled DALI group using hardware slave ids', async () => {
    const groupRepo = {
      find: jest.fn().mockResolvedValue([
        { gatewayCode: 'GW-DALI-1', daliGroup: 5, enabled: true },
        { gatewayCode: 'GW-DALI-2', daliGroup: 1, enabled: true },
      ]),
    };
    const hardwareRepo = {
      find: jest.fn().mockResolvedValue([
        { code: 'GW-DALI-1', addressing: JSON.stringify({ slaveId: 1 }) },
        { code: 'GW-DALI-2', addressing: JSON.stringify({ slaveId: 2 }) },
      ]),
    };
    const setBrightnessOnGateway = jest.fn(async (slaveId: number, group: number, value: number, fadeSec: number) => ({
      ok: true,
      deviceId: `gw${slaveId}-g${group}`,
      command: 'setBrightnessOnGateway',
      data: { slaveId, group, value, fadeSec },
      mock: true,
      durationMs: 1,
    }));
    const service = new SceneLightingService(
      groupRepo as any,
      hardwareRepo as any,
      { setBrightnessOnGateway } as any,
    );

    const result = await service.setAllBrightness(140, 3);

    expect(groupRepo.find).toHaveBeenCalledWith({
      where: { enabled: true },
      order: { gatewayCode: 'ASC', daliGroup: 'ASC' },
    });
    expect(setBrightnessOnGateway.mock.calls.map(([slave, group, value, fade]) => [slave, group, value, fade]))
      .toEqual(expect.arrayContaining([[1, 5, 100, 3], [2, 1, 100, 3]]));
    expect(result).toMatchObject({ ok: true, data: { total: 2, succeeded: 2, failed: 0 } });
  });

  it('reports a missing hardware slave id as a partial failure without throwing', async () => {
    const service = new SceneLightingService(
      { find: jest.fn().mockResolvedValue([{ gatewayCode: 'GW-DALI-X', daliGroup: 1, enabled: true }]) } as any,
      { find: jest.fn().mockResolvedValue([{ code: 'GW-DALI-X', addressing: null }]) } as any,
      { setBrightnessOnGateway: jest.fn() } as any,
    );

    const result = await service.setAllBrightness(70, 2);

    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ total: 1, succeeded: 0, failed: 1 });
    expect(result.data?.groups[0].error).toContain('slaveId');
  });
});
