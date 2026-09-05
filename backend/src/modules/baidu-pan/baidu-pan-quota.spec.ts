import { createServer, Server } from 'http';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BaiduPanService } from './baidu-pan.service';

describe('cloud download capacity', () => {
  let service: BaiduPanService, quota: any, root: string, server: Server, url: string;
  beforeEach(async () => {
    quota = { reserve: jest.fn(async () => 'r'), release: jest.fn(async () => undefined) };
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
    await (service as any).streamToFile(url, destination, 0, 20);
    expect((await fs.stat(destination)).size).toBe(20);
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
