import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlaybackOperatorGuard } from './playback-operator.guard';
import { PlaybackController } from './playback.controller';

describe('playback control role boundary', () => {
  it('requires document control session and forwards it unchanged', async () => {
    const service = { setDocPage: jest.fn(), setDocZoom: jest.fn() };
    const controller = new PlaybackController(service as any, {} as any);
    for (const expectedSession of [undefined, '', 5, 'x'.repeat(65)]) {
      await expect(controller.docPage(1, { page: 2, expectedSession } as any)).rejects.toThrow();
      await expect(controller.docZoom(1, { zoom: 150, expectedSession } as any)).rejects.toThrow();
    }
    expect(service.setDocPage).not.toHaveBeenCalled();
    expect(service.setDocZoom).not.toHaveBeenCalled();
    await controller.docPage(1, { page: 2, expectedSession: 'current-session' });
    await controller.docZoom(1, { zoom: 150, expectedSession: 'current-session' });
    expect(service.setDocPage).toHaveBeenCalledWith(1, 2, 'current-session');
    expect(service.setDocZoom).toHaveBeenCalledWith(1, 150, 'current-session');
  });
  const guard = new PlaybackOperatorGuard();
  const ctx = (method: string, actor?: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ method, actor }) }) }) as any;
  const operator = { kind: 'user', userId: 1, username: 'operator', role: 'operator' };
  it('covers the whole user controller, including future control endpoints', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PlaybackController)).toContain(PlaybackOperatorGuard);
  });
  it('permits viewer reads but rejects every mutating HTTP method', () => {
    for (const actor of [{ ...operator, role: 'viewer' }, { kind: 'legacy', userId: null, username: 'legacy', role: 'viewer' }]) {
      expect(guard.canActivate(ctx('GET', actor))).toBe(true);
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(() => guard.canActivate(ctx(method, actor))).toThrow();
    }
  });
  it('allows operators/admins and rejects unauthenticated loopback callers', () => {
    expect(guard.canActivate(ctx('POST', operator))).toBe(true);
    expect(guard.canActivate(ctx('POST', { kind: 'admin', userId: null, username: 'admin', role: 'admin' }))).toBe(true);
    expect(() => guard.canActivate(ctx('POST'))).toThrow();
    expect(() => guard.canActivate(ctx('GET'))).toThrow();
  });
});
