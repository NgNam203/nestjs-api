/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { appLogger } from '../logger/app-logger';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
    });

    super({ adapter });
    (this as any).$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }: any) {
            const start = Date.now();
            try {
              const result = await query(args);
              const ms = Date.now() - start;
              if (ms > 200) {
                appLogger.warn(
                  { db: { model, action: operation, ms } },
                  'db_slow',
                );
              }
              return result;
            } catch (e) {
              const ms = Date.now() - start;
              appLogger.error(
                { db: { model, action: operation, ms }, err: e },
                'db_error',
              );
              throw e;
            }
          },
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
