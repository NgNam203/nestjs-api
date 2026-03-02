/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CircuitBreaker } from '../common/resilience/circuit-breaker';
import { ResilienceConfig } from '../common/resilience/resilience.config';
import { withRetry } from '../common/resilience/retry.util';
import { TimeoutError, withTimeout } from '../common/resilience/timeout.util';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
@Injectable()
export class ExternalMockClient {
  private readonly logger = new Logger(ExternalMockClient.name);
  private breaker = new CircuitBreaker(
    ResilienceConfig.external.breaker.failureThreshold,
    ResilienceConfig.external.breaker.openDurationMs,
    ResilienceConfig.external.breaker.halfOpenMaxCalls,
  );

  async checkInventory(productIds: string[]) {
    if (!this.breaker.canRequest()) {
      throw new ServiceUnavailableException({
        errorCode: 'EXTERNAL_UNAVAILABLE',
        message: 'Service temporarily unavailable',
      });
    }

    try {
      const result = await withRetry(
        () =>
          withTimeout(
            this.doCall(productIds),
            ResilienceConfig.external.timeoutMs,
            'external_timeout',
          ),
        {
          ...ResilienceConfig.external.retry,
          retryOn: (err) => {
            if (err instanceof TimeoutError) return true;
            const code = err?.code;
            const status = err?.response?.status;
            return (
              code === 'ECONNRESET' ||
              status === 502 ||
              status === 503 ||
              status === 504
            );
          },
        },
      );

      this.breaker.onSuccess();
      return result;
    } catch (e: any) {
      this.breaker.onFailure();
      this.logger.warn(
        `external_call_failed mode=${process.env.EXTERNAL_MODE ?? 'ok'} breaker=${this.breaker.getState()} err=${e?.name ?? 'unknown'} code=${e?.code ?? 'none'}`,
      );
      throw new ServiceUnavailableException({
        errorCode: 'EXTERNAL_UNAVAILABLE',
        message: 'Service temporarily unavailable',
      });
    }
  }

  private async doCall(productIds: string[]) {
    const mode = process.env.EXTERNAL_MODE ?? 'ok';

    if (mode === 'slow') {
      await new Promise((r) => setTimeout(r, 1500));
      return { ok: true };
    }

    if (mode === 'down') {
      const err: any = new Error('down');
      err.code = 'ECONNRESET';
      throw err;
    }

    if (mode === 'flaky') {
      if (Math.random() < 0.5) {
        const err: any = new Error('flaky');
        err.code = 'ECONNRESET';
        throw err;
      }
    }

    return { ok: true };
  }
}
