import { Server, createServer } from 'http';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { lastValueFrom, of } from 'rxjs';
import { QuotaUploadInterceptor } from './quota-upload.interceptor';

describe('multipart quota enforcement', () => {
  let server: Server, root: string, url: string, quota: any;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'smart-control-upload-test-'));
    quota = { reserve: jest.fn(async () => 'reservation'), release: jest.fn(async () => undefined) };
    const interceptor = new QuotaUploadInterceptor(quota, { mediaRoot: root, classifyKind: () => 'audio' } as any);
    server = createServer(async (req, res) => {
      (req as any).actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
      try {
        const result = await lastValueFrom(interceptor.intercept({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as any, { handle: () => of({ size: (req as any).file.size }) }));
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
      } catch (error: any) { res.writeHead(error.getStatus?.() ?? 403); res.end(JSON.stringify({ error: true })); }
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    url = `http://127.0.0.1:${(server.address() as any).port}/upload`;
  });
  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function upload(actual: number, declared?: number) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(actual)], { type: 'audio/mpeg' }), 'sample.mp3');
    return fetch(url, { method: 'POST', headers: declared === undefined ? {} : { 'X-Upload-Size': String(declared) }, body: form });
  }
  it('accepts exact bytes and releases capacity after processing and temp cleanup', async () => {
    const response = await upload(10, 10);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ size: 10 });
    expect(quota.release).toHaveBeenCalledWith(expect.objectContaining({ userId: 1 }), 'reservation');
    expect(await fs.readdir(join(root, '_tmp'))).toEqual([]);
  });
  it('rejects oversized and undersized bodies and cleans their partial files', async () => {
    expect((await upload(11, 10)).status).toBe(400);
    expect((await upload(9, 10)).status).toBe(400);
    expect(quota.release).toHaveBeenCalledTimes(2);
    expect(await fs.readdir(join(root, '_tmp'))).toEqual([]);
  });
  it('rejects missing size or exhausted quota before creating upload storage', async () => {
    expect((await upload(10)).status).toBe(400);
    expect(quota.reserve).not.toHaveBeenCalled();
    quota.reserve.mockRejectedValue(new Error('full'));
    expect((await upload(10, 10)).status).toBe(403);
    expect(await fs.readdir(root)).toEqual([]);
  });
});
