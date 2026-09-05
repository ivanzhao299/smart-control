import { createHash, createHmac } from 'crypto';
import { ClientAuthService } from './client-auth.service';
import { GlobalAuthGuard } from '../../common/guards/global-auth.guard';
import { requireAdmin } from '../../common/auth/actor';

describe('verified multi-user identity', () => {
  const secret = 'test-only-signing-secret';
  let user: any;
  let service: ClientAuthService;
  const sign = (extra: object = {}) => {
    const payload = Buffer.from(JSON.stringify({ iat: Date.now(), exp: Date.now() + 60000, ...extra })).toString('base64url');
    return `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`;
  };
  beforeEach(() => {
    user = { id: 7, username: 'alice', role: 'operator', enabled: true, password: 'stored-hash' };
    const qb: any = { addSelect: () => qb, where: () => qb, getOne: async () => user };
    service = new ClientAuthService(
      { findOne: async () => ({ tokenSecret: secret, passwordChangedAt: new Date(0) }) } as any,
      { createQueryBuilder: () => qb } as any, {} as any,
    );
  });
  const identity = () => ({ uid: 7, ph: createHash('sha256').update('stored-hash').digest('hex').slice(0, 24) });

  it('reads role from current database, not token claims', async () => {
    const token = sign({ ...identity(), role: 'admin' });
    expect(await service.resolveActor(token)).toEqual({ kind: 'user', userId: 7, username: 'alice', role: 'operator' });
    user.role = 'viewer';
    expect((await service.resolveActor(token))?.role).toBe('viewer');
  });
  it('rejects disabled, removed and password-changed accounts', async () => {
    const token = sign(identity());
    user.enabled = false;
    expect(await service.resolveActor(token)).toBeNull();
    user.enabled = true; user.password = 'changed';
    expect(await service.resolveActor(token)).toBeNull();
    user = null;
    expect(await service.resolveActor(token)).toBeNull();
  });
  it('rejects forged, expired and malformed user identities', async () => {
    expect(await service.resolveActor(sign(identity()) + '0')).toBeNull();
    expect(await service.resolveActor(sign({ exp: 1 }))).toBeNull();
    expect(await service.resolveActor(sign({ uid: '7' }))).toBeNull();
  });
  it('keeps old shared tokens read-only and without user ownership', async () => {
    const actor = await service.resolveActor(sign());
    expect(actor).toMatchObject({ kind: 'legacy', userId: null, role: 'viewer' });
    expect(() => requireAdmin({ actor } as any)).toThrow();
  });
  it('does not turn unauthenticated loopback requests into administrators', () => {
    expect(() => requireAdmin({ socket: { remoteAddress: '127.0.0.1' } } as any)).toThrow();
  });
  it('rejects invalid credentials even on loopback', async () => {
    const guard = new GlobalAuthGuard(
      { getAllAndOverride: () => false } as any, service,
      { verifyToken: async () => false } as any,
    );
    const req: any = { headers: { 'x-client-token': 'invalid' }, socket: { remoteAddress: '127.0.0.1' } };
    const context: any = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) };
    await expect(guard.canActivate(context)).rejects.toThrow();
    expect(req.actor).toBeUndefined();
  });
});
