import { Queue } from 'bullmq';
import { getBullRedisConnection } from './redis.connection';

export const EMAIL_QUEUE_NAME = 'email';

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: getBullRedisConnection(),
});
