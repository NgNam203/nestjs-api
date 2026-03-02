/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { TimeoutError } from '../resilience/timeout.util';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();

    const isHttp = exception instanceof HttpException;
    const isTimeout = exception instanceof TimeoutError;

    const statusCode = isTimeout
      ? HttpStatus.SERVICE_UNAVAILABLE
      : isHttp
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Default payload
    let errorCode = isTimeout ? 'TIMEOUT' : 'INTERNAL_ERROR';
    let message: any = isTimeout
      ? 'Service temporarily unavailable'
      : 'Internal server error';

    // HttpException payload (nếu có)
    if (isHttp) {
      const response = exception.getResponse();

      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const r = response as any;
        errorCode = r.errorCode ?? errorCode;
        message = r.message ?? message;
      } else {
        message = exception.message || message;
      }
    }

    console.log(
      `debug_filter requestId=${req.requestId ?? 'none'} status=${statusCode} errorCode=${errorCode}`,
    );

    res.status(statusCode).json({
      statusCode,
      errorCode,
      message,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      requestId: req.requestId ?? req.headers['x-request-id'] ?? undefined,
    });
  }
}
