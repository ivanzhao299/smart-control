import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { OperationsGuard } from './operations.guard';

describe('scoped operations credentials', () => {
  const token = 'test-only-operations-credential-32bytes';
  let entry: any, scope: string, req: any, guard: OperationsGuard;
  const context = () => ({ getHandler: () => null, switchToHttp: () => ({ getRequest: () => req }) } as any);
  beforeEach(() => {
    entry = { id: 'watcher', enabled: true, sha256: createHash('sha256').update(token).digest('hex'), scopes: ['heartbeat'], host: 'test-host' };
    scope = 'heartbeat'; req = { headers: { 'x-operations-token': token }, body: { host: 'test-host' } };
    guard = new OperationsGuard({ get: () => JSON.stringify([entry]) } as unknown as ConfigService, { get: () => scope } as any);
  });
  it('accepts only the assigned operation and never creates an admin actor', () => {
    expect(guard.canActivate(context())).toBe(true);
    expect(req.operationsIdentity).toBe('watcher'); expect(req.actor).toBeUndefined();
    scope = 'restart'; expect(() => guard.canActivate(context())).toThrow('权限不足');
  });
  it('binds heartbeat identity to the configured host', () => {
    req.body.host = 'different-host'; expect(() => guard.canActivate(context())).toThrow('主机不匹配');
  });
  it('rejects missing credentials, old body token, malformed hash and disabled credentials', () => {
    delete req.headers['x-operations-token']; req.body.token = 'old-static-token';
    expect(() => guard.canActivate(context())).toThrow();
    req.headers['x-operations-token'] = token; entry.enabled = false;
    expect(() => guard.canActivate(context())).toThrow();
    entry.enabled = true; entry.sha256 = 'invalid'; expect(() => guard.canActivate(context())).toThrow();
  });
  it('allows restart only when explicitly scoped and rejects rotation immediately', () => {
    entry.scopes = ['restart']; scope = 'restart';
    expect(guard.canActivate(context())).toBe(true);
    entry.sha256 = '0'.repeat(64); expect(() => guard.canActivate(context())).toThrow();
  });
});
