import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { RateLimitService } from './rate-limit.service';
import { RateLimitGuard } from './rate-limit.guard';

@Module({
  imports: [RedisModule],
  providers: [RateLimitService, RateLimitGuard],
  exports: [RateLimitGuard, RateLimitService],
})
export class RateLimitModule {}
