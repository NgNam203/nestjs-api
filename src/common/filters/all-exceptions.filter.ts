import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { logger } from '../../logger/logger'; // tùy path bạn đang đặt
import { TimeoutError } from '../resilience/timeout.util';
import { AppError } from '../errors/app-error';

type ReqWithId = Request & { requestId?: string };

function safeMsg(x: unknown): string {
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return x.map(String).join(', ');
  if (x && typeof x === 'object' && 'message' in x)
    return String((x as { message?: unknown }).message);
  return 'Unknown error';
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<ReqWithId>();

    const isApp = exception instanceof AppError;
    const isHttp = exception instanceof HttpException;
    const isTimeout = exception instanceof TimeoutError;

    const statusCode = isTimeout
      ? HttpStatus.SERVICE_UNAVAILABLE
      : isApp
        ? exception.code === 'AUTH_INVALID_CREDENTIALS'
          ? HttpStatus.UNAUTHORIZED
          : HttpStatus.BAD_REQUEST
        : isHttp
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;

    let errorCode = isTimeout
      ? 'TIMEOUT'
      : isApp
        ? exception.code
        : 'INTERNAL_ERROR';
    let message = isTimeout
      ? 'Service temporarily unavailable'
      : isApp
        ? exception.message
        : 'Internal server error';

    if (isHttp) {
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const r = response as { errorCode?: unknown; message?: unknown };
        if (typeof r.errorCode === 'string') errorCode = r.errorCode;
        message = safeMsg(r.message) || message;
      } else {
        message = exception.message || message;
      }
    }

    const requestId =
      req.requestId ??
      (typeof req.headers['x-request-id'] === 'string'
        ? req.headers['x-request-id']
        : undefined);

    const logPayload = {
      requestId,
      method: req.method,
      path: req.originalUrl ?? req.url,
      statusCode,
      errorCode,
      // pino sẽ serialize error object tốt nếu bạn đưa thẳng vào field `err`
      err: exception,
    };

    if (statusCode >= 500) logger.error(logPayload, 'request_failed');
    else logger.warn(logPayload, 'request_failed');

    res.status(statusCode).json({
      statusCode,
      errorCode,
      message: statusCode >= 500 ? 'Something went wrong' : message,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      requestId,
    });
  }
}
