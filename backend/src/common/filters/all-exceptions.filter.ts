import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Request, Response } from 'express';
import { Logger } from 'winston';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.resolveMessage(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error(`${request.method} ${request.url} -> ${status} ${message}`, {
      context: 'ExceptionFilter',
      stack,
    });

    // ⚠️ 关键: 响应已开始发送 (流式响应 / 已 send 后又抛二次异常) 时, 再 .json() 会抛
    // ERR_HTTP_HEADERS_SENT; 而这个 throw 发生在异常过滤器内部, 无人捕获 → 整个 Node
    // 进程崩溃 (2026-06-15 现场事故: 平板重连风暴撞上此 bug, 后端启动 4s 即崩).
    // 异常过滤器绝不能让进程挂: 响应已发就只记日志、放弃二次响应.
    if (response.headersSent) {
      return;
    }

    response.status(status).json({
      success: false,
      message,
    });
  }

  private resolveMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const r = exception.getResponse();
      if (typeof r === 'string') return r;
      if (typeof r === 'object' && r !== null) {
        const obj = r as Record<string, unknown>;
        const m = obj.message;
        if (Array.isArray(m)) return m.join('; ');
        if (typeof m === 'string') return m;
      }
      return exception.message;
    }
    if (exception instanceof Error) return exception.message;
    return 'Internal server error';
  }
}
