import { NotFoundException } from '@nestjs/common';
import { PlaybackService } from './playback.service';

describe('park dashboard input source', () => {
  const actor = { kind: 'user', userId: 7, role: 'operator', username: 'operator' } as const;

  function subject(media: { id: number } | null) {
    const mediaService = { findByOriginalName: jest.fn().mockResolvedValue(media) };
    const service = new PlaybackService(
      {} as never,
      {} as never,
      {} as never,
      mediaService as never,
      {} as never,
      {} as never,
    );
    const view = { slot: 1 } as never;
    jest.spyOn(service, 'publishMedia').mockResolvedValue(view);
    return { service, mediaService, view };
  }

  it('resolves the built-in asset by stable name and publishes it in a loop', async () => {
    const { service, mediaService, view } = subject({ id: 81 });

    await expect(service.publishParkDashboard(2, actor)).resolves.toEqual({
      assetName: PlaybackService.PARK_DASHBOARD_NAME,
      view,
    });
    expect(mediaService.findByOriginalName).toHaveBeenCalledWith(PlaybackService.PARK_DASHBOARD_NAME);
    expect(service.publishMedia).toHaveBeenCalledWith(2, 81, actor, { loopMode: 'loop' });
  });

  it('fails clearly when the built-in migration has not created the source', async () => {
    const { service } = subject(null);

    await expect(service.publishParkDashboard(1, actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(service.publishMedia).not.toHaveBeenCalled();
  });
});
