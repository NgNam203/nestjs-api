import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    const url =
      this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.logger.log(`redis_url ${url}`);
    this.client = new Redis(url, {
      // quan trọng: fail nhanh khi Redis down
      connectTimeout: 300,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => {
        const delay = Math.min(times * 200, 2000); // backoff tối đa 2s
        return delay;
      },
    });

    this.client.on('error', (err: unknown) => {
      // err type không chắc có .code, nên cast đúng kiểu
      const e = err as NodeJS.ErrnoException;
      this.logger.warn(`redis_error ${e.code ?? 'UNKNOWN'}`);
    });

    this.client.on('connect', () => this.logger.log('redis_connect'));
    this.client.on('ready', () => this.logger.log('redis_ready'));
    this.client.on('end', () => this.logger.warn('redis_end'));
  }

  getClient() {
    return this.client;
  }

  async waitReady(timeoutMs = 1500) {
    if (this.client.status === 'ready') return;

    await Promise.race([
      new Promise<void>((resolve) =>
        this.client.once('ready', () => resolve()),
      ),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error('Redis not ready in time')),
          timeoutMs,
        ),
      ),
    ]);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
