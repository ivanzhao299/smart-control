import { readFileSync } from 'fs';
import { join } from 'path';
import { MediaAsset } from '../../entities/media-asset.entity';
import { queryMediaList, toMediaListItem } from './media-list-query';

function asset(values: Partial<MediaAsset> = {}): MediaAsset {
  return {
    ownerUserId: 7,
    visibility: 'private',
    source: 'upload',
    id: 42,
    originalName: 'demo.mp4',
    kind: 'video',
    mimeType: 'video/mp4',
    sizeBytes: 123,
    durationSec: 10,
    resolution: '1920x1080',
    remark: null,
    uploader: 'alice',
    thumbPath: '42/thumb.jpg',
    sourceUrl: null,
    lastPlayedAt: new Date('2026-09-22T08:00:00.000Z'),
    createdAt: new Date('2026-09-22T07:00:00.000Z'),
    processingStatus: 'ready',
    processingError: null,
    ...values,
  } as MediaAsset;
}

describe('media list query boundary', () => {
  it('projects stored files and webpages to the stable API shape', () => {
    expect(toMediaListItem(asset())).toMatchObject({
      id: 42,
      fileUrl: '/api/media/42/file',
      thumbUrl: '/api/media/42/thumb',
      sizeBytes: 123,
      lastPlayedAt: '2026-09-22T08:00:00.000Z',
      createdAt: '2026-09-22T07:00:00.000Z',
    });
    expect(
      toMediaListItem(
        asset({
          id: 43,
          kind: 'webpage',
          source: 'webpage',
          sourceUrl: 'https://example.test/show',
          thumbPath: null,
          processingStatus: undefined as never,
        }),
      ),
    ).toMatchObject({
      fileUrl: 'https://example.test/show',
      thumbUrl: null,
      processingStatus: 'ready',
    });
  });

  it('rejects invalid filters before constructing a database query', async () => {
    const repo = { createQueryBuilder: jest.fn() } as never;
    await expect(queryMediaList(repo, { keyword: 'x'.repeat(201) })).rejects.toThrow(
      '搜索文本过长',
    );
    await expect(queryMediaList(repo, { limit: Number.NaN })).rejects.toThrow('无效分页参数');
    await expect(queryMediaList(repo, { ownerUserId: 7 })).rejects.toThrow('仅管理员可按用户筛选');
    expect((repo as { createQueryBuilder: jest.Mock }).createQueryBuilder).not.toHaveBeenCalled();
  });

  it('keeps query and response projection out of the orchestration service', () => {
    const service = readFileSync(join(__dirname, 'media.service.ts'), 'utf8');
    expect(service).toContain("from './media-list-query'");
    expect(service).toContain('queryMediaList(manager.getRepository(MediaAsset)');
    expect(service).toContain('return toMediaListItem(media)');
    expect(service).not.toContain("createQueryBuilder('m')");
    expect(service).not.toContain('instr(lower(m.originalName)');
  });
});
