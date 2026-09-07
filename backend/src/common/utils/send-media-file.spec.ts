import { PassThrough, Readable, Writable } from 'stream';
import { once } from 'events';
import type { Response } from 'express';
import { sendMediaFile } from './send-media-file';

class Destination extends Writable {
  headers: Record<string, unknown> = {};
  code = 0;
  chunks: Buffer[] = [];
  setHeader(name: string, value: unknown) { this.headers[name] = value; }
  status(code: number) { this.code = code; return this; }
  _write(chunk: Buffer, _encoding: string, done: () => void) { this.chunks.push(Buffer.from(chunk)); done(); }
}
const file = (stream: Readable | null) => ({ stream, mimeType: 'text/plain', size: 3, filename: 'test.txt', status: 206, contentRange: 'bytes 0-2/10' });
describe('media response stream ownership', () => {
  it.each(['destroyed', 'ended'])('destroys the source when response was already %s before setup', async state => {
    const source = new PassThrough(), res = new Destination();
    if (state === 'destroyed') res.destroy(); else res.end();
    sendMediaFile(res as unknown as Response, file(source));
    expect(source.destroyed).toBe(true);
    expect(res.headers).toEqual({});
  });
  it('closes the source when header setup throws', () => {
    const source = new PassThrough(), res = new Destination();
    res.setHeader = () => { throw new Error('headers unavailable'); };
    expect(() => sendMediaFile(res as unknown as Response, file(source))).toThrow('headers unavailable');
    expect(source.destroyed).toBe(true);
    res.destroy();
  });
  it('preserves range and privacy headers while streaming the exact bytes', async () => {
    const res = new Destination(), finished = once(res, 'finish');
    sendMediaFile(res as unknown as Response, file(Readable.from([Buffer.from('abc')])));
    await finished;
    expect(Buffer.concat(res.chunks).toString()).toBe('abc');
    expect(res.code).toBe(206);
    expect(res.headers).toMatchObject({ 'Cache-Control': 'private, no-store', 'Content-Range': 'bytes 0-2/10', 'Content-Length': 3 });
  });
  it('closes an active source when the destination disconnects', async () => {
    const source = new PassThrough(), res = new Destination();
    sendMediaFile(res as unknown as Response, file(source));
    const closed = new Promise<void>(resolve => source.once('close', resolve));
    res.destroy();
    await closed;
    expect(source.destroyed).toBe(true);
  });
  it('terminates the response when reading fails without emitting a second response body', async () => {
    const source = new PassThrough(), res = new Destination();
    sendMediaFile(res as unknown as Response, file(source));
    const closed = new Promise<void>(resolve => res.once('close', resolve));
    source.destroy(new Error('synthetic read failure'));
    await closed;
    expect(res.destroyed).toBe(true);
    expect(res.chunks).toEqual([]);
  });
});
