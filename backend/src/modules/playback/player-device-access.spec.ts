import { PlayerDeviceAccessService } from './player-device-access.service';
import { join } from 'path';

describe('device playback access grants', () => {
  let service: PlayerDeviceAccessService, row: any, user: any, devices: any, media: any, playback: any;
  beforeEach(() => {
    row = { slot: 3, currentMediaId: 7, initiatorUserId: 2, playbackSession: 'session-1', startedAt: new Date('2026-09-05T00:00:00Z') };
    user = { id: 2, username: 'owner', enabled: true, role: 'operator' };
    devices = { authenticate: jest.fn(() => ({ id: 'bgm', slots: [3] })) };
    media = { authorized: jest.fn(async () => ({})), openStream: jest.fn(async () => ({ status: 206 })) };
    playback = { getBySlot: jest.fn(async () => ({ currentMediaId: row.currentMediaId, currentMediaKind: 'audio', currentMediaUrl: '/api/media/7/file' })) };
    service = new PlayerDeviceAccessService({ findOneByOrFail: async () => ({ ...row }) } as any, { findOneBy: async () => user } as any, devices, playback, media);
  });
  const ticketOf = (state: any) => new URL(state.currentMediaUrl, 'http://localhost').searchParams.get('ticket')!;
  it('issues opaque reusable short-lived URLs and authorizes before opening range streams', async () => {
    const state = await service.state(3, 'device-secret');
    const ticket = ticketOf(state);
    expect(state.currentMediaUrl).not.toContain('device-secret');
    expect(ticketOf(await service.state(3, 'device-secret'))).toBe(ticket);
    await service.stream(3, ticket, 'bytes=5-9');
    expect(media.authorized).toHaveBeenCalledWith(7, expect.objectContaining({ userId: 2, role: 'operator' }));
    expect(media.openStream).toHaveBeenCalledWith(7, false, 'bytes=5-9');
    await expect(service.stream(1, ticket)).rejects.toThrow();
    await expect(service.stream(3, 'forged')).rejects.toThrow();
  });
  it('rejects old playback sessions even if the same media is replayed', async () => {
    const ticket = ticketOf(await service.state(3, 'device-secret'));
    row.playbackSession = 'session-2';
    await expect(service.stream(3, ticket)).rejects.toThrow('播放会话已变化');
    expect(media.openStream).not.toHaveBeenCalled();
  });
  it('rechecks device revocation, account status and media permission', async () => {
    const ticket = ticketOf(await service.state(3, 'device-secret'));
    devices.authenticate.mockImplementationOnce(() => { throw new Error('revoked'); });
    await expect(service.stream(3, ticket)).rejects.toThrow('revoked');
    user.enabled = false;
    await expect(service.stream(3, ticket)).rejects.toThrow('播放发起账户已停用');
    user.enabled = true;
    media.authorized.mockRejectedValue(new Error('ownership changed'));
    await expect(service.stream(3, ticket)).rejects.toThrow('ownership changed');
    expect(media.openStream).not.toHaveBeenCalled();
  });
  it('expires grants and rejects permission redaction during state lookup', async () => {
    const ticket = ticketOf(await service.state(3, 'device-secret'));
    const realNow = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow + 301_000);
    try { await expect(service.stream(3, ticket)).rejects.toThrow('播放凭证已失效'); }
    finally { clock.mockRestore(); }
    playback.getBySlot.mockResolvedValue({ currentMediaId: null, currentMediaUrl: null });
    await expect(service.state(3, 'device-secret')).rejects.toThrow('播放状态变化或资料权限已撤销');
  });
  it('restores the server-side initiator for advance and rejects stale or paused events', async () => {
    playback.advance = jest.fn(async () => undefined);
    await service.advance(3, 'device-secret', 'session-1');
    expect(playback.advance).toHaveBeenCalledWith(3, expect.objectContaining({ userId: 2, role: 'operator' }), 'session-1');
    await expect(service.advance(3, 'device-secret', 'old')).rejects.toThrow();
    row.paused = true;
    await expect(service.advance(3, 'device-secret', 'session-1')).rejects.toThrow();
    expect(playback.advance).toHaveBeenCalledTimes(1);
  });
  it('renews the same URL on authorized polling without restarting long media', async () => {
    const now = Date.now();
    const state = await service.state(3, 'device-secret');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 250_000);
    try {
      expect((await service.state(3, 'device-secret')).currentMediaUrl).toBe(state.currentMediaUrl);
      clock.mockReturnValue(now + 400_000);
      await expect(service.stream(3, ticketOf(state))).resolves.toEqual({ status: 206 });
      clock.mockReturnValue(now + 551_000);
      await expect(service.stream(3, ticketOf(state))).rejects.toThrow();
    } finally { clock.mockRestore(); }
  });
  it('limits document metadata to current readable content and validates input before writing', async () => {
    media.mediaRoot = __dirname;
    media.absPathOf = jest.fn(() => join(__dirname, 'player-device-access.spec.ts'));
    media.authorized.mockResolvedValue({ id: 7, kind: 'doc', pageCount: 4, docPdfPath: null });
    media.setDocMeta = jest.fn(async () => ({ id: 7, pageCount: 5 }));
    expect((await service.docInfo(3, 'device-secret', 'session-1')).id).toBe(7);
    await expect(service.docInfo(3, 'device-secret', 'old')).rejects.toThrow();
    await expect(service.docMeta(3, 'device-secret', 'session-1', -1)).rejects.toThrow();
    await expect(service.docMeta(3, 'device-secret', 'session-1', 1.5)).rejects.toThrow();
    await expect(service.docMeta(3, 'device-secret', 'session-1', 5, true)).rejects.toThrow('仅Word');
    expect(media.setDocMeta).not.toHaveBeenCalled();
    await service.docMeta(3, 'device-secret', 'session-1', 5);
    expect(media.setDocMeta).toHaveBeenCalledWith(7, { pageCount: 5, pdfRelPath: undefined });
    media.absPathOf.mockReturnValue(join(__dirname, '../../entities/user.entity.ts'));
    await expect(service.docInfo(3, 'device-secret', 'session-1')).rejects.toThrow('文档路径无效');
  });
});
