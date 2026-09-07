import { createServer, Server } from 'http';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BaiduPanService } from './baidu-pan.service';

describe('cloud download capacity', () => {
  let service: BaiduPanService, quota: any, root: string, server: Server, url: string;
  beforeEach(async () => {
    quota = { reserve: jest.fn(async () => 'r'), bindTemporary: jest.fn(async () => undefined), release: jest.fn(async () => undefined) };
    service = new BaiduPanService({} as any, { listOriginalNames: async () => [] } as any, { info: jest.fn(), warn: jest.fn() } as any, quota);
    root = await fs.mkdtemp(join(tmpdir(), 'smart-control-cloud-test-'));
    server = createServer((_req, res) => res.end(Buffer.alloc(20)));
    server.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    url = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true }); });
  it('enforces the reserved byte ceiling before writing an oversized chunk', async () => {
    const destination = join(root, 'download');
    await expect((service as any).streamToFile(url, destination, 0, 10)).rejects.toThrow('预留容量');
    expect((await fs.stat(destination)).size).toBeLessThanOrEqual(10);
    await fs.unlink(destination);
    await (service as any).streamToFile(url, destination, 0, 20);
    expect((await fs.stat(destination)).size).toBe(20);
  });
  it('uses a bound media-root temporary file and the reserved ingest path', async () => {
    const actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
    const ingest = jest.fn(async (file: any) => {
      expect(file.path.startsWith(join(root, '_tmp') + '/')).toBe(true);
      expect(Buffer.from(file.originalname, 'latin1').toString('utf8')).toBe('中文音乐.mp3');
      expect(await fs.readFile(file.path)).toEqual(Buffer.alloc(2048));
      return { id: 42, sizeBytes: 2048 };
    });
    (service as any).media = { mediaRoot: root, ingest };
    jest.spyOn(service as any, 'streamToFile').mockImplementation(async (...args: any[]) => {
      expect(quota.bindTemporary).toHaveBeenCalledWith(actor, 'r', expect.stringMatching(/^[0-9a-f-]{36}\.upload$/));
      await fs.writeFile(args[1], Buffer.alloc(2048), { flag: 'wx' }); args[4]();
    });
    await (service as any).runDownload(url, '中文音乐.mp3', actor, 2048, 'r');
    expect(ingest).toHaveBeenCalledWith(expect.any(Object), 'alice', expect.any(String), actor, 'r', 'import');
    expect(await fs.readdir(join(root, '_tmp'))).toEqual([]);
    expect(quota.release).toHaveBeenCalledWith(actor, 'r');
  });
  it('never truncates an existing destination when a download name collides', async () => {
    const destination = join(root, 'existing');
    await fs.writeFile(destination, 'preserved');
    await expect((service as any).streamToFile(url, destination, 0, 100)).rejects.toThrow();
    expect(await fs.readFile(destination, 'utf8')).toBe('preserved');
  });
  it('does not start a network stream when durable binding is rejected', async () => {
    (service as any).media = { mediaRoot: root };
    quota.bindTemporary.mockRejectedValue(new Error('binding rejected'));
    const stream = jest.spyOn(service as any, 'streamToFile');
    await expect((service as any).runDownload(url, 'a.mp3', { role: 'operator', userId: 1 }, 2048, 'r')).rejects.toThrow('binding rejected');
    expect(stream).not.toHaveBeenCalled();
    expect(await fs.readdir(join(root, '_tmp'))).toEqual([]);
  });
  it('rejects a download before starting the background worker when quota is full', async () => {
    jest.spyOn(service as any, 'token').mockResolvedValue('test-token');
    jest.spyOn(service as any, 'getJson').mockResolvedValue({ list: [{ dlink: url, size: 2000 }] });
    jest.spyOn(service as any, 'row').mockResolvedValue({ rootPath: null });
    const worker = jest.spyOn(service as any, 'runDownload').mockResolvedValue({ id: 1, sizeBytes: 2000 });
    quota.reserve.mockRejectedValue(new Error('quota full'));
    await expect(service.startDownload(1, 'test.mp3', { kind: 'user', userId: 1, username: 'admin', role: 'admin' })).rejects.toThrow('quota full');
    expect(worker).not.toHaveBeenCalled();
    expect((service as any).activeDownload).toBeNull();
  });
});
