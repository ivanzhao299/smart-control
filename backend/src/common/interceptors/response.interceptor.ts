import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiResponse<T> {
  success: true;
  message: string;
  data: T;
}

type ServiceResult<T> = { message?: string; data: T } | T;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<ServiceResult<T>>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((payload) => {
        if (isObject(payload) && 'success' in payload) {
          return payload as unknown as ApiResponse<T>;
        }
        if (isObject(payload) && 'data' in payload) {
          const p = payload as { message?: string; data: T };
          return {
            success: true,
            message: p.message ?? 'ok',
            data: p.data,
          };
        }
        return {
          success: true,
          message: 'ok',
          data: payload as T,
        };
      }),
    );
  }
}
