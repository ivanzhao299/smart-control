import { UnauthorizedException } from '@nestjs/common';
import { verifyPassword } from '../../common/utils/password.util';
import { ClientAuthService } from './client-auth.service';
import { hashPassword } from '../../common/utils/password.util';

describe('named identity login', () => {
  const secret = 'a'.repeat(64);
  const makeService = (user: Record<string, unknown> | null, auth: Record<string, unknown> | null = {
    id: 1,
    tokenSecret: secret,
    passwordChangedAt: new Date(0),
  }) => {
    const qb: any = { addSelect: () => qb, where: () => qb, getOne: async () => user };
    return new ClientAuthService(
      { findOne: async () => auth } as any,
      { createQueryBuilder: () => qb } as any,
      { info: jest.fn() } as any,
    );
  };

  it('issues a user-bound token and never accepts a password without a username', async () => {
    const password = 'safe-password-123';
    const service = makeService({ id: 7, username: 'alice', role: 'operator', enabled: true, password: hashPassword(password) });
    const result = await service.login('alice', password);
    expect((await service.resolveActor(result.token))?.username).toBe('alice');
    await expect(service.login('', password)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires a named administrator for the admin login endpoint', async () => {
    const password = 'safe-password-123';
    const service = makeService({ id: 7, username: 'alice', role: 'operator', enabled: true, password: hashPassword(password) });
    await expect(service.loginAdministrator('alice', password)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not initialize or mutate missing signing configuration', async () => {
    const password = 'safe-password-123';
    const service = makeService({ id: 1, username: 'admin', role: 'admin', enabled: true, password: hashPassword(password) }, null);
    await expect(service.login('admin', password)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses the standard password format for provisioned accounts', () => {
    expect(verifyPassword('safe-password-123', hashPassword('safe-password-123'))).toBe(true);
  });
});
