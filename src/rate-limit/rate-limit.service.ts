/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number; // 0 nếu allowed
  reason?:
    | 'OK'
    | 'LIMITED'
    | 'REDIS_ERROR_FAIL_OPEN'
    | 'REDIS_ERROR_FAIL_CLOSE';
};

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis() {
    return this.redisService.getClient();
  }

  async checkFixedWindow(
    key: string,
    limit: number,
    windowSec: number,
    policy: 'fail-open' | 'fail-close',
  ): Promise<RateLimitResult> {
    try {
      // 2 commands in one round-trip
      const res = await this.redis.multi().incr(key).ttl(key).exec();

      if (!res) throw new Error('Redis MULTI failed');

      const count = Number(res[0][1]);
      let ttl = Number(res[1][1]);

      // ttl -1: exists no expire; ttl -2: key missing (rare right after incr)
      if (count === 1 || ttl < 0) {
        await this.redis.expire(key, windowSec);
        ttl = windowSec;
      }

      if (count > limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSec: Math.max(ttl, 1),
          reason: 'LIMITED',
        };
      }

      return {
        allowed: true,
        remaining: Math.max(limit - count, 0),
        retryAfterSec: 0,
        reason: 'OK',
      };
    } catch (e) {
      this.logger.warn(
        `rl_event event=redis_error action=${policy === 'fail-open' ? 'ALLOW' : 'BLOCK'} keyPrefix=${this.prefix(key)} policy=${policy}`,
      );

      // fail-open: allow traffic (availability)
      if (policy === 'fail-open') {
        return {
          allowed: true,
          remaining: 0,
          retryAfterSec: 0,
          reason: 'REDIS_ERROR_FAIL_OPEN',
        };
      }

      // fail-close: block traffic (security)
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: 1,
        reason: 'REDIS_ERROR_FAIL_CLOSE',
      };
    }
  }

  private prefix(key: string): string {
    return key.split(':').slice(0, 4).join(':');
  }
}
