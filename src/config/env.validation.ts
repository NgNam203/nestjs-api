/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  APP_ENV: Joi.string().valid('dev', 'test', 'prod').required(),

  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().required(), // dùng cho Prisma

  JWT_ACCESS_SECRET: Joi.when('APP_ENV', {
    is: 'prod',
    then: Joi.string().min(16).required(),
    otherwise: Joi.string().default('dev-access-secret-change-me'),
  }),

  JWT_ACCESS_TTL: Joi.string().default('15m'),
});
