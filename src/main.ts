/* eslint-disable @typescript-eslint/no-floating-promises */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LatencyInterceptor } from './interceptors/latency.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppLogger } from './logger/app-logger.service';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const isProd = process.env.APP_ENV === 'prod';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true, // quan trọng: để log lúc bootstrap không bị mất
  });

  app.useLogger(app.get(AppLogger));

  // Đừng spam console ở prod
  if (!isProd) {
    app.get(AppLogger).debug({ DB_MODE: process.env.DB_MODE }, 'Bootstrap env');
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

  const config = new DocumentBuilder()
    .setTitle('NestJS API')
    .setDescription('Backend API documentation')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port);
  app
    .get(AppLogger)
    .log(`listening on port ${port} env=${process.env.APP_ENV}`, 'Bootstrap');
}

bootstrap();
