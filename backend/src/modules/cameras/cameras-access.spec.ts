import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RATE_LIMIT_KEY, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { MODULE_ACCESS_KEY } from '../../common/decorators/module-access.decorator';
import { CamerasController } from './cameras.controller';
import { ParkOpsMetricsController } from './park-ops-metrics.controller';

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

  it('keeps park operations reads public, writes admin-only, and preserves the API shape', async () => {
    const get = (ParkOpsMetricsController.prototype as any).get;
    const update = (ParkOpsMetricsController.prototype as any).update;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, get)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, update)).toContain(ModuleAccessGuard);
    expect(Reflect.getMetadata(MODULE_ACCESS_KEY, update)).toBe('metrics');

    const document = {
      version: 1,
      source: '园区月报',
      updatedAt: '2026-09-16T00:00:00+08:00',
      placeholderKeys: [],
      metrics: {},
      content: {},
    };
    const service = { get: jest.fn(() => document), update: jest.fn(async () => document) };
    const controller = new ParkOpsMetricsController(service as any);

    expect(controller.get()).toEqual({ success: true, data: document });
    await expect(controller.update(document)).resolves.toEqual({
      success: true,
      message: '运营数据已保存并发布到运营大屏',
      data: document,
    });
  });
});
