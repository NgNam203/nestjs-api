import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  APP_ENV: Joi.string().valid('dev', 'test', 'prod').required(),

  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().required(), // dùng cho Prisma

  REDIS_URL: Joi.when('APP_ENV', {
    is: 'prod',
    then: Joi.string().required(), // prod bắt buộc có redis thật
    otherwise: Joi.string().default('redis://localhost:6379'),
  }),

  JWT_ACCESS_SECRET: Joi.when('APP_ENV', {
    is: 'prod',
    then: Joi.string().min(16).required(),
    otherwise: Joi.string().default('dev-access-secret-change-me'),
  }),

  JWT_ACCESS_TTL: Joi.string().default('15m'),
});
