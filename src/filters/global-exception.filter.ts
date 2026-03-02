/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const response = ctx.getResponse<Response>();

    const traceId = request.requestId ?? 'no-request-id';

    // Default values cho lỗi không kiểm soát
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();

      const res = exception.getResponse();

      if (typeof res === 'object' && res !== null) {
        const body = res as any;

        // Ưu tiên giữ errorCode/message nếu có (cho auth)
        if (body.errorCode) {
          code = body.errorCode;
          message = body.message ?? message;
        }

        message = body.message ?? message;
      } else if (typeof res === 'string') {
        message = res;
      }

      // Map status -> code (đơn giản, rõ ràng)
      if (!code || code === 'INTERNAL_ERROR') {
        switch (status) {
          case 400:
            code = 'BAD_REQUEST';
            break;
          case 401:
            code = 'UNAUTHORIZED';
            break;
          case 403:
            code = 'FORBIDDEN';
            break;
          case 404:
            code = 'NOT_FOUND';
            break;
          default:
            code = 'HTTP_ERROR';
        }
      }
    }
    // ==== LOG ERROR (NỘI BỘ) ====
    // Không log body/headers. Chỉ log context đủ debug.
    const method = request.method;
    const path = request.path; // KHÔNG dùng originalUrl để tránh log query nhạy cảm
    const ip = request.ip;

    // stack chỉ có nếu exception là Error
    const stack = exception instanceof Error ? exception.stack : undefined;

    // Với 4xx: thường là lỗi client -> warn
    // Với 5xx: lỗi server -> error + stack

    if (status >= 500) {
      this.logger.error(
        `request_failed traceId=${traceId} method=${method} path=${path} status=${status} code=${code} ip=${ip} message="${String(
          message,
        )}"`,
        stack,
      );
    } else {
      this.logger.warn(
        `request_rejected traceId=${traceId} method=${method} path=${path} status=${status} code=${code} ip=${ip} message="${String(
          message,
        )}"`,
      );
    }
    response.status(status).json({
      errorCode: code,
      message,
      traceId,
    });
  }
}
