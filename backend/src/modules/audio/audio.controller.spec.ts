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
