import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { Observable, map } from 'rxjs';

/**
 * ETag 拦截器 (PERFORMANCE_AUDIT P2-#14).
 *
 * 给所有 GET 响应加 ETag header (基于响应体的 sha1, 截 12 字符).
 * 客户端带 If-None-Match 匹配时返回 304 + 空 body.
 *
 * 收益: 轮询 /api/devices /api/runtime/gateways 等接口在数据没变时, 一次
 * 响应从 5-30 KB 缩到 ~200 字节 header. 主要给 cnjinhu 远程访问省流量.
 *
 * 只处理 GET 请求, 写操作 (POST/PUT/DELETE) 不影响.
 */
@Injectable()
export class EtagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request>();
    if (req.method !== 'GET') return next.handle();
    const res = ctx.getResponse<Response>();

    return next.handle().pipe(
      map((body: unknown) => {
        if (body === undefined || body === null) return body;
        try {
          const json = JSON.stringify(body);
          const etag = `W/"${createHash('sha1').update(json).digest('hex').slice(0, 12)}"`;
          const ifNoneMatch = req.header('if-none-match');
          res.setHeader('ETag', etag);
          // 公开缓存允许 5s (轮询场景下大幅减包)
          if (!res.getHeader('Cache-Control')) {
            res.setHeader('Cache-Control', 'private, max-age=5');
          }
          if (ifNoneMatch === etag) {
            res.status(304).end();
            return null; // 走 ResponseInterceptor 时不会再序列化
          }
          return body;
        } catch {
          // body 不能序列化 (Buffer / stream), 跳过 ETag
          return body;
        }
      }),
    );
  }
}
