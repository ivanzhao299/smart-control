import { OnlineMusicService } from './online-music.service';
import { FREEPD_TRACKS } from './freepd-catalog';
import { Actor } from '../../common/auth/actor';

describe('online music user isolation', () => {
  const actor: Actor = { kind: 'user', userId: 7, username: 'alice', role: 'operator' };
  const track = FREEPD_TRACKS[0];
  let media: any, service: OnlineMusicService;
  beforeEach(() => {
    media = { list: jest.fn(async () => ({ items: [], total: 0 })), ingestFromBuffer: jest.fn(async () => ({ id: 9, originalName: `${track.name}.mp3`, sizeBytes: 120000 })) };
    service = new OnlineMusicService(media, { info: jest.fn() } as any);
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
    expect(media.ingestFromBuffer).toHaveBeenCalledWith(`${track.name}.mp3`, 'audio/mpeg', expect.any(Buffer), 'alice', actor, expect.any(String));
  });
});
