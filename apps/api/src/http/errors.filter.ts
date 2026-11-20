import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './validation.mjs';
import { json } from './wire.mjs';

@Catch()
export class ErrorsFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof AppError) {
      json(response, error.status, { error: error.message },
        error.status===429&&error.retryAfter?{'Retry-After':String(error.retryAfter)}:undefined);
      return;
    }
    if (error instanceof HttpException) {
      json(response, error.getStatus(), { error: error.getStatus() === 404
        ? 'Không tìm thấy thao tác.' : error.message });
      return;
    }
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      json(response, 409, { error: 'Dữ liệu này đã tồn tại.' });
      return;
    }
    console.error('API error:', error instanceof Error ? error.name : typeof error);
    json(response, 500, { error: 'Máy chủ gặp lỗi khi xử lý yêu cầu.' });
  }
}
