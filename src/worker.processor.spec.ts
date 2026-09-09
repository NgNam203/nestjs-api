import { JobExecution, Prisma, PrismaClient } from '@prisma/client';
import { DelayedError } from 'bullmq';
import { createEmailProcessor } from './worker.processor';

const conflict = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: '7.2.0',
  });

describe('worker domain reservations', () => {
  let row: JobExecution | null;
  let db: {
    create: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  const job = () => ({
    id: 'job',
    name: 'send_order_email',
    attemptsMade: 0,
    data: { idempotencyKey: 'email:order_confirm:1', orderId: '1' },
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  });
  const seed = (status: 'PROCESSING' | 'COMPLETED', age = 0) => {
    row = {
      id: 'old-owner',
      idempotencyKey: job().data.idempotencyKey,
      jobName: job().name,
      status,
      lockedAt: new Date(Date.now() - age),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  const matches = (where: any) =>
    row &&
    row.id === where.id &&
    row.idempotencyKey === where.idempotencyKey &&
    row.status === where.status &&
    (!where.lockedAt ||
      (row.lockedAt.getTime() === where.lockedAt.equals.getTime() &&
        row.lockedAt < where.lockedAt.lt));
  const processor = (execute = jest.fn().mockResolvedValue(undefined)) =>
    createEmailProcessor(
      { jobExecution: db } as unknown as Pick<PrismaClient, 'jobExecution'>,
      execute,
    );

  beforeEach(() => {
    row = null;
    jest.spyOn(console, 'log').mockImplementation();
    db = {
      create: jest.fn(async ({ data }) => {
        if (row) throw conflict();
        row = { ...data, createdAt: new Date(), updatedAt: new Date() };
        return row;
      }),
      findUnique: jest.fn(async () => (row ? { ...row } : null)),
      updateMany: jest.fn(async ({ where, data }) => {
        if (!matches(where)) return { count: 0 };
        row = { ...row!, ...data };
        return { count: 1 };
      }),
      deleteMany: jest.fn(async ({ where }) => {
        if (!matches(where)) return { count: 0 };
        row = null;
        return { count: 1 };
      }),
    };
  });
  afterEach(() => jest.restoreAllMocks());

  it('releases a failed attempt and lets its retry complete', async () => {
    const error = new Error('execution failed');
    const execute = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);
    const run = processor(execute);
    await expect(run(job(), 'token')).rejects.toBe(error);
    expect(row).toBeNull();
    await run({ ...job(), attemptsMade: 1 }, 'retry-token');
    expect(row!.status).toBe('COMPLETED');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('defers fresh PROCESSING using the BullMQ control error', async () => {
    seed('PROCESSING');
    const current = job();
    const execute = jest.fn();
    await expect(processor(execute)(current, 'token')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(current.moveToDelayed).toHaveBeenCalledWith(
      row!.lockedAt.getTime() + 120001,
      'token',
    );
    expect(current.attemptsMade).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(db.deleteMany).not.toHaveBeenCalled();
  });

  it('skips a COMPLETED duplicate safely', async () => {
    seed('COMPLETED');
    const execute = jest.fn();
    await expect(processor(execute)(job(), 'token')).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it('propagates non-P2002 DB errors without treating them as conflicts', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('DB unavailable', {
      code: 'P1001',
      clientVersion: '7.2.0',
    });
    db.create.mockRejectedValueOnce(error);
    await expect(processor()(job(), 'token')).rejects.toBe(error);
    expect(db.findUnique).not.toHaveBeenCalled();
  });

  it('allows only one concurrent stale takeover owner', async () => {
    seed('PROCESSING', 121000);
    const execute = jest.fn().mockResolvedValue(undefined);
    const run = processor(execute);
    const results = await Promise.allSettled([
      run(job(), 'a'),
      run(job(), 'b'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: expect.any(DelayedError),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(row!.status).toBe('COMPLETED');
    expect(row!.id).not.toBe('old-owner');
  });

  it('prevents an old owner completing or releasing a newer reservation', async () => {
    const run = processor(
      jest.fn(async () => {
        row = { ...row!, id: 'new-owner' };
      }),
    );
    await expect(run(job(), 'token')).rejects.toThrow('ownership lost');
    expect(row!.id).toBe('new-owner');
    expect(row!.status).toBe('PROCESSING');
    expect(db.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('preserves the completion DB error even if reservation release fails', async () => {
    const error = new Error('completion DB failure');
    db.updateMany.mockRejectedValueOnce(error);
    db.deleteMany.mockRejectedValueOnce(new Error('cleanup DB failure'));
    await expect(processor()(job(), 'token')).rejects.toBe(error);
    expect(row!.status).toBe('PROCESSING');
  });

  it('propagates moveToDelayed failures as genuine failures', async () => {
    seed('PROCESSING');
    const current = job();
    const error = new Error('Redis failure');
    current.moveToDelayed.mockRejectedValueOnce(error);
    await expect(processor()(current, 'token')).rejects.toBe(error);
    expect(db.deleteMany).not.toHaveBeenCalled();
  });
});
