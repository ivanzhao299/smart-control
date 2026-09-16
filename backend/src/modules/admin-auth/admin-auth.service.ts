import { Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { AdminAuth } from '../../entities/admin-auth.entity';
import { hashPassword, verifyPassword } from '../../common/utils/password.util';

const DEFAULT_PASSWORD = 'jinhu888';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 小时, 跟一个工作日相当

/**
 * 后台鉴权 — 2026-07-30 起令牌改 HMAC 签名制 (照 client-auth #22 方案原样搬):
 *
 * 老方案的 session 是内存 Map, 后端每次部署/重启全体 admin token 失效 —— 频繁
 * 发版的日子业主编辑一半就被"登录已过期"打断 (当天连发十几版, 必踢无疑)。
 * 新方案: 令牌 = base64url(payload).hex(HMAC-SHA256(payload, tokenSecret)),
 * payload 自带 iat/exp; tokenSecret 持久化在 admin_auth_v1 表, 重启复用 →
 * 令牌跨重启存活。改密码 → passwordChangedAt 更新, 早于它签发的令牌全部失效
 * (语义与老方案一致)。logout 走内存吊销表 (尽力而为, 重启即清, 可接受)。
 */
@Injectable()
export class AdminAuthService implements OnModuleInit {
  /** 主动登出的令牌吊销表 (内存, 尽力而为) */
  private readonly revoked = new Set<string>();

  constructor(
    @InjectRepository(AdminAuth) private readonly repo: Repository<AdminAuth>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    let row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) {
      row = await this.repo.save(
        this.repo.create({
          id: 1,
          passwordHash: hashPassword(DEFAULT_PASSWORD),
          passwordChangedAt: new Date(),
          tokenSecret: null,
        }),
      );
      this.logger.warn('[AdminAuth] 首次启动已初始化访问密码，请立即在后台修改。');
    }
    // 签名密钥只生成一次, 之后每次重启复用 —— 令牌跨重启存活的根基
    if (!row.tokenSecret) {
      row.tokenSecret = randomBytes(32).toString('hex');
      await this.repo.save(row);
      this.logger.info('[AdminAuth] 签名密钥已生成并持久化 (admin 令牌从此跨重启存活)');
    }
  }

  /** 校验密码, 通过返一个签名 token (自带 8h 有效期) */
  async login(password: string): Promise<{ token: string; expiresAt: string }> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) {
      throw new UnauthorizedException('鉴权未初始化');
    }
    if (!verifyPassword(password, row.passwordHash)) {
      // 注意: 不返"用户不存在"或"密码错"两种区分, 防穷举
      throw new UnauthorizedException('密码错误');
    }
    const secret = await this.ensureSecret(row);
    const now = Date.now();
    const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + TOKEN_TTL_MS })).toString('base64url');
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    this.logger.info(`[AdminAuth] login ok, 颁签名 token (TTL=${TOKEN_TTL_MS / 1000 / 60 / 60}h)`);
    return { token: `${payload}.${sig}`, expiresAt: new Date(now + TOKEN_TTL_MS).toISOString() };
  }

  /** 校验 token: 签名对 + 未过期 + 晚于最近一次改密 + 没被主动登出 */
  async verifyToken(token: string): Promise<boolean> {
    if (!token || this.revoked.has(token)) return false;
    const dot = token.indexOf('.');
    if (dot <= 0) return false; // 老格式 (纯 hex 无点) → 失效, 重登一次即换新制
    const payloadB64 = token.slice(0, dot);
    const sigHex = token.slice(dot + 1);
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row?.tokenSecret) return false;
    const expect = createHmac('sha256', row.tokenSecret).update(payloadB64).digest('hex');
    if (sigHex.length !== expect.length) return false;
    try {
      if (!timingSafeEqual(Buffer.from(sigHex, 'hex'), Buffer.from(expect, 'hex'))) return false;
    } catch {
      return false;
    }
    let payload: { iat?: number; exp?: number };
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { iat?: number; exp?: number };
    } catch {
      return false;
    }
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return false;
    // 改密时间之后签发的才算数 (语义与老方案一致: 改密 = 全员重登)
    if (typeof payload.iat !== 'number' || payload.iat < row.passwordChangedAt.getTime()) return false;
    return true;
  }

  /** 改密码: 验证旧密码 → 写新 hash → passwordChangedAt 更新 → 全部旧令牌失效 */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 6) {
      throw new UnauthorizedException('新密码至少 6 位');
    }
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) throw new UnauthorizedException('鉴权未初始化');
    if (!verifyPassword(oldPassword, row.passwordHash)) {
      throw new UnauthorizedException('旧密码错误');
    }
    row.passwordHash = hashPassword(newPassword);
    row.passwordChangedAt = new Date();
    await this.repo.save(row);
    this.revoked.clear();
    this.logger.warn('[AdminAuth] 密码已修改, 所有旧令牌失效');
  }

  logout(token: string): void {
    this.revoked.add(token);
    // 防吊销表无限膨胀 (单管理员场景不至于, 兜个底)
    if (this.revoked.size > 500) this.revoked.clear();
  }

  private async ensureSecret(row: AdminAuth): Promise<string> {
    if (!row.tokenSecret) {
      row.tokenSecret = randomBytes(32).toString('hex');
      await this.repo.save(row);
    }
    return row.tokenSecret;
  }
}
