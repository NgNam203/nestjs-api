import { RedisOptions } from 'ioredis';

export function getBullRedisConnection(): RedisOptions {
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);

    return {
      host: url.hostname,
      port: Number(url.port),
      username: url.username || undefined,
      password: url.password || undefined,
      maxRetriesPerRequest: null,
      tls: url.protocol === 'rediss:' ? {} : undefined,
    };
  }

  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    maxRetriesPerRequest: null,
  };
}
