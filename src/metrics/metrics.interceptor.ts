/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<any>();
    const res = http.getResponse<any>();

    const start = process.hrtime.bigint();

    const method = req.method;
    const pattern =
      req.route?.path ??
      req.route?.stack?.[0]?.route?.path ??
      req.originalUrl ??
      req.url;

    const route = `${method} ${pattern}`;

    // đừng tự bơm /metrics vào metrics
    const url = req.originalUrl || req.url || '';
    const shouldSkip = url.startsWith('/metrics');

    const onFinish = () => {
      if (shouldSkip) return;

      const latencyMs = Math.round(
        Number(process.hrtime.bigint() - start) / 1e6,
      );

      const statusCode = res.statusCode ?? 500;
      this.metrics.recordRequest(route, statusCode, latencyMs);
    };

    // record khi response đã “chốt sổ”
    res.once('finish', onFinish);

    // nếu client drop connection, tránh leak listener
    res.once('close', () => res.off('finish', onFinish));

    return next.handle();
  }
}
