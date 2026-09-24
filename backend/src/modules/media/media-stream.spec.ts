import { resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { MediaService } from './media.service';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
  it('keeps reading the verified file descriptor when the pathname is replaced after opening', async () => {
    const temp = await fs.mkdtemp(join(tmpdir(), 'sc-stream-descriptor-'));
    try {
      Object.defineProperty(media, 'mediaRoot', { value: temp });
      row.path = join(temp, 'source.txt');
      await fs.writeFile(row.path, 'verified');
      const file = await media.openStream(42);
      await fs.rename(row.path, join(temp, 'original.txt'));
      await fs.writeFile(row.path, 'replacement');
      expect(await read(file)).toBe('verified');
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  });
  it('bounds full responses to the opened size and returns no stream for empty files', async () => {
    const temp = await fs.mkdtemp(join(tmpdir(), 'sc-stream-descriptor-'));
    try {
      Object.defineProperty(media, 'mediaRoot', { value: temp });
      row.path = join(temp, 'source.txt');
      await fs.writeFile(row.path, 'verified');
      const file = await media.openStream(42);
      await fs.appendFile(row.path, '-later');
      expect(file.size).toBe(8);
      expect(await read(file)).toBe('verified');
      row.path = join(temp, 'empty.txt');
      await fs.writeFile(row.path, '');
      expect(await media.openStream(42)).toMatchObject({ status: 200, size: 0, stream: null });
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  });
  it('rejects replacement between validation and open, closing the rejected handle', async () => {
    const temp = await fs.mkdtemp(join(tmpdir(), 'sc-stream-descriptor-'));
    const open = fs.open.bind(fs);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      Object.defineProperty(media, 'mediaRoot', { value: temp });
      row.path = join(temp, 'source.txt');
      await fs.writeFile(row.path, 'verified');
      jest.spyOn(fs, 'open').mockImplementationOnce(async (path, flags, mode) => {
        await fs.rename(row.path, join(temp, 'original.txt'));
        await fs.writeFile(row.path, 'replacement');
        handle = await open(path, flags, mode);
        return handle;
      });
      await expect(media.openStream(42)).rejects.toThrow('文件不存在');
      expect(handle).toBeDefined();
      await expect(handle!.stat()).rejects.toThrow();
    } finally { jest.restoreAllMocks(); await handle?.close(); await fs.rm(temp, { recursive: true, force: true }); }
  });
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

  it('backfills missing image geometry from the managed file', async () => {
    const temp = await fs.mkdtemp(join(tmpdir(), 'sc-image-geometry-'));
    try {
      Object.defineProperty(media, 'mediaRoot', { value: temp });
      row = {
        id: 42,
        kind: 'image',
        path: join(temp, 'welcome.png'),
        originalName: 'welcome.png',
        mimeType: 'image/png',
        resolution: null,
      };
      await fs.writeFile(row.path, 'fixture');
      jest.spyOn(media as any, 'probeVideo').mockResolvedValue({ width: 3612, height: 1462 });
      const update = jest.spyOn(media as any, 'updateMediaFields').mockResolvedValue(undefined);

      await expect(media.ensureImageResolution(42)).resolves.toMatchObject({ resolution: '3612x1462' });
      expect(update).toHaveBeenCalledWith(42, { resolution: '3612x1462' });

      row.resolution = null;
      update.mockClear();
      await expect(media.ensureImageResolution(42, false)).resolves.toMatchObject({ resolution: '3612x1462' });
      expect(update).not.toHaveBeenCalled();
    } finally { jest.restoreAllMocks(); await fs.rm(temp, { recursive: true, force: true }); }
  });
});
