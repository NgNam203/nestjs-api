import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { IdempotencyService } from './idempotency/idempotency.service';
import { CacheModule } from '../cache/cache.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { ExternalModule } from '../external/external.module';

@Module({
  imports: [CacheModule, RateLimitModule, ExternalModule],
  controllers: [OrdersController],
  providers: [OrdersService, IdempotencyService],
})
export class OrdersModule {}
