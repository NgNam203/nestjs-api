// src/logger/app-logger.service.ts
import { Injectable, LoggerService } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import { logger as baseLogger } from './logger';

function toMsg(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

function toData(message: unknown): Record<string, unknown> | undefined {
  if (message instanceof Error) {
    return { err: message }; // pino hiểu err và in stack
  }
  if (message && typeof message === 'object') {
    return { data: message as Record<string, unknown> };
  }
  return undefined;
}

@Injectable()
export class AppLogger implements LoggerService {
  private readonly l: PinoLogger = baseLogger;

  log(message: unknown, context?: string) {
    const data = toData(message);
    const msg = toMsg(message);
    this.l.info({ context, ...data }, msg);
  }

  error(message: unknown, trace?: string, context?: string) {
    const data = toData(message);
    const msg = toMsg(message);
    this.l.error({ context, trace, ...data }, msg);
  }

  warn(message: unknown, context?: string) {
    const data = toData(message);
    const msg = toMsg(message);
    this.l.warn({ context, ...data }, msg);
  }

  debug(message: unknown, context?: string) {
    const data = toData(message);
    const msg = toMsg(message);
    this.l.debug({ context, ...data }, msg);
  }

  verbose(message: unknown, context?: string) {
    const data = toData(message);
    const msg = toMsg(message);
    this.l.debug({ context, verbose: true, ...data }, msg);
  }
}
