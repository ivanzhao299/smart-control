import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TestFlightService } from './testflight.service';
import { AppleApiException, type AppleTesterState } from './apple-app-store.client';

/**
 * 方案 B：常驻服务器使用最小权限 App Manager 钥。该钥能创建/查询团队邀请，
 * 但无权撤销（DELETE）一条已发出的团队邀请（苹果返回 403）。本组测试锁定重发分支语义：
 *  - 已接受：拒绝；
 *  - 仍 pending 且 DELETE 403：不报错、不标失败，返回 state=pending + 引导 notice，不再尝试创建；
 *  - 旧邀请已不存在（DELETE 404 或查无 pending）：直接重新创建邀请；
 *  - 401（密钥无效/被撤销）与 403（权限不足）给出不同文案，不再笼统报「密钥无效或权限不足」。
 */

const cfg = {
  enabled: true,
  configured: true,
  issuerId: 'issuer',
  keyId: 'DJ3328P729',
  privateKeyPem: 'pem',
  appId: '6795375392',
  bundleId: 'com.jinhu.smartcontrol',
  internalGroupName: '内部测试',
  testerRole: 'MARKETING',
  github: { configured: false, token: '', repository: 'ivanzhao299/smart-control', workflow: 'ios-build.yml', ref: 'main' },
};

const EMAIL = '662119@163.com';
const invitation: AppleTesterState = {
  kind: 'invitation',
  id: 'inv-1',
  email: EMAIL,
  roles: ['MARKETING'],
  expirationDate: null,
};
const teamUser: AppleTesterState = {
  kind: 'user',
  id: 'user-1',
  email: EMAIL,
  roles: ['MARKETING'],
  expirationDate: null,
};

function harness(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: 4,
    email: EMAIL,
    firstName: '万玺',
    lastName: '许',
    role: 'MARKETING',
    appId: cfg.appId,
    status: 'PENDING',
    appleInvitationId: 'inv-1',
    expirationDate: null,
    lastError: null,
    invitedBy: 'admin',
    invitedAt: new Date(),
  };
  const repo = {
    findOne: jest.fn(async () => row),
    save: jest.fn(async (r: unknown) => (Array.isArray(r) ? r[0] : r)),
    create: jest.fn((x: unknown) => x),
  };
  const apple = {
    findUser: jest.fn(async () => null),
    findInvitation: jest.fn(async () => null),
    deleteInvitation: jest.fn(async () => undefined),
    createInvitation: jest.fn(async () => ({ id: 'new-inv', expirationDate: null })),
    ...overrides,
  };
  const config = { getOrThrow: jest.fn(() => cfg) };
  const service = new TestFlightService(repo as never, apple as never, {} as never, config as never);
  return { service, repo, apple, row };
}

describe('TestFlightService.resend（方案 B：App Manager 最小权限）', () => {
  it('已接受团队邀请 → 拒绝重发，且不调用创建/撤销', async () => {
    const h = harness({ findUser: jest.fn(async () => teamUser) });
    await expect(h.service.resend(4, 'admin')).rejects.toBeInstanceOf(BadRequestException);
    expect(h.apple.deleteInvitation).not.toHaveBeenCalled();
    expect(h.apple.createInvitation).not.toHaveBeenCalled();
  });

  it('pending 邀请且 DELETE 返回 403 → 返回 pending+notice，不报错、不重建、记录恢复为 PENDING', async () => {
    const h = harness({
      findInvitation: jest.fn(async () => invitation),
      deleteInvitation: jest.fn(async () => {
        throw new AppleApiException(403, [{ code: 'FORBIDDEN_ERROR', detail: 'no permission to revoke' }]);
      }),
    });
    // 历史上该行被错误地标成 FAILED，本次应被纠正回 PENDING
    h.row.status = 'FAILED';
    h.row.lastError = '旧的误导性错误';

    const result = await h.service.resend(4, 'admin');
    expect(result.state).toBe('pending');
    expect(result.notice).toContain('无权撤销');
    expect(h.apple.createInvitation).not.toHaveBeenCalled();
    expect(h.row.status).toBe('PENDING');
    expect(h.row.lastError).toBeNull();
  });

  it('pending 邀请但 DELETE 返回 404（旧邀请已不存在）→ 重新创建成功', async () => {
    const h = harness({
      findInvitation: jest.fn(async () => invitation),
      deleteInvitation: jest.fn(async () => {
        throw new AppleApiException(404, [{ code: 'NOT_FOUND', detail: 'gone' }]);
      }),
    });
    const result = await h.service.resend(4, 'admin');
    expect(result.state).toBe('invited');
    expect(h.apple.deleteInvitation).toHaveBeenCalledWith('inv-1');
    expect(h.apple.createInvitation).toHaveBeenCalledTimes(1);
    expect(h.row.appleInvitationId).toBe('new-inv');
  });

  it('查无 pending 邀请（已过期/被撤销）→ 直接创建新邀请，无需先 DELETE', async () => {
    const h = harness();
    const result = await h.service.resend(4, 'admin');
    expect(result.state).toBe('invited');
    expect(h.apple.deleteInvitation).not.toHaveBeenCalled();
    expect(h.apple.createInvitation).toHaveBeenCalledTimes(1);
  });

  it('创建时苹果返回 401 → 报「密钥无效/被撤销」，并把记录标记为 FAILED', async () => {
    const h = harness({
      createInvitation: jest.fn(async () => {
        throw new AppleApiException(401, [{ code: 'UNAUTHORIZED', detail: 'bad jwt' }]);
      }),
    });
    await expect(h.service.resend(4, 'admin')).rejects.toMatchObject({
      name: 'UnauthorizedException',
      message: expect.stringContaining('密钥无效'),
    });
    expect(h.row.status).toBe('FAILED');
  });

  it('创建时苹果返回 403 → 报「权限不足」并点明操作，不再使用旧的笼统文案', async () => {
    const h = harness({
      createInvitation: jest.fn(async () => {
        throw new AppleApiException(403, [{ code: 'FORBIDDEN_ERROR', detail: 'forbidden' }]);
      }),
    });
    await expect(h.service.resend(4, 'admin')).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await h.service.resend(4, 'admin');
      fail('应抛出 ForbiddenException');
    } catch (err) {
      expect((err as Error).message).toContain('权限不足');
      expect((err as Error).message).toContain('重发邀请');
      expect((err as Error).message).not.toContain('密钥无效或权限不足：请确认');
    }
  });

  it('创建时返回 409 且邀请其实仍存在 → 归一为 pending + notice，而不是失败', async () => {
    const h = harness({
      findInvitation: jest.fn(async () => invitation),
      createInvitation: jest.fn(async () => {
        throw new AppleApiException(409, [{ code: 'DUPLICATE_RESOURCE', detail: 'invitation already exists' }]);
      }),
    });
    const result = await h.service.resend(4, 'admin');
    expect(result.state).toBe('pending');
    expect(result.notice).toContain('无权撤销');
    expect(h.row.status).toBe('PENDING');
  });

  it('401 映射为 UnauthorizedException（与 403 类型不同）', async () => {
    const h = harness({
      createInvitation: jest.fn(async () => {
        throw new AppleApiException(401, [{ code: 'UNAUTHORIZED' }]);
      }),
    });
    await expect(h.service.resend(4, 'admin')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
