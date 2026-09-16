import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { AdminAuth } from '../../entities/admin-auth.entity';

/** 验证收敛前已签发的共享后台令牌；新后台登录统一由个人账户签发。 */
@Injectable()
export class AdminAuthService {
  /** 主动登出的令牌吊销表 (内存, 尽力而为) */
  private readonly revoked = new Set<string>();

  constructor(
    @InjectRepository(AdminAuth) private readonly repo: Repository<AdminAuth>,
  ) {}

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

  logout(token: string): void {
    this.revoked.add(token);
    // 防吊销表无限膨胀 (单管理员场景不至于, 兜个底)
    if (this.revoked.size > 500) this.revoked.clear();
  }
}
