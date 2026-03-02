/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class LatencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LatencyInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = Date.now();
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const requestId = (req as any).requestId ?? 'no-request-id';
    const method = (req as any).method;
    const path = (req as any).path;
    const ip = (req as any).ip;

    // Log khi response thực sự kết thúc -> statusCode chuẩn
    const log = (event: 'finish' | 'close') => {
      const durationMs = Date.now() - start;
      const statusCode = res.statusCode; // chuẩn nhất
      this.logger.log(
        `request_completed requestId=${requestId} method=${method} path=${path} status=${statusCode} durationMs=${durationMs} ip=${ip} event=${event}`,
      );
    };

    // finish = response sent xong
    res.once('finish', () => log('finish'));
    // close = client disconnect / aborted
    res.once('close', () => {
      // tránh double log nếu finish đã chạy
      if (!res.writableEnded) log('close');
    });

    return next.handle();
  }
}
