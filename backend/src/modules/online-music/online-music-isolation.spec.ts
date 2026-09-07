import { OnlineMusicService } from './online-music.service';
import { FREEPD_TRACKS } from './freepd-catalog';
import { Actor } from '../../common/auth/actor';

describe('online music user isolation', () => {
  const actor: Actor = { kind: 'user', userId: 7, username: 'alice', role: 'operator' };
  const track = FREEPD_TRACKS[0];
  let media: any, service: OnlineMusicService, quota: any;
  beforeEach(() => {
    media = { mediaRoot: '/fixture/media', list: jest.fn(async () => ({ items: [], total: 0 })), ingestReservedBuffer: jest.fn(async () => ({ id: 9, originalName: `${track.name}.mp3`, sizeBytes: 120000 })) };
    quota = { usage: jest.fn(async () => ({ quotaBytes: 500000, usedBytes: 0, reservedBytes: 0 })), reserve: jest.fn(async () => 'reservation'), release: jest.fn(async () => undefined) };
    service = new OnlineMusicService(media, { info: jest.fn() } as any, quota);
  });
  it('queries catalog download markers through the actor-scoped list', async () => {
    const result = await service.catalog(actor);
    expect(media.list).toHaveBeenCalledWith({ actor });
    expect(result.tracks[0].downloaded).toBe(false);
    media.list.mockResolvedValue({ items: [{ originalName: `${track.name}.mp3`, remark: null }] });
    expect((await service.catalog(actor)).tracks[0].downloaded).toBe(true);
  });
  it('rejects viewers before any download and passes the real owner to ingestion', async () => {
    const fetch = jest.spyOn(service as any, 'fetchBinary').mockResolvedValue(Buffer.alloc(120000));
    await expect(service.download(track.path, { ...actor, role: 'viewer' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await service.download(track.path, actor);
    expect(media.ingestReservedBuffer).toHaveBeenCalledWith(`${track.name}.mp3`, 'audio/mpeg', expect.any(Buffer), actor, 'reservation', expect.any(String));
    expect(fetch).toHaveBeenCalledWith(expect.any(String), 500000);
    expect(quota.reserve).toHaveBeenCalledWith(actor, 500000, '/fixture/media');
    expect(quota.release).not.toHaveBeenCalled(); // The ingestion owns cleanup/release after handoff.
  });
  it('never downloads when reservation fails and releases on a network failure', async () => {
    const fetch = jest.spyOn(service as any, 'fetchBinary').mockRejectedValue(new Error('network failed'));
    quota.reserve.mockRejectedValueOnce(new Error('quota full'));
    await expect(service.download(track.path, actor)).rejects.toThrow('quota full');
    expect(fetch).not.toHaveBeenCalled();
    await expect(service.download(track.path, actor)).rejects.toThrow('network failed');
    expect(quota.release).toHaveBeenLastCalledWith(actor, 'reservation');
    expect(media.ingestReservedBuffer).not.toHaveBeenCalled();
  });
  it('does not release an ingestion-owned reservation when ingestion needs recovery', async () => {
    jest.spyOn(service as any, 'fetchBinary').mockResolvedValue(Buffer.alloc(120000));
    media.ingestReservedBuffer.mockRejectedValue(new Error('cleanup requires recovery'));
    await expect(service.download(track.path, actor)).rejects.toThrow('requires recovery');
    expect(quota.release).not.toHaveBeenCalled();
    expect((service as any).downloading).toBeNull();
  });
});
