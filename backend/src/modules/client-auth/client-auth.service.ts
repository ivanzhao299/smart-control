import { Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { ClientAuth } from '../../entities/client-auth.entity';
import { hashPassword, verifyPassword } from '../../common/utils/password.util';

/** 业主原话: 初始密码 1234. 弱但符合业主"先能用"的优先, 进后台第一件事改. */
const DEFAULT_PASSWORD = '1234';
/** 客户端 token TTL: 30 天, 比 admin 长很多 (业主天天用, 不想老登) */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 客户端鉴权 (2026-07-27 签名令牌制重构)。
 *
 * 老方案: login 发随机 token, 存**内存 Map** —— 后端每次重启/部署 Map 清空,
 * 全体 token 没到期也失效, 业主的 iPhone/平板 PWA 被打回登录页 ("经常退出")。
 * 部署越勤退得越勤, 这是结构性缺陷不是网络问题。
 *
 * 新方案: HMAC-SHA256 签名令牌 `base64url(payload).hex(sig)`,
 * payload = {iat, exp}。签名密钥持久化在 client_auth_v1.tokenSecret:
 *   - 后端重启/部署 → 密钥还在 → 老令牌照样验过, 业主无感 (根治)
 *   - 改密码 → 密钥轮换 + passwordChangedAt 更新 → 全体令牌立即作废 (语义与老方案一致)
 *   - 单令牌注销 → 进程内黑名单 (业主"退出登录"本来就少用, 重启后黑名单清空可接受,
 *     因为对应客户端本地也已删 token)
 * 老格式 (64 位纯 hex) 令牌一律判失效 → 前端 401 → 存的密码静默重登, 一次性平滑换轨。
 */
@Injectable()
export class ClientAuthService implements OnModuleInit {
  /** 注销黑名单 (签名令牌无状态, 注销靠这里兜) */
  private readonly revoked = new Set<string>();

  constructor(
    @InjectRepository(ClientAuth) private readonly repo: Repository<ClientAuth>,
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
      this.logger.warn(`[ClientAuth] 首次启动, 默认密码已植入: ${DEFAULT_PASSWORD}. 业主进后台后请改.`);
    }
    // 签名密钥只生成一次, 之后每次重启都复用 —— 令牌跨重启存活的根基
    if (!row.tokenSecret) {
      row.tokenSecret = randomBytes(32).toString('hex');
      await this.repo.save(row);
      this.logger.info('[ClientAuth] 签名密钥已生成并持久化 (令牌从此跨重启存活)');
    }
  }

  async login(password: string): Promise<{ token: string; expiresAt: string }> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) throw new UnauthorizedException('鉴权未初始化');
    if (!verifyPassword(password, row.passwordHash)) {
      throw new UnauthorizedException('密码错误');
    }
    const secret = await this.ensureSecret(row);
    const now = Date.now();
    const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + TOKEN_TTL_MS })).toString('base64url');
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    this.logger.info(`[ClientAuth] login ok, 颁签名 token (TTL=${TOKEN_TTL_MS / 1000 / 60 / 60 / 24}d)`);
    return { token: `${payload}.${sig}`, expiresAt: new Date(now + TOKEN_TTL_MS).toISOString() };
  }

  async verifyToken(token: string): Promise<boolean> {
    if (!token || this.revoked.has(token)) return false;
    const dot = token.indexOf('.');
    if (dot <= 0) return false; // 老格式 (纯 hex 无点) → 失效, 前端会用存的密码静默重登
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
    // 改密时间之后签发的才算数 (语义与老方案一致: 改密 = 全体重登)
    if (typeof payload.iat !== 'number' || payload.iat < row.passwordChangedAt.getTime()) return false;
    return true;
  }

  /**
   * 改密 — 注意业主在后台 (admin) 改客户端密码, 走 AdminGuard 校验过 admin 后,
   * 直接传新密码, 不要求旧密码 (业主可能忘了客户端密码, admin 应该能强制重置).
   */
  async resetPassword(newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 4) {
      throw new UnauthorizedException('新密码至少 4 位');
    }
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) throw new UnauthorizedException('鉴权未初始化');
    row.passwordHash = hashPassword(newPassword);
    row.passwordChangedAt = new Date();
    row.tokenSecret = randomBytes(32).toString('hex'); // 密钥轮换 = 全体令牌立即作废
    await this.repo.save(row);
    this.revoked.clear();
    this.logger.warn('[ClientAuth] 密码已修改, 签名密钥已轮换, 所有令牌失效');
  }

  /** 健康检查 — 业主在登录页"测试连接"调这个, 不需要密码 */
  ping(): { ok: true; service: 'client-auth'; serverTime: string } {
    return { ok: true as const, service: 'client-auth' as const, serverTime: new Date().toISOString() };
  }

  logout(token: string): void {
    if (token) this.revoked.add(token);
    // 防黑名单无限涨 (每次注销顺手清一遍过期的没必要 — 上限兜底即可)
    if (this.revoked.size > 1000) this.revoked.clear();
  }

  private async ensureSecret(row: ClientAuth): Promise<string> {
    if (row.tokenSecret) return row.tokenSecret;
    row.tokenSecret = randomBytes(32).toString('hex');
    await this.repo.save(row);
    return row.tokenSecret;
  }
}
