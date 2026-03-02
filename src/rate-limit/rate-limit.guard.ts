/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

type FailPolicy = 'fail-open' | 'fail-close';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly rl: RateLimitService) {}
  private readonly logger = new Logger(RateLimitGuard.name);

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();

    const method: string = req.method;
    const url: string = String(req.originalUrl ?? req.url ?? '');
    const isCreateOrder = method === 'POST' && url.startsWith('/orders');

    const ip = this.getClientIp(req);

    // NOTE: req.user shape depends on your Jwt strategy.
    // In many Nest apps, it's { userId, role } from your decorator.
    const userId = req.user?.userId;

    // 2) Create order - private, availability priority => fail-open
    if (isCreateOrder) {
      const ident = userId ? `user:${userId}` : `ip:${ip}`;
      const key = `rl:v1:create_order:${ident}`;
      return this.enforce(res, key, 30, 60, 'fail-open');
    }

    return true;
  }

  private async enforce(
    res: any,
    key: string,
    limit: number,
    windowSec: number,
    policy: FailPolicy,
  ): Promise<boolean> {
    const result = await this.rl.checkFixedWindow(
      key,
      limit,
      windowSec,
      policy,
    );
    if (result.reason === 'REDIS_ERROR_FAIL_OPEN') {
      this.logger.warn(
        `rl_event event=rate_limit_bypass reason=redis_error keyPrefix=${key.split(':').slice(0, 4).join(':')}`,
      );
    }
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      throw new HttpException(
        {
          statusCode: 429,
          errorCode: 'TOO_MANY_REQUESTS',
          message: 'Too many requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getClientIp(req: any): string {
    // If behind proxy, x-forwarded-for may exist.
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
    return req.ip || req.connection?.remoteAddress || 'unknown';
  }
}
