import { GoneException } from '@nestjs/common';
import { AudioController } from './audio.controller';

describe('AudioController legacy matrix state compatibility', () => {
  const links = [
    { outCh: 0, inCh: 0, enabled: true },
    { outCh: 0, inCh: 1, enabled: false },
    { outCh: 7, inCh: 4, enabled: true },
  ];
  const linkRepo = { find: jest.fn().mockResolvedValue(links) };
  const controller = new AudioController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    linkRepo as never,
    {} as never,
  );

  it('projects the SQLite desired links for old read-only clients', async () => {
    await expect(controller.getMatrixState()).resolves.toEqual({
      message: 'ok',
      data: {
        '0_0': true,
        '0_1': false,
        '7_4': true,
      },
    });
  });

  it('rejects the retired file writer instead of recreating a second source', () => {
    try {
      controller.saveMatrixState();
      throw new Error('expected legacy writer to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(GoneException);
      expect((error as GoneException).getResponse()).toMatchObject({
        code: 'AUDIO_MATRIX_LEGACY_WRITE_RETIRED',
      });
    }
  });
});

describe('audio audition revision gate', () => {
  const content = { outputs: [{ ch: 0, inputs: [4], volume: 30 }] };
  const scene = { configRevision: 3 };
  const adapter = {
    applyScene: jest.fn().mockResolvedValue({ ok: true }),
    recallScene: jest.fn().mockResolvedValue({ ok: true }),
  };
  const config = {
    getSceneByPreset: jest.fn().mockResolvedValue(scene),
    parseSceneContent: jest.fn().mockReturnValue(content),
  };
  const controller = new AudioController(
    adapter as never,
    { record: jest.fn() } as never,
    config as never,
    {} as never,
    {} as never,
    {} as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    config.getSceneByPreset.mockResolvedValue(scene);
  });
  it('rejects changed or missing configuration before any device command', async () => {
    await expect(controller.applyScene(1, { expectedRevision: 2 })).rejects.toMatchObject({
      response: { code: 'AUDIO_CONFIG_REVISION_CONFLICT' },
    });
    config.getSceneByPreset.mockResolvedValueOnce(null as never);
    await expect(controller.applyScene(1, { expectedRevision: 3 })).rejects.toMatchObject({
      status: 409,
    });
    expect(adapter.applyScene).not.toHaveBeenCalled();
    expect(adapter.recallScene).not.toHaveBeenCalled();
  });
  it('uses the checked snapshot and keeps legacy device-control clients compatible', async () => {
    await controller.applyScene(1, { expectedRevision: 3 });
    expect(adapter.applyScene).toHaveBeenCalledWith(content);
    await controller.applyScene(1);
    expect(adapter.applyScene).toHaveBeenCalledTimes(2);
  });
});
