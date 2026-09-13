import { MediaAccessService } from './media-access.service';
import { PassThrough } from 'stream';

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
  it.each(['session', 'ownership', 'admin'])('closes direct downloads revoked during opening: %s', async reason => {
    const stream = new PassThrough();
    const req = reason === 'admin'
      ? { actor: { kind: 'admin' }, headers: { authorization: 'Bearer admin-secret', 'x-client-token': 'client-secret' } } as any
      : request();
    media.openStream = jest.fn(async () => {
      if (reason === 'session') clients.resolveActor.mockResolvedValue(null);
      if (reason === 'ownership') media.authorized.mockRejectedValue(new Error('ownership changed'));
      if (reason === 'admin') admins.verifyToken.mockResolvedValue(false);
      return { stream };
    });
    try {
      await expect(service.openDirect(req, 42, true, 'bytes=0-2')).rejects.toThrow();
      expect(stream.destroyed).toBe(true);
      expect(media.openStream).toHaveBeenCalledWith(42, true, 'bytes=0-2');
      if (reason === 'admin') {
        expect(admins.verifyToken).toHaveBeenCalledWith('admin-secret');
        expect(clients.resolveActor).not.toHaveBeenCalled();
      }
    } finally { stream.destroy(); }
  });
  it('rejects invalid direct credentials before opening and preserves valid streams', async () => {
    const stream = new PassThrough();
    media.openStream = jest.fn().mockResolvedValue({ stream });
    clients.resolveActor.mockResolvedValue(null);
    await expect(service.openDirect(request(), 42, false)).rejects.toThrow('登录已失效');
    expect(media.openStream).not.toHaveBeenCalled();
    clients.resolveActor.mockResolvedValue(actor);
    expect((await service.openDirect(request(), 42, false)).stream).toBe(stream);
    expect(stream.destroyed).toBe(false);
    stream.destroy();
  });
  it.each(['session', 'ownership', 'expiry'])('closes the opened stream when %s changes during file opening', async reason => {
    const issued = await service.issue(request(), 42, 'file');
    const stream = new PassThrough();
    let clock: jest.SpyInstance | undefined;
    media.openStream = jest.fn(async () => {
      if (reason === 'session') clients.resolveActor.mockResolvedValue(null);
      if (reason === 'ownership') media.authorized.mockRejectedValue(new Error('资料不存在'));
      if (reason === 'expiry') clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(issued.expiresAt) + 1);
      return { stream };
    });
    try {
      await expect(service.open(key(issued.url), 42, 'bytes=0-2')).rejects.toThrow();
      expect(media.openStream).toHaveBeenCalledWith(42, false, 'bytes=0-2');
      expect(stream.destroyed).toBe(true);
    } finally { clock?.mockRestore(); stream.destroy(); }
  });
  it('does not open bytes for a rejected initial ticket and leaves valid streams available', async () => {
    const stream = new PassThrough();
    media.openStream = jest.fn().mockResolvedValue({ stream });
    await expect(service.open('invented', 42)).rejects.toThrow();
    expect(media.openStream).not.toHaveBeenCalled();
    const issued = await service.issue(request(), 42, 'pdf');
    const file = await service.open(key(issued.url), 42);
    expect(file.stream).toBe(stream);
    expect(stream.destroyed).toBe(false);
    expect(media.openStream).toHaveBeenCalledWith(42, true, undefined);
    stream.destroy();
  });
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
