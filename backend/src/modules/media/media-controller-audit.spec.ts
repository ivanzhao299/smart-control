import 'reflect-metadata';
import { MediaController } from './media.controller';
import { Actor } from '../../common/auth/actor';

describe('webpage creation audit identity', () => {
  const actor: Actor = { kind: 'user', userId: 17, username: 'showroom-alice', role: 'operator' };
  const dto = { name: 'Presentation', url: 'https://example.test/showroom' };
  let media: any, logs: any, controller: MediaController;
  beforeEach(() => {
    media = {
      createWebpage: jest.fn(async () => ({ id: 42, originalName: dto.name, sourceUrl: dto.url })),
      toListItem: jest.fn(asset => ({ id: asset.id })),
    };
    logs = { record: jest.fn(async () => undefined) };
    controller = new MediaController(media, logs, {} as any, {} as any, {} as any);
  });
  it('passes the verified actor to both creation and audit, ignoring submitted identity', async () => {
    await controller.createWebpage({ ...dto, username: 'forged-admin' } as any, { actor } as any);
    expect(media.createWebpage).toHaveBeenCalledWith(dto.name, dto.url, actor);
    expect(logs.record).toHaveBeenCalledWith(expect.objectContaining({
      operator: actor.username, action: 'media.webpage.create', targetId: '42', result: 'success',
    }));
  });
  it('rejects missing identity before creating or logging a resource', async () => {
    await expect(controller.createWebpage(dto, {} as any)).rejects.toThrow();
    expect(media.createWebpage).not.toHaveBeenCalled();
    expect(logs.record).not.toHaveBeenCalled();
  });
  it('does not write a success audit when policy or persistence rejects creation', async () => {
    media.createWebpage.mockRejectedValue(new Error('permission denied'));
    await expect(controller.createWebpage(dto, { actor } as any)).rejects.toThrow('permission denied');
    expect(logs.record).not.toHaveBeenCalled();
  });
});
