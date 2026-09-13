import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'crypto';

type OperationScope = 'restart' | 'rebuild' | 'heartbeat';
const KEY = 'operations-scope';
export const Operation = (scope: OperationScope) => SetMetadata(KEY, scope);

/** Scoped machine credential. Never creates a user/admin identity. */
@Injectable()
export class OperationsGuard implements CanActivate {
  constructor(private readonly config: ConfigService, private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const scope = this.reflector.get<OperationScope>(KEY, context.getHandler());
    const req = context.switchToHttp().getRequest();
    const token = req.headers['x-operations-token'];
    if (!scope || typeof token !== 'string' || token.length < 32 || token.length > 512) throw new UnauthorizedException('运维凭据无效');
    let entries: unknown;
    try { entries = JSON.parse(this.config.get<string>('OPERATIONS_CREDENTIALS') ?? '[]'); }
    catch { throw new UnauthorizedException('运维凭据配置不可用'); }
    if (!Array.isArray(entries) || entries.length > 32) throw new UnauthorizedException('运维凭据配置不可用');
    const digest = createHash('sha256').update(token).digest();
    for (const entry of entries) {
      if (!entry || entry.enabled !== true || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id)) continue;
      if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) continue;
      if (!timingSafeEqual(digest, Buffer.from(entry.sha256, 'hex'))) continue;
      if (!Array.isArray(entry.scopes) || !entry.scopes.includes(scope)) throw new ForbiddenException('运维权限不足');
      if (scope === 'heartbeat' && (typeof entry.host !== 'string' || !entry.host || req.body?.host !== entry.host)) throw new ForbiddenException('心跳主机不匹配');
      req.operationsIdentity = entry.id;
      return true;
    }
    throw new UnauthorizedException('运维凭据无效');
  }
}
