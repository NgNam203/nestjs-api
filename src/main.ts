/* eslint-disable @typescript-eslint/no-floating-promises */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LatencyInterceptor } from './interceptors/latency.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const isProd = process.env.APP_ENV === 'prod';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Prod: giảm ồn. Dev: log thoải mái để debug.
    logger: isProd
      ? ['log', 'warn', 'error']
      : ['debug', 'log', 'warn', 'error', 'verbose'],
  });

  // Đừng spam console ở prod
  if (!isProd) {
    console.log('DB_MODE =', process.env.DB_MODE);
  }

  app.set('trust proxy', 1);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalInterceptors(new LatencyInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(port);
  const logger = new Logger('Bootstrap');
  // Optional: log 1 dòng confirm (prod vẫn ok)
  logger.log(`listening on port ${port} env=${process.env.APP_ENV}`);
}

bootstrap();
