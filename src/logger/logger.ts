import pino from 'pino';

const isProd = process.env.LOG_ENV === 'prod' || process.env.APP_ENV === 'prod';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),

  // Dev: pretty cho dễ đọc. Prod: JSON raw để ingest.
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          singleLine: true,
        },
      },

  // Base context (khỏi phải set lại mỗi log)
  base: {
    service: process.env.SERVICE_NAME || 'nestjs-api',
    env: process.env.APP_ENV || 'dev',
  },

  // Redact dữ liệu nhạy cảm
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.set-cookie',
      'req.body.password',
      'req.body.refreshToken',
      'req.body.accessToken',
      'req.body.token',
    ],
    remove: true,
  },
});
