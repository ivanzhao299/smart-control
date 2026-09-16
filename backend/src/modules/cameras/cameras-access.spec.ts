import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RATE_LIMIT_KEY, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { CamerasController } from './cameras.controller';

describe('camera HLS access boundary', () => {
  const method = (name: keyof CamerasController) => (CamerasController.prototype as any)[name];

  it('keeps only the idempotent ensure operation public and rate limited', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, method('ensureHls'))).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, method('ensureHls'))).toContain(RateLimitGuard);
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, method('ensureHls'))).toEqual({
      max: 30,
      windowMs: 60_000,
    });
  });

  it.each(['startHls', 'stopHls', 'getAllHlsSessions'] as const)(
    'requires authentication for %s',
    (name) => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, method(name))).not.toBe(true);
    },
  );

  it('never returns the HLS output directory from the controller', async () => {
    const controller = new CamerasController({
      startHlsStream: jest.fn(async () => ({
        playlistUrl: '/playlist.m3u8',
        outputDir: 'D:\\sensitive\\path',
      })),
    } as any);

    await expect(controller.ensureHls('d37')).resolves.toEqual({
      message: 'HLS转码已就绪',
      data: { playlistUrl: '/playlist.m3u8' },
    });
    await expect(controller.startHls('d37')).resolves.toEqual({
      message: 'HLS转码已启动',
      data: { playlistUrl: '/playlist.m3u8' },
    });
  });
});
