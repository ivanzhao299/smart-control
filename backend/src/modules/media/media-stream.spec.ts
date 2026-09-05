import { resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { MediaService } from './media.service';

describe('actual media byte streams', () => {
  const root = resolve(__dirname, 'fixtures');
  let media: MediaService;
  let row: any;
  beforeEach(() => {
    row = { id: 42, path: resolve(root, 'range.txt'), originalName: 'range.txt', mimeType: 'text/plain', docPdfPath: 'range.txt', sizeBytes: 99999 };
    const old = process.env.MEDIA_ROOT;
    process.env.MEDIA_ROOT = root;
    media = new MediaService({ findOne: async () => row } as any, new ConfigService(), {} as any);
    if (old === undefined) delete process.env.MEDIA_ROOT; else process.env.MEDIA_ROOT = old;
  });
  const read = async (file: Awaited<ReturnType<MediaService['openStream']>>) => {
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream!) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString();
  };
  it('returns exactly the requested bytes using disk size, not stale database size', async () => {
    const file = await media.openStream(42, false, 'bytes=2-5');
    expect(file.status).toBe(206);
    expect(file.size).toBe(4);
    expect(file.contentRange).toBe('bytes 2-5/11');
    expect(await read(file)).toBe('2345');
  });
  it('supports PDF variant range and suffix requests', async () => {
    const file = await media.openStream(42, true, 'bytes=-3');
    expect(file.mimeType).toBe('application/pdf');
    expect(await read(file)).toBe('89\n');
  });
  it('does not open a stream for unsatisfiable ranges', async () => {
    const file = await media.openStream(42, false, 'bytes=100-');
    expect(file).toMatchObject({ status: 416, stream: null, size: 0, contentRange: 'bytes */11' });
  });
  it('rejects source and document paths outside the media directory', async () => {
    row.path = resolve(__dirname, 'media-stream.spec.ts');
    await expect(media.openStream(42)).rejects.toThrow('文件不存在');
    row.docPdfPath = '../media-stream.spec.ts';
    await expect(media.openStream(42, true)).rejects.toThrow('文件不存在');
  });
});
