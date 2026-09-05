import { of, lastValueFrom } from 'rxjs';
import { EtagInterceptor } from './etag.interceptor';

describe('authenticated response cache isolation', () => {
  const run = async (headers: Record<string, string>, noStore = false) => {
    const output: Record<string, string> = noStore ? { 'Cache-Control': 'no-store' } : {};
    const res = { setHeader: (k: string, v: string) => { output[k] = v; }, getHeader: (k: string) => output[k], status: jest.fn() };
    const req = { method: 'GET', headers, header: (key: string) => headers[key] };
    const context: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
    const data = { name: 'private content' };
    const body = await lastValueFrom(new EtagInterceptor().intercept(context, { handle: () => of(data) }));
    return { output, res, body };
  };
  it.each(['authorization', 'x-client-token'])('does not cache or conditionally reuse %s responses', async (key) => {
    const result = await run({ [key]: 'test-token', 'if-none-match': 'old-account-etag' });
    expect(result.output).toEqual({ 'Cache-Control': 'no-store' });
    expect(result.res.status).not.toHaveBeenCalled();
    expect(result.body).toEqual({ name: 'private content' });
  });
  it('preserves no-store on ticket-protected public streams', async () => {
    expect((await run({}, true)).output).toEqual({ 'Cache-Control': 'no-store' });
  });
  it('retains conditional caching for genuinely public responses', async () => {
    const first = await run({});
    const second = await run({ 'if-none-match': first.output.ETag });
    expect(second.res.status).toHaveBeenCalledWith(304);
  });
});
