/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unused-vars */
import 'dotenv/config';
import { Worker } from 'bullmq';
import { bullRedisConnection } from './infra/queue/redis.connection';
import { EMAIL_QUEUE_NAME } from './infra/queue/queues';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const withTimeout = async <T>(fn: () => Promise<T>, ms: number): Promise<T> => {
  return Promise.race<T>([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`JOB_TIMEOUT_${ms}MS`)), ms),
    ),
  ]);
};

const worker = new Worker(
  EMAIL_QUEUE_NAME,
  async (job) => {
    const { idempotencyKey, orderId } = job.data;

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'job_received',
        jobId: job.id,
        idempotencyKey,
        attemptsMade: job.attemptsMade,
      }),
    );

    const STALE_MS = 2 * 60 * 1000; // 2 phút, intern-scope đủ xài
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_MS);
    // 1) Try reserve
    // - If not exists => create PROCESSING
    // - If exists PROCESSING but stale => take over (update lockedAt)
    // - If exists COMPLETED => skip
    try {
      await prisma.jobExecution.create({
        data: {
          idempotencyKey,
          jobName: job.name,
          status: 'PROCESSING',
          lockedAt: now,
          completedAt: null,
        },
      });
    } catch (e: any) {
      // record exists -> decide what to do
      const existing = await prisma.jobExecution.findUnique({
        where: { idempotencyKey },
        select: { status: true, lockedAt: true, completedAt: true },
      });

      if (!existing) throw e; // cực hiếm, nhưng đừng giả ngu

      if (existing.status === 'COMPLETED') {
        console.log(
          JSON.stringify({
            ts: new Date().toISOString(),
            event: 'job_skip_duplicate_completed',
            jobId: job.id,
            idempotencyKey,
          }),
        );
        return;
      }

      // PROCESSING: check stale
      const isStale = existing.lockedAt.getTime() < staleBefore.getTime();
      if (!isStale) {
        console.log(
          JSON.stringify({
            ts: new Date().toISOString(),
            event: 'job_skip_duplicate_processing',
            jobId: job.id,
            idempotencyKey,
            lockedAt: existing.lockedAt.toISOString(),
          }),
        );
        return;
      }

      // stale -> take over
      await prisma.jobExecution.update({
        where: { idempotencyKey },
        data: { lockedAt: now, status: 'PROCESSING' },
      });

      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: 'job_takeover_stale_processing',
          jobId: job.id,
          idempotencyKey,
          prevLockedAt: existing.lockedAt.toISOString(),
        }),
      );
    }

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'job_started',
        jobId: job.id,
        idempotencyKey,
      }),
    );

    // 📧 Simulate email send
    await sleep(8000);

    // ✅ Mark completed
    await prisma.jobExecution.update({
      where: { idempotencyKey },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'job_completed',
        jobId: job.id,
        idempotencyKey,
      }),
    );
  },
  { connection: bullRedisConnection, concurrency: 1 },
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
