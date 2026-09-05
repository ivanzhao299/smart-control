import { MediaAccessService } from './media-access.service';

describe('short-lived media access', () => {
  let service: MediaAccessService;
  let media: any;
  let clients: any;
  let admins: any;
  const actor = { kind: 'user', role: 'operator', userId: 7, username: 'alice' };
  const request = () => ({ actor, headers: { 'x-client-token': 'private-login-token' } } as any);
  beforeEach(() => {
    media = { authorized: jest.fn().mockResolvedValue({ id: 42 }) };
    clients = { resolveActor: jest.fn().mockResolvedValue(actor) };
    admins = { verifyToken: jest.fn().mockResolvedValue(true) };
    service = new MediaAccessService(media, clients, admins);
  });
  const key = (url: string) => new URL(url, 'http://test').searchParams.get('ticket')!;
  it('issues only after permission check and does not put login secrets in URL', async () => {
    const issued = await service.issue(request(), 42, 'pdf');
    expect(media.authorized).toHaveBeenCalledWith(42, actor);
    expect(issued.url).not.toContain('private-login-token');
    expect(await service.redeem(key(issued.url), 42)).toBe('pdf');
    expect(clients.resolveActor).toHaveBeenCalledWith('private-login-token');
    expect(media.authorized).toHaveBeenCalledTimes(2);
  });
  it('refuses another media ID, made-up keys and expired tickets', async () => {
    const issued = await service.issue(request(), 42, 'file');
    await expect(service.redeem(key(issued.url), 43)).rejects.toThrow();
    await expect(service.redeem('invented', 42)).rejects.toThrow();
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(issued.expiresAt) + 1);
    try { await expect(service.redeem(key(issued.url), 42)).rejects.toThrow(); } finally { now.mockRestore(); }
  });
  it('revokes access when password/account or resource ownership changes', async () => {
    const issued = await service.issue(request(), 42, 'file');
    clients.resolveActor.mockResolvedValue(null);
    await expect(service.redeem(key(issued.url), 42)).rejects.toThrow('登录已失效');
    clients.resolveActor.mockResolvedValue(actor);
    const next = await service.issue(request(), 42, 'file');
    media.authorized.mockRejectedValue(new Error('资料不存在'));
    await expect(service.redeem(key(next.url), 42)).rejects.toThrow('资料不存在');
  });
  it('uses and rechecks the administrator session when both headers exist', async () => {
    const issued = await service.issue({ actor: { kind: 'admin', role: 'admin', userId: null, username: 'admin' },
      headers: { authorization: 'Bearer admin-secret', 'x-client-token': 'client-secret' } } as any, 42, 'file');
    expect(await service.redeem(key(issued.url), 42)).toBe('file');
    expect(admins.verifyToken).toHaveBeenCalledWith('admin-secret');
    admins.verifyToken.mockResolvedValue(false);
    await expect(service.redeem(key(issued.url), 42)).rejects.toThrow();
  });
});
