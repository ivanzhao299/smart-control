import { AdminGuard } from './admin-auth.guard';

describe('legacy admin guard with named administrator identities', () => {
  const verifyToken = jest.fn(async (token: string) => token === 'valid-admin');
  const guard = new AdminGuard({ verifyToken } as any);
  const context = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) } as any);
  beforeEach(() => verifyToken.mockClear());
  it('accepts a globally verified named administrator without a second credential', async () => {
    expect(await guard.canActivate(context({ headers: {}, actor: { kind: 'user', userId: 2, role: 'admin' } }))).toBe(true);
    expect(verifyToken).not.toHaveBeenCalled();
  });
  it.each(['operator', 'viewer'])('does not upgrade a verified %s through fallback', async role => {
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer valid-admin' }, actor: { role } }))).rejects.toThrow();
    expect(verifyToken).not.toHaveBeenCalled();
  });
  it('continues to verify standalone legacy admin bearer and rejects invalid credentials', async () => {
    expect(await guard.canActivate(context({ headers: { authorization: 'Bearer valid-admin' } }))).toBe(true);
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer invalid' } }))).rejects.toThrow();
    await expect(guard.canActivate(context({ headers: {} }))).rejects.toThrow();
  });
});
