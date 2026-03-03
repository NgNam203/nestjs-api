import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation';
import { RequestIdMiddleware } from './middlewares/request-id.middleware';
import { UsersController } from './users/users.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AdminController } from './admin/admin.controller';
import { RolesGuard } from './auth/roles.guard';
import { OrdersModule } from './orders/orders.module';
import { IncidentController } from './common/resilience/incident.controller';
import { AppLogger } from './logger/app-logger.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.APP_ENV === 'prod',
      envFilePath: `.env.${process.env.APP_ENV ?? 'dev'}`,
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    AuthModule,
    OrdersModule,
  ],
  controllers: [
    AppController,
    AdminController,
    UsersController,
    IncidentController,
  ],
  providers: [RolesGuard, AppService, AppLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
