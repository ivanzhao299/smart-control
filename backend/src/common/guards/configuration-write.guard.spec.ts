import 'reflect-metadata';
import { ConfigurationWriteGuard } from './configuration-write.guard';

/**
 * ConfigurationWriteGuard 仍保留（旧的"读放行登录、写仅 admin"守卫）。
 * 后台分域已迁移到 ModuleAccessGuard（见 module-access.spec.ts），此处仅验证
 * 该守卫自身的读写判定行为不变。
 */
describe('configuration write guard self behavior', () => {
  const guard = new ConfigurationWriteGuard();
  const ctx = (role: string | null, method: string) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        actor: role ? { kind: 'user', userId: 1, username: 'test', role } : undefined,
      }),
    }),
  } as any);

  it.each(['viewer', 'operator', 'admin'])('permits %s to read shared configuration', (role) => {
    expect(guard.canActivate(ctx(role, 'GET'))).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('limits %s configuration to administrators', (method) => {
    for (const role of ['viewer', 'operator', null]) {
      expect(() => guard.canActivate(ctx(role, method))).toThrow();
    }
    expect(guard.canActivate(ctx('admin', method))).toBe(true);
  });

  it('requires an identity even for reads', () => {
    expect(() => guard.canActivate(ctx(null, 'GET'))).toThrow();
  });
});
