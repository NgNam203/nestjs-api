import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  async health() {
    const startedAt = process.uptime();

    // DB check
    const dbStart = process.hrtime.bigint();
    const db = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`]);
    const dbMs = Number(process.hrtime.bigint() - dbStart) / 1e6;
    const dbUp = db[0].status === 'fulfilled';

    // Redis check
    const redisStart = process.hrtime.bigint();
    const redis = await Promise.allSettled([
      this.redisService.getClient().ping(),
    ]);
    const redisMs = Number(process.hrtime.bigint() - redisStart) / 1e6;
    const redisUp = redis[0].status === 'fulfilled';

    let status: 'ok' | 'degraded' | 'unhealthy' = 'ok';
    if (!dbUp && !redisUp) status = 'unhealthy';
    else if (!dbUp || !redisUp) status = 'degraded';

    return {
      status,
      uptimeSec: Math.floor(startedAt),
      db: { status: dbUp ? 'up' : 'down', latencyMs: Math.round(dbMs) },
      redis: {
        status: redisUp ? 'up' : 'down',
        latencyMs: Math.round(redisMs),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
