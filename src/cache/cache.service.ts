/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(private readonly redisService: RedisService) {}

  private get bypass(): boolean {
    return process.env.CACHE_BYPASS === '1';
  }

  private get redis() {
    return this.redisService.getClient();
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (this.bypass) return null;
    try {
      const val = await this.redis.get(key);
      return val ? (JSON.parse(val) as T) : null;
    } catch {
      this.logger.warn(
        `cache_event event=cache_bypass_redis keyPrefix=${this.keyPrefix(key)}`,
      );
      return null;
    }
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    if (this.bypass) return;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      this.logger.warn(
        `cache_event event=cache_set_failed keyPrefix=${this.keyPrefix(key)}`,
      );
    }
  }

  async del(key: string): Promise<void> {
    if (this.bypass) return;
    try {
      await this.redis.del(key);
    } catch {
      this.logger.warn(
        `cache_event event=cache_del_failed keyPrefix=${this.keyPrefix(key)}`,
      );
    }
  }

  async acquireLock(lockKey: string, ttlMs: number): Promise<boolean> {
    if (this.bypass) return false;
    try {
      const res = await (this.redis as any).set(
        lockKey,
        '1',
        'NX',
        'PX',
        ttlMs,
      );
      return res === 'OK';
    } catch {
      this.logger.warn(
        `cache_event event=cache_lock_failed keyPrefix=${this.keyPrefix(lockKey)}`,
      );
      return false;
    }
  }

  async releaseLock(lockKey: string): Promise<void> {
    if (this.bypass) return;
    await this.del(lockKey);
  }

  sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  private keyPrefix(key: string): string {
    return key.split(':').slice(0, 4).join(':');
  }
}
