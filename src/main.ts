/* eslint-disable @typescript-eslint/no-floating-promises */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LatencyInterceptor } from './interceptors/latency.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  console.log('DB_MODE =', process.env.DB_MODE);
  app.set('trust proxy', 1);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // vứt field dư
      forbidNonWhitelisted: true, // field dư -> 400 luôn
      transform: true, // auto transform DTO types
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalInterceptors(new LatencyInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(port);
}
bootstrap();
