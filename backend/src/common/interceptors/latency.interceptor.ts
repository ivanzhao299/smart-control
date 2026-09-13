import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { Logger } from 'winston';

/**
 * 请求耗时拦截器 (PERFORMANCE_AUDIT P3-#21).
 *
 * 给每个请求记录: method / path / status / durationMs / errCode (如有).
 * 慢请求 (> 500ms) 单独 warn, 给后续做 endpoint 直方图 / Grafana 仪表板.
 *
 * 主要给 cnjinhu 远程访问看 P95 用 — 本地 LAN 一般都 < 50ms.
 */
@Injectable()
export class LatencyInterceptor implements NestInterceptor {
  /** 慢请求门限 (毫秒). 超过这个值会 warn 一行. */
  private readonly SLOW_THRESHOLD_MS = 500;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const start = Date.now();
    const method = req.method;
    const path = req.route?.path ?? req.url;

    return next.handle().pipe(
      tap({
        next: () => {
          const dur = Date.now() - start;
          if (dur >= this.SLOW_THRESHOLD_MS) {
            this.logger.warn(`SLOW ${method} ${path} -> ${dur}ms`, { context: 'Latency' });
          }
        },
        error: (err: Error) => {
          const dur = Date.now() - start;
          this.logger.warn(`ERR  ${method} ${path} -> ${dur}ms (${err?.message ?? 'unknown'})`, {
            context: 'Latency',
          });
        },
      }),
    );
  }
}
