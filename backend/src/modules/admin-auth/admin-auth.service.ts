import { Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { randomBytes } from 'crypto';
import { AdminAuth } from '../../entities/admin-auth.entity';
import { hashPassword, verifyPassword } from '../../common/utils/password.util';

const DEFAULT_PASSWORD = 'jinhu888';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 小时, 跟一个工作日相当

interface SessionEntry {
  issuedAt: number;
  expiresAt: number;
}

@Injectable()
export class AdminAuthService implements OnModuleInit {
  /** 内存 session 表 (token → 时间戳). backend 重启会清, 全员需要重登 — 这是预期行为 */
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    @InjectRepository(AdminAuth) private readonly repo: Repository<AdminAuth>,
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
      this.logger.warn(`[AdminAuth] 首次启动, 默认密码已植入: ${DEFAULT_PASSWORD}. 业主进后台后请立即改.`);
    }
  }

  /** 校验密码, 通过返一个新 sessionToken (32 字节随机) */
  async login(password: string): Promise<{ token: string; expiresAt: string }> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) {
      throw new UnauthorizedException('鉴权未初始化');
    }
    if (!verifyPassword(password, row.passwordHash)) {
      // 注意: 不返"用户不存在"或"密码错"两种区分, 防穷举
      throw new UnauthorizedException('密码错误');
    }
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    this.sessions.set(token, { issuedAt: now, expiresAt: now + TOKEN_TTL_MS });
    this.cleanupExpired();
    this.logger.info(`[AdminAuth] login ok, 颁 token (TTL=${TOKEN_TTL_MS / 1000 / 60 / 60}h)`);
    return { token, expiresAt: new Date(now + TOKEN_TTL_MS).toISOString() };
  }

  /** 校验 token 是否有效 (存在 + 未过期 + 没在改密后被签发) */
  async verifyToken(token: string): Promise<boolean> {
    const entry = this.sessions.get(token);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    // 改密后所有早于改密时间的 token 全部失效
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (row && entry.issuedAt < row.passwordChangedAt.getTime()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  /** 改密码: 验证旧密码 → 写新 hash → passwordChangedAt 更新 → 所有旧 session 失效 */
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
    // 清掉所有 session, 强制全员重登
    this.sessions.clear();
    this.logger.warn('[AdminAuth] 密码已修改, 所有 session 失效');
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
