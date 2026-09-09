import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { DelayedError, Job } from 'bullmq';

const STALE_MS = 120_000;
type EmailJob = Pick<
  Job<{ idempotencyKey: string; orderId: string }>,
  'data' | 'id' | 'name' | 'attemptsMade' | 'moveToDelayed'
>;

export function createEmailProcessor(
  prisma: Pick<PrismaClient, 'jobExecution'>,
  execute: (job: EmailJob) => Promise<void>,
) {
  return async (job: EmailJob, token?: string) => {
    const { idempotencyKey } = job.data;
    const now = new Date();
    // The existing, unreferenced row UUID is rotated on takeover as an owner token.
    // Unlike timestamps, it cannot collide between reservation generations.
    const ownerId = randomUUID();
    const log = (event: string) =>
      console.log(
        JSON.stringify({
          event,
          jobId: job.id,
          idempotencyKey,
          attemptsMade: job.attemptsMade,
        }),
      );
    const defer = async (lockedAt: Date): Promise<never> => {
      if (!token) throw new Error('Missing BullMQ lock token for deferral');
      await job.moveToDelayed(
        Math.max(Date.now() + 1000, lockedAt.getTime() + STALE_MS + 1),
        token,
      );
      log('job_deferred_processing');
      throw new DelayedError();
    };
    log('job_received');
    try {
      await prisma.jobExecution.create({
        data: {
          id: ownerId,
          idempotencyKey,
          jobName: job.name,
          status: 'PROCESSING',
          lockedAt: now,
          completedAt: null,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const existing = await prisma.jobExecution.findUnique({
        where: { idempotencyKey },
      });
      if (!existing) throw error;
      if (existing.status === 'COMPLETED') {
        log('job_skip_duplicate_completed');
        return;
      }
      const staleBefore = new Date(now.getTime() - STALE_MS);
      if (existing.lockedAt >= staleBefore) return defer(existing.lockedAt);
      const acquired = await prisma.jobExecution.updateMany({
        where: {
          id: existing.id,
          idempotencyKey,
          status: 'PROCESSING',
          lockedAt: { equals: existing.lockedAt, lt: staleBefore },
        },
        data: { id: ownerId, lockedAt: now, completedAt: null },
      });
      if (acquired.count !== 1) return defer(now);
      log('job_takeover_stale_processing');
    }

    const owned = {
      id: ownerId,
      idempotencyKey,
      status: 'PROCESSING' as const,
    };
    try {
      log('job_started');
      await execute(job);
      const completed = await prisma.jobExecution.updateMany({
        where: owned,
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (completed.count !== 1)
        throw new Error('Job reservation ownership lost');
      log('job_completed');
    } catch (error) {
      try {
        await prisma.jobExecution.deleteMany({ where: owned });
      } catch {
        // Preserve the genuine failure; stale recovery handles failed cleanup.
        log('job_reservation_release_failed');
      }
      throw error;
    }
  };
}
