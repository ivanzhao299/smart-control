import { BackendSessionGuard } from './backend-session.guard';

describe('BackendSessionGuard (后台登录态门禁, 三个后台角色)', () => {
  const context = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) } as any);

  it.each(['admin', 'hardware', 'config'])('accepts a globally verified %s session', async (role) => {
    const verifyToken = jest.fn(async () => true);
    const moduleRef = { get: () => ({ resolveActor: async () => null }) } as any;
    const guard = new BackendSessionGuard({ verifyToken } as any, moduleRef);
    await expect(
      guard.canActivate(context({ headers: {}, actor: { kind: 'user', userId: 1, role } })),
    ).resolves.toBe(true);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it.each(['operator', 'viewer'])('rejects a verified %s that must not enter the backend', async (role) => {
    const verifyToken = jest.fn(async () => true);
    const moduleRef = { get: () => ({ resolveActor: async () => null }) } as any;
    const guard = new BackendSessionGuard({ verifyToken } as any, moduleRef);
    await expect(
      guard.canActivate(context({ headers: {}, actor: { kind: 'user', userId: 2, role } })),
    ).rejects.toThrow();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('lazily resolves a named hardware/config bearer on @Public controllers and attaches actor', async () => {
    const verifyToken = jest.fn(async () => false);
    const resolveActor = jest.fn(async (token: string) =>
      token === 'good' ? { kind: 'user', userId: 4, username: 'hw', role: 'hardware' } : null,
    );
    const moduleRef = { get: () => ({ resolveActor }) } as any;
    const guard = new BackendSessionGuard({ verifyToken } as any, moduleRef);
    const req: any = { headers: { authorization: 'Bearer good' } };
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.actor.role).toBe('hardware');
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('rejects a lazily resolved operator bearer', async () => {
    const verifyToken = jest.fn(async () => false);
    const moduleRef = {
      get: () => ({ resolveActor: async () => ({ kind: 'user', userId: 6, role: 'operator' }) }),
    } as any;
    const guard = new BackendSessionGuard({ verifyToken } as any, moduleRef);
    await expect(
      guard.canActivate(context({ headers: { authorization: 'Bearer op' } })),
    ).rejects.toThrow();
  });

  it('falls back to the legacy shared backend token and rejects missing/invalid credentials', async () => {
    const verifyToken = jest.fn(async (token: string) => token === 'legacy');
    const moduleRef = { get: () => ({ resolveActor: async () => null }) } as any;
    const guard = new BackendSessionGuard({ verifyToken } as any, moduleRef);
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer legacy' } }))).resolves.toBe(true);
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer bad' } }))).rejects.toThrow();
    await expect(guard.canActivate(context({ headers: {} }))).rejects.toThrow();
  });
});
