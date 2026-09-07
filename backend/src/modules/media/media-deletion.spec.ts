import { ConfigService } from '@nestjs/config';
import { MediaService } from './media.service';
import { Actor } from '../../common/auth/actor';
import { User } from '../../entities/user.entity';

describe('media deletion lifecycle guards', () => {
  const actor: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  let service: MediaService, repo: any, asset: any;
  beforeEach(() => {
    asset = { id: 1, ownerUserId: 1, visibility: 'private', processingStatus: 'ready' };
    repo = { findOne: jest.fn(async () => asset), query: jest.fn(async () => []), remove: jest.fn() };
    const manager = { findOneBy: jest.fn(async entity => entity === User ? { id: 1, enabled: true, role: 'operator' } : asset) };
    repo.manager = { connection: { transaction: async (work: (manager: unknown) => Promise<unknown>) => work(manager) } };
    service = new MediaService(repo, new ConfigService(), {} as any);
  });
  it('rejects cross-user deletion inside the service', async () => {
    asset.ownerUserId = 2;
    await expect(service.remove(1, actor)).rejects.toThrow();
    expect(repo.query).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });
  it.each(['pending', 'processing'])('rejects %s transcodes before touching files', async status => {
    asset.processingStatus = status;
    await expect(service.remove(1, actor)).rejects.toThrow('转码');
    expect(repo.remove).not.toHaveBeenCalled();
  });
  it('requires stopping active or paused channels first', async () => {
    repo.query.mockResolvedValue([{ id: 3 }]);
    await expect(service.remove(1, actor)).rejects.toThrow('先停止');
    expect(repo.remove).not.toHaveBeenCalled();
  });
  it('excludes concurrent publish/transcode/delete work and releases once', async () => {
    const release = service.acquireOperation(1);
    await expect(service.remove(1, actor)).rejects.toThrow('正在使用');
    release();
    const second = service.acquireOperation(1);
    release();
    expect(() => service.acquireOperation(1)).toThrow();
    second();
    service.acquireOperation(1)();
  });
});
