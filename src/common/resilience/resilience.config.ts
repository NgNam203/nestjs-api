export const ResilienceConfig = {
  db: {
    timeoutMs: 1500,
  },
  external: {
    timeoutMs: 800,
    retry: {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 500,
      budgetMs: 1000,
    },
    breaker: {
      failureThreshold: 5,
      openDurationMs: 30_000,
      halfOpenMaxCalls: 1,
    },
  },
};
