import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { ClientAuth } from '../../entities/client-auth.entity';
import { User, BACKEND_ROLES, USER_ROLES } from '../../entities/user.entity';
import type { UserRole } from '../../entities/user.entity';
import { hashPassword, verifyPassword } from '../../common/utils/password.util';
import type { Actor } from '../../common/auth/actor';

/** 客户端 token TTL: 30 天, 比 admin 长很多 (业主天天用, 不想老登) */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 后台会话只覆盖一个工作日。 */
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * 客户端鉴权 (2026-07-27 签名令牌制重构)。
 *
 * 老方案: login 发随机 token, 存**内存 Map** —— 后端每次重启/部署 Map 清空,
 * 全体 token 没到期也失效, 业主的 iPhone/平板 PWA 被打回登录页 ("经常退出")。
 * 部署越勤退得越勤, 这是结构性缺陷不是网络问题。
 *
 * 当前方案: users 是唯一的新登录凭据源。HMAC-SHA256 签名令牌
 * `base64url(payload).hex(sig)` 绑定 uid 与当前密码指纹；签名密钥持久化在
 * client_auth_v1.tokenSecret:
 *   - 后端重启/部署 → 密钥还在 → 老令牌照样验过, 业主无感 (根治)
 *   - 用户改密码/停用/删除 → 该用户令牌立即失效
 *   - 单令牌注销 → 进程内黑名单 (业主"退出登录"本来就少用, 重启后黑名单清空可接受,
 *     因为对应客户端本地也已删 token)
 * 无 uid 的历史共享令牌仅在原有效期内按 viewer 兼容，不再签发。
 */
@Injectable()
export class ClientAuthService {
  /** 注销黑名单 (签名令牌无状态, 注销靠这里兜) */
  private readonly revoked = new Set<string>();

  constructor(
    @InjectRepository(ClientAuth) private readonly repo: Repository<ClientAuth>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async login(username: string, password: string): Promise<{ token: string; expiresAt: string }> {
    return this.loginNamedUser(username, password, TOKEN_TTL_MS);
  }

  async loginAdministrator(username: string, password: string): Promise<{ token: string; expiresAt: string }> {
    // admin / hardware / config 可登录后台；operator 也可登录但仅自助改密码 + 只读下载 APK；
    // viewer 不在后台角色、仅前台。
    return this.loginNamedUser(username, password, ADMIN_TOKEN_TTL_MS, BACKEND_ROLES);
  }

  private async loginNamedUser(
    username: string,
    password: string,
    ttlMs: number,
    allowedRoles?: readonly UserRole[],
  ): Promise<{ token: string; expiresAt: string }> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row?.tokenSecret) throw new UnauthorizedException('鉴权未初始化，请先运行数据库迁移');
    const normalizedUsername = username.trim();
    if (!normalizedUsername) throw new UnauthorizedException('请输入用户名和密码');
    const user = await this.userRepo.createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.username = :username', { username: normalizedUsername })
      .getOne();
    if (!user?.enabled || !verifyPassword(password, user.password)) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const now = Date.now();
    const identity = { uid: user.id, ph: this.passwordFingerprint(user.password) };
    const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + ttlMs, ...identity })).toString('base64url');
    const sig = createHmac('sha256', row.tokenSecret).update(payload).digest('hex');
    this.logger.info(`[ClientAuth] named login ok user=${user.username} role=${user.role}`);
    return { token: `${payload}.${sig}`, expiresAt: new Date(now + ttlMs).toISOString() };
  }

  async verifyToken(token: string): Promise<boolean> {
    return (await this.resolveActor(token)) !== null;
  }

  async resolveActor(token: string): Promise<Actor | null> {
    if (!token || this.revoked.has(token)) return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const payloadB64 = token.slice(0, dot);
    const sigHex = token.slice(dot + 1);
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row?.tokenSecret) return null;
    const expect = createHmac('sha256', row.tokenSecret).update(payloadB64).digest('hex');
    if (!/^[a-f0-9]{64}$/.test(sigHex)) return null;
    try {
      if (!timingSafeEqual(Buffer.from(sigHex, 'hex'), Buffer.from(expect, 'hex'))) return null;
    } catch {
      return null;
    }
    let payload: { iat?: number; exp?: number; uid?: number; ph?: string };
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { iat?: number; exp?: number };
    } catch {
      return null;
    }
    if (!payload || typeof payload !== 'object' || typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
    // 改密时间之后签发的才算数 (语义与老方案一致: 改密 = 全体重登)
    if (typeof payload.iat !== 'number' || payload.iat < row.passwordChangedAt.getTime()) return null;
    // 用户账户令牌额外绑定账户状态和当前密码。后台禁用账户或修改密码后，该账户的旧令牌立即失效。
    if (typeof payload.uid === 'number') {
      const user = await this.userRepo.createQueryBuilder('user')
        .addSelect('user.password')
        .where('user.id = :id', { id: payload.uid })
        .getOne();
      if (!user?.enabled || typeof payload.ph !== 'string') return null;
      if (payload.ph !== this.passwordFingerprint(user.password)) return null;
      if (!USER_ROLES.includes(user.role)) return null;
      return { kind: 'user', userId: user.id, username: user.username, role: user.role };
    }
    if (payload.uid !== undefined) return null;
    return { kind: 'legacy', userId: null, username: 'legacy', role: 'viewer' };
  }

  /** 健康检查 — 业主在登录页"测试连接"调这个, 不需要密码 */
  ping(): { ok: true; service: 'client-auth'; serverTime: string } {
    return { ok: true as const, service: 'client-auth' as const, serverTime: new Date().toISOString() };
  }

  /**
   * 自助改密码 — 只改本人, 任何已登录账户(含 viewer/operator)都可调用。
   * 必须先验证原密码; 改完后该账户旧令牌因密码指纹(ph)变化立即失效, 需重新登录。
   * 单用户改密不触碰全局 passwordChangedAt (那是"全体强制重登"的闸门, 避免误伤他人)。
   */
  async changePassword(userId: number, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.id = :id', { id: userId })
      .getOne();
    if (!user?.enabled) throw new UnauthorizedException('账户不存在或已停用');
    if (!verifyPassword(oldPassword, user.password)) {
      throw new BadRequestException('原密码不正确');
    }
    if (oldPassword === newPassword) {
      throw new BadRequestException('新密码不能与原密码相同');
    }
    user.password = hashPassword(newPassword);
    await this.userRepo.save(user);
    this.logger.info(`[ClientAuth] self change-password ok user=${user.username}`);
  }

  logout(token: string): void {
    if (token) this.revoked.add(token);
    // 防黑名单无限涨 (每次注销顺手清一遍过期的没必要 — 上限兜底即可)
    if (this.revoked.size > 1000) this.revoked.clear();
  }

  private passwordFingerprint(passwordHash: string): string {
    return createHash('sha256').update(passwordHash).digest('hex').slice(0, 24);
  }
}
