import { GlobalAuthGuard } from './global-auth.guard';

describe('global authentication boundary', () => {
  const actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  const guard = (isPublic = false) => new GlobalAuthGuard(
    { getAllAndOverride: () => isPublic } as any,
    { resolveActor: async (token: string) => token === 'user-token' ? actor : null } as any,
    { verifyToken: async (token: string) => token === 'admin-token' } as any,
  );
  const context = (req: any) => ({
    getHandler: () => null, getClass: () => null,
    switchToHttp: () => ({ getRequest: () => req }),
  } as any);

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1', '192.168.77.1'])
  ('rejects anonymous requests from %s, including spoofed forwarded identity', async (address) => {
    const req: any = { headers: { 'x-forwarded-for': '127.0.0.1' }, socket: { remoteAddress: address }, actor };
    await expect(guard().canActivate(context(req))).rejects.toThrow();
    expect(req.actor).toBeUndefined();
  });

  it('does not honor the retired authentication-disable environment switch', async () => {
    const previous = process.env.CLIENT_AUTH_DISABLED;
    process.env.CLIENT_AUTH_DISABLED = 'true';
    try {
      await expect(guard().canActivate(context({ headers: {} }))).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.CLIENT_AUTH_DISABLED;
      else process.env.CLIENT_AUTH_DISABLED = previous;
    }
  });

  it.each(['x-client-token', 'authorization'])('accepts a verified user via %s', async (header) => {
    const req: any = { headers: { [header]: header === 'authorization' ? 'Bearer user-token' : 'user-token' } };
    expect(await guard().canActivate(context(req))).toBe(true);
    expect(req.actor).toEqual(actor);
  });

  it('accepts verified administrator credentials', async () => {
    const req: any = { headers: { authorization: 'Bearer admin-token' } };
    expect(await guard().canActivate(context(req))).toBe(true);
    expect(req.actor).toMatchObject({ kind: 'admin', role: 'admin' });
  });

  it('preserves administrator device control when a legacy viewer token also exists', async () => {
    const boundary = new GlobalAuthGuard(
      { getAllAndOverride: () => false } as any,
      { resolveActor: async () => ({ kind: 'legacy', userId: null, username: 'legacy', role: 'viewer' }) } as any,
      { verifyToken: async (token: string) => token === 'admin-token' } as any,
    );
    const req: any = { method: 'POST', headers: { authorization: 'Bearer admin-token', 'x-client-token': 'old-client-token' } };
    expect(await boundary.canActivate(context(req))).toBe(true);
    expect(req.actor).toMatchObject({ role: 'admin', kind: 'admin' });
  });

  it('prefers a named-admin bearer over a concurrently saved operator PWA token', async () => {
    const boundary = new GlobalAuthGuard(
      { getAllAndOverride: () => false } as any,
      { resolveActor: async (token: string) => token === 'named-admin'
        ? { kind: 'user', userId: 1, username: 'owner', role: 'admin' }
        : { kind: 'user', userId: 2, username: 'operator', role: 'operator' } } as any,
      { verifyToken: async () => false } as any,
    );
    const req: any = {
      method: 'POST',
      headers: { authorization: 'Bearer named-admin', 'x-client-token': 'operator-token' },
    };
    expect(await boundary.canActivate(context(req))).toBe(true);
    expect(req.actor).toMatchObject({ username: 'owner', role: 'admin', kind: 'user' });
  });

  it('keeps explicitly public entry points available without creating an identity', async () => {
    const req: any = { headers: {} };
    expect(await guard(true).canActivate(context(req))).toBe(true);
    expect(req.actor).toBeUndefined();
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('denies %s for current viewer and legacy roles globally', async method => {
    for (const kind of ['user', 'legacy']) {
      const viewerGuard = new GlobalAuthGuard(
        { getAllAndOverride: () => false } as any,
        { resolveActor: async () => ({ ...actor, kind, role: 'viewer' }) } as any,
        { verifyToken: async () => false } as any,
      );
      const req: any = { method, headers: { 'x-client-token': 'viewer' } };
      await expect(viewerGuard.canActivate(context(req))).rejects.toThrow('只读账户');
      expect(req.actor).toBeUndefined();
    }
  });
  it('allows a viewer to request explicitly read-only preview grants', async () => {
    const viewerGuard = new GlobalAuthGuard(
      { getAllAndOverride: (key: string) => key === 'read-only-request' } as any,
      { resolveActor: async () => ({ ...actor, role: 'viewer' }) } as any,
      { verifyToken: async () => false } as any,
    );
    const req: any = { method: 'POST', headers: { 'x-client-token': 'viewer' } };
    expect(await viewerGuard.canActivate(context(req))).toBe(true);
    expect(req.actor.role).toBe('viewer');
  });
});
