/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../../redis/redis.service';
import { normalizeEmail } from '../../common/utils/normalize-email';
import { maskIp } from '../../common/utils/mask';

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(LoginRateLimitGuard.name);
  private readonly windowSeconds = 60;
  private readonly ipLimit = 10;

  constructor(private readonly redisService: RedisService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();

    // lấy ip hợp lý (x-forwarded-for nếu có proxy)
    const ipFromHeader = (req.headers['x-forwarded-for'] as string | undefined)
      ?.split(',')[0]
      ?.trim();
    const ip = ipFromHeader || req.ip || 'unknown';

    const body = (req.body ?? {}) as any;
    const emailRaw = typeof body.email === 'string' ? body.email : '';

    const redis = this.redisService.getClient();
    const res = ctx.switchToHttp().getResponse();

    try {
      const ipKey = `rl:v1:login:ip:${ip}`;
      const [ipCountRaw, ipTtlRaw] = await redis
        .multi()
        .incr(ipKey)
        .ttl(ipKey)
        .exec()
        .then((r) => [Number(r?.[0][1]), Number(r?.[1][1])]);

      const ipCount = ipCountRaw;
      let ttl = ipTtlRaw;

      if (ipCount === 1 || ttl < 0) {
        await redis.expire(ipKey, this.windowSeconds);
        ttl = this.windowSeconds;
      }

      if (ipCount > this.ipLimit) {
        res.setHeader(
          'Retry-After',
          String(ttl > 0 ? ttl : this.windowSeconds),
        );
        throw new HttpException(
          { errorCode: 'RATE_LIMITED', message: 'Too many requests' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (e: any) {
      if (e instanceof HttpException && e.getStatus() === 429) {
        throw e;
      }

      // Redis chết: fail-close
      this.logger.warn(
        `SECURITY rate_limit_fail_close reason=redis_error ip=${maskIp(ip)}`,
      );
      throw new HttpException(
        { errorCode: 'RATE_LIMIT_UNAVAILABLE', message: 'Too many requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
