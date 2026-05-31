import { Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { randomBytes } from 'crypto';
import { ClientAuth } from '../../entities/client-auth.entity';
import { hashPassword, verifyPassword } from '../../common/utils/password.util';

/** 业主原话: 初始密码 1234. 弱但符合业主"先能用"的优先, 进后台第一件事改. */
const DEFAULT_PASSWORD = '1234';
/** 客户端 token TTL: 30 天, 比 admin 长很多 (业主天天用, 不想老登) */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionEntry {
  issuedAt: number;
  expiresAt: number;
}

@Injectable()
export class ClientAuthService implements OnModuleInit {
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    @InjectRepository(ClientAuth) private readonly repo: Repository<ClientAuth>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.repo.findOne({ where: { id: 1 } });
    if (!existing) {
      await this.repo.save(
        this.repo.create({
          id: 1,
          passwordHash: hashPassword(DEFAULT_PASSWORD),
          passwordChangedAt: new Date(),
        }),
      );
      this.logger.warn(`[ClientAuth] 首次启动, 默认密码已植入: ${DEFAULT_PASSWORD}. 业主进后台后请改.`);
    }
  }

  async login(password: string): Promise<{ token: string; expiresAt: string }> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) throw new UnauthorizedException('鉴权未初始化');
    if (!verifyPassword(password, row.passwordHash)) {
      throw new UnauthorizedException('密码错误');
    }
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    this.sessions.set(token, { issuedAt: now, expiresAt: now + TOKEN_TTL_MS });
    this.cleanupExpired();
    this.logger.info(`[ClientAuth] login ok, 颁 token (TTL=${TOKEN_TTL_MS / 1000 / 60 / 60 / 24}d)`);
    return { token, expiresAt: new Date(now + TOKEN_TTL_MS).toISOString() };
  }

  async verifyToken(token: string): Promise<boolean> {
    const entry = this.sessions.get(token);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (row && entry.issuedAt < row.passwordChangedAt.getTime()) {
      this.sessions.delete(token);
      return false;
    }
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
    await this.repo.save(row);
    this.sessions.clear();
    this.logger.warn('[ClientAuth] 密码已修改, 所有 session 失效');
  }

  /** 健康检查 — 业主在登录页"测试连接"调这个, 不需要密码 */
  ping(): { ok: true; service: 'client-auth'; serverTime: string } {
    return { ok: true as const, service: 'client-auth' as const, serverTime: new Date().toISOString() };
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [t, e] of this.sessions) {
      if (e.expiresAt < now) this.sessions.delete(t);
    }
  }
}
