/* eslint-disable @typescript-eslint/no-unsafe-assignment */
type RetryOptions = {
  maxAttempts: number; // total attempts (1 + retries)
  baseDelayMs: number; // initial backoff
  maxDelayMs: number;
  budgetMs: number; // retry budget per request
  retryOn: (err: any) => boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms: number, pct = 0.3) {
  const delta = ms * pct;
  return Math.floor(ms - delta + Math.random() * (2 * delta));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const start = Date.now();
  let attempt = 0;
  let lastErr: any;

  while (attempt < opts.maxAttempts) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const elapsed = Date.now() - start;
      const remainingBudget = opts.budgetMs - elapsed;

      if (!opts.retryOn(err)) throw err;
      if (attempt >= opts.maxAttempts) throw err;
      if (remainingBudget <= 0) throw err;

      const backoff = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1),
        opts.maxDelayMs,
      );
      const delay = Math.min(jitter(backoff), remainingBudget);
      await sleep(delay);
    }
  }
  throw lastErr;
}
