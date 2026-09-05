import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { User } from '../../entities/user.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { MediaService } from './media.service';
import { Actor } from '../../common/auth/actor';

describe('file ingestion compensation', () => {
  let db: DataSource, root: string, media: MediaService;
  const actor: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [User, MediaAsset], synchronize: true }).initialize();
    await db.getRepository(User).save({ id: 1, username: 'alice', password: 'test', role: 'operator' });
    root = await fs.mkdtemp(join(tmpdir(), 'smart-control-ingest-test-'));
    media = new MediaService(db.getRepository(MediaAsset), new ConfigService(), {} as any);
    Object.defineProperty(media, 'mediaRoot', { value: root });
  });
  afterEach(async () => { jest.restoreAllMocks(); await db.destroy(); await fs.rm(root, { recursive: true, force: true }); });
  it('stores the final path and private owner on successful buffer ingestion', async () => {
    const item = await media.ingestFromBuffer('sample.mp3', 'audio/mpeg', Buffer.from('sample'), 'alice', actor);
    expect(item.ownerUserId).toBe(1);
    expect(item.visibility).toBe('private');
    expect(await fs.readFile(item.path, 'utf8')).toBe('sample');
  });
  it('removes newly written files and database rows when final save fails', async () => {
    const repo = db.getRepository(MediaAsset);
    const save = repo.save.bind(repo);
    jest.spyOn(repo, 'save').mockImplementation(async (entity: any) => {
      if (entity.path) throw new Error('injected final-save failure');
      return save(entity);
    });
    await expect(media.ingestFromBuffer('sample.mp3', 'audio/mpeg', Buffer.from('sample'), 'alice', actor)).rejects.toThrow('injected');
    expect(await repo.count()).toBe(0);
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('never removes an existing ID directory when allocation collides', async () => {
    await fs.mkdir(join(root, '1'));
    await fs.writeFile(join(root, '1', 'preserve.txt'), 'existing');
    await expect(media.ingestFromBuffer('sample.mp3', 'audio/mpeg', Buffer.from('sample'), 'alice', actor)).rejects.toThrow();
    expect(await fs.readFile(join(root, '1', 'preserve.txt'), 'utf8')).toBe('existing');
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
  });
  it('retains accounting records if failed-ingest directory cleanup fails', async () => {
    const repo = db.getRepository(MediaAsset);
    const save = repo.save.bind(repo);
    jest.spyOn(repo, 'save').mockImplementation(async (entity: any) => { if (entity.path) throw new Error('save failed'); return save(entity); });
    jest.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('cleanup denied'));
    await expect(media.ingestFromBuffer('sample.mp3', 'audio/mpeg', Buffer.from('sample'), 'alice', actor)).rejects.toThrow('cleanup denied');
    expect(await repo.count()).toBe(1);
    expect((await repo.find())[0].sizeBytes).toBe(6);
    expect(await fs.readFile(join(root, '1', 'sample.mp3'), 'utf8')).toBe('sample');
  });
});
