import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createCorsOptions, createCorsOriginValidator, parseCorsAllowedOrigins } from './cors';

@Module({})
class CorsFixtureModule {}

describe('CORS origin policy', () => {
  it('normalizes configured origins and drops malformed or wildcard values', () => {
    expect(
      parseCorsAllowedOrigins('http://localhost:5173/, https://erp.cnjinhu.top/path, *, invalid'),
    ).toEqual(['http://localhost:5173', 'https://erp.cnjinhu.top']);
  });

  it('allows configured browser origins and origin-less local probes only', async () => {
    const validate = createCorsOriginValidator([
      'http://localhost:5173',
      'https://erp.cnjinhu.top',
    ]);
    const result = (origin?: string) =>
      new Promise<boolean | undefined>((resolve, reject) => {
        validate(origin, (error, allow) => (error ? reject(error) : resolve(allow)));
      });

    await expect(result()).resolves.toBe(true);
    await expect(result('http://localhost:5173')).resolves.toBe(true);
    await expect(result('https://erp.cnjinhu.top')).resolves.toBe(true);
    await expect(result('https://evil.example')).resolves.toBe(false);
  });

  it('allows authenticated media upload preflight without broadening origins or browser-owned headers', async () => {
    const app = await NestFactory.create(CorsFixtureModule, { logger: false });
    app.enableCors(createCorsOptions(['https://erp.cnjinhu.top']));
    await app.listen(0, '127.0.0.1');
    try {
      const url = `${await app.getUrl()}/api/media/upload`;
      const preflight = (origin: string) => fetch(url, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,x-client-token,x-upload-size',
        },
      });
      const allowed = await preflight('https://erp.cnjinhu.top');
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://erp.cnjinhu.top');
      const headers = allowed.headers.get('access-control-allow-headers')!.toLowerCase().split(',');
      expect(headers).toEqual(expect.arrayContaining(['authorization', 'x-client-token', 'x-upload-size']));
      expect(headers).not.toContain('user-agent');
      expect(headers).not.toContain('*');
      expect(allowed.headers.get('access-control-allow-credentials')).toBeNull();
      const denied = await preflight('https://untrusted.example');
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await app.close();
    }
  });
});
