import { createCorsOriginValidator, parseCorsAllowedOrigins } from './cors';

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
});
