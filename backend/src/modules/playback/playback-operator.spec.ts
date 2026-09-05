import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlaybackOperatorGuard } from './playback-operator.guard';
import { PlaybackController } from './playback.controller';

describe('playback control role boundary', () => {
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
