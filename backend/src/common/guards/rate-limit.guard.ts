import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * 简易令牌桶限流 (PERFORMANCE_AUDIT P2-#18).
 *
 * 给设备命令 endpoint 加 @RateLimit(max=5, perSec=1) 这种装饰器,
 * 防止用户点亮度滑条 / 误连点 30 次造成命令队列堆积.
 *
 * 按 IP × route 维度分桶. 内存级, 单实例 (GK9000 单进程足够).
 * cnjinhu 公网可叠加 nginx limit_req 做第二层.
 */

interface RateLimitOpts {
  /** 每 windowMs 允许的最大请求数 */
  max: number;
  /** 窗口 (ms), 默认 1000 */
  windowMs?: number;
}

export const RATE_LIMIT_KEY = 'rate-limit';
export const RateLimit = (opts: RateLimitOpts): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, opts);

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const opts = this.reflector.getAllAndOverride<RateLimitOpts | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!opts) return true;
    const windowMs = opts.windowMs ?? 1000;

    const req = context.switchToHttp().getRequest<Request>();
    const ip = (req.ip ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
    const route = req.route?.path ?? req.url;
    const key = `${ip}|${req.method}|${route}`;

    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      const retryAfterMs = Math.max(0, bucket.resetAt - now);
      throw new TooManyRequestsException(
        `请求过快, 请 ${Math.ceil(retryAfterMs / 1000)}s 后重试`,
      );
    }

    // 定期 GC: 1000 桶就清一次过期的, 防内存泄漏
    if (this.buckets.size > 1000) {
      for (const [k, b] of this.buckets) {
        if (b.resetAt < now) this.buckets.delete(k);
      }
    }
    return true;
  }
}
