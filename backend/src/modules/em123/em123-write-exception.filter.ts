import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Em123WriteUnconfirmedError } from './em123.client';

/**
 * 写操作"结果未确认"过滤器: 资金/拉合闸指令已发出但平台未给出明确成功/失败响应
 * (会话失效 / 非 JSON)。返回 409 Conflict, 提示操作员"先刷新核对、切勿重复提交"。
 * 系统侧写通道本身不自动重试, 这里也绝不替用户重发。
 */
@Catch(Em123WriteUnconfirmedError)
export class Em123WriteExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(Em123WriteExceptionFilter.name);

  catch(exception: Em123WriteUnconfirmedError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    this.logger.warn(
      `em123 写操作结果未确认 path=${exception.path} status=${exception.httpStatus ?? '-'}`,
    );
    res.status(HttpStatus.CONFLICT).json({
      statusCode: HttpStatus.CONFLICT,
      code: 'EM123_WRITE_UNCONFIRMED',
      message: exception.message,
      path: exception.path,
    });
  }
}
