/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import 'dotenv/config';
import { Worker } from 'bullmq';
import { getBullRedisConnection } from './infra/queue/redis.connection';
import { EMAIL_QUEUE_NAME } from './infra/queue/queues';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createEmailProcessor } from './worker.processor';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const worker = new Worker(
  EMAIL_QUEUE_NAME,
  createEmailProcessor(prisma, () => sleep(8000)),
  { connection: getBullRedisConnection(), concurrency: 1 },
);

worker.on('error', (err) => {
  const e = err as any;
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'worker_error',
      name: e?.name,
      message: e?.message,
      code: e?.code,
    }),
  );
  if (e?.errors?.length) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'worker_error_details',
        errors: e.errors.map((x: any) => ({
          name: x?.name,
          message: x?.message,
          code: x?.code,
          address: x?.address,
          port: x?.port,
        })),
      }),
    );
  }
});

worker.on('stalled', (jobId) => {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'job_stalled',
      jobId,
    }),
  );
});

worker.on('failed', (job, err) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'job_failed',
      queue: EMAIL_QUEUE_NAME,
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      orderId: (job?.data as { orderId?: string })?.orderId,
      error: err.message,
    }),
  );
});

console.log(
  JSON.stringify({ event: 'worker_booted', queue: EMAIL_QUEUE_NAME }),
);
