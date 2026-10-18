import { BackendSessionGuard } from './backend-session.guard';

describe('BackendSessionGuard (后台登录态门禁)', () => {
  const context = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) } as any);

  // 动态 RBAC 后后台登录方向由 PermissionService.canLoginBack 决定；
  // 测试用 mock 复刻内置 4 个后台角色（viewer 不可进后台）。
  const BACKEND = ['admin', 'hardware', 'config', 'operator'];
  const canLoginBack = (role: string) => BACKEND.includes(role);
  const moduleRefWith = (resolveActor: any) =>
    ({ get: () => ({ resolveActor, canLoginBack }) } as any);

  // admin/hardware/config 是完整后台角色；operator 是后台自助角色(改密码/下载APK)，均可登录后台。
  it.each(['admin', 'hardware', 'config', 'operator'])('accepts a globally verified %s session', async (role) => {
    const verifyToken = jest.fn(async () => true);
    const moduleRef = moduleRefWith(async () => null);
    const guard = new BackendSessionGuard({ verifyToken } as any, moduleRef);
    await expect(
      guard.canActivate(context({ headers: {}, actor: { kind: 'user', userId: 1, role } })),
    ).resolves.toBe(true);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('rejects a verified viewer that must not enter the backend', async () => {
    const verifyToken = jest.fn(async () => true);
    const moduleRef = moduleRefWith(async () => null);
    const guard = new BackendSessionGuard({ verifyToken } as any, moduleRef);
    await expect(
      guard.canActivate(context({ headers: {}, actor: { kind: 'user', userId: 2, role: 'viewer' } })),
    ).rejects.toThrow();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('lazily resolves a named hardware/config bearer on @Public controllers and attaches actor', async () => {
    const verifyToken = jest.fn(async () => false);
    const resolveActor = jest.fn(async (token: string) =>
      token === 'good' ? { kind: 'user', userId: 4, username: 'hw', role: 'hardware' } : null,
    );
    const moduleRef = moduleRefWith(resolveActor);
    const guard = new BackendSessionGuard({ verifyToken } as any, moduleRef);
    const req: any = { headers: { authorization: 'Bearer good' } };
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.actor.role).toBe('hardware');
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('accepts a lazily resolved operator bearer (self-service role)', async () => {
    const verifyToken = jest.fn(async () => false);
    const moduleRef = moduleRefWith(async () => ({ kind: 'user', userId: 6, role: 'operator' }));
    const guard = new BackendSessionGuard({ verifyToken } as any, moduleRef);
    const req: any = { headers: { authorization: 'Bearer op' } };
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.actor.role).toBe('operator');
  });

  it('falls back to the legacy shared backend token and rejects missing/invalid credentials', async () => {
    const verifyToken = jest.fn(async (token: string) => token === 'legacy');
    const moduleRef = moduleRefWith(async () => null);
    const guard = new BackendSessionGuard({ verifyToken } as any, moduleRef);
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer legacy' } }))).resolves.toBe(true);
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer bad' } }))).rejects.toThrow();
    await expect(guard.canActivate(context({ headers: {} }))).rejects.toThrow();
  });
});
