import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type BeginResult =
  | { kind: 'NEW' }
  | { kind: 'REPLAY'; response: Prisma.JsonValue | null }
  | { kind: 'IN_PROGRESS' };

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async begin(
    userId: string,
    key: string,
    requestHash: string,
    ttlSeconds = 86400,
  ): Promise<BeginResult> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    try {
      await this.prisma.idempotencyKey.create({
        data: {
          userId,
          key,
          requestHash,
          status: 'IN_PROGRESS',
          expiresAt,
        },
        select: { id: true },
      });
      return { kind: 'NEW' };
    } catch (e) {
      // Unique violation => record exists
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await this.prisma.idempotencyKey.findUnique({
          where: { userId_key: { userId, key } },
          select: {
            requestHash: true,
            status: true,
            responseSnapshot: true,
            expiresAt: true,
          },
        });

        // Nếu mà vẫn null thì có gì đó rất sai, rethrow
        if (!existing) throw e;

        // expired -> treat as new (hoặc bạn chọn reject, tuỳ policy)
        if (existing.expiresAt.getTime() <= Date.now()) {
          // Cleanup record cũ để cho phép create lại
          await this.prisma.idempotencyKey.delete({
            where: { userId_key: { userId, key } },
          });
          // gọi lại begin lần nữa
          return this.begin(userId, key, requestHash, ttlSeconds);
        }

        if (existing.requestHash !== requestHash) {
          throw new ConflictException({
            errorCode: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency-Key reused with different payload',
          });
        }

        if (existing.status === 'COMPLETED') {
          return { kind: 'REPLAY', response: existing.responseSnapshot };
        }

        return { kind: 'IN_PROGRESS' };
      }

      throw e;
    }
  }

  async complete(
    userId: string,
    key: string,
    responseSnapshot: Prisma.InputJsonValue,
  ) {
    await this.prisma.idempotencyKey.update({
      where: { userId_key: { userId, key } },
      data: {
        status: 'COMPLETED',
        responseSnapshot,
      },
    });
  }

  async fail(userId: string, key: string) {
    // scope intern: đơn giản nhất là xóa để retry lại
    await this.prisma.idempotencyKey.delete({
      where: { userId_key: { userId, key } },
    });
  }
}
