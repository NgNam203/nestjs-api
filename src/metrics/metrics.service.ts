import { Injectable } from '@nestjs/common';

type RouteKey = string;

@Injectable()
export class MetricsService {
  private totalRequests = 0;
  private totalErrors = 0;

  private byRoute: Record<RouteKey, { count: number; errors: number }> = {};

  private latenciesMs: number[] = [];

  recordRequest(route: string, statusCode: number, latencyMs: number) {
    this.totalRequests++;

    if (statusCode >= 500) {
      this.totalErrors++;
    }

    const key = route || 'unknown';

    if (!this.byRoute[key]) {
      this.byRoute[key] = { count: 0, errors: 0 };
    }

    this.byRoute[key].count++;

    if (statusCode >= 500) {
      this.byRoute[key].errors++;
    }

    this.latenciesMs.push(latencyMs);

    // tránh memory leak
    if (this.latenciesMs.length > 5000) {
      this.latenciesMs.shift();
    }
  }

  getSnapshot() {
    const sorted = [...this.latenciesMs].sort((a, b) => a - b);

    const p = (q: number) => percentile(sorted, q);

    return {
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,

      errorRate:
        this.totalRequests === 0 ? 0 : this.totalErrors / this.totalRequests,

      latency: {
        p50: p(0.5),
        p95: p(0.95),
        p99: p(0.99),
        samples: sorted.length,
      },

      byRoute: this.byRoute,

      timestamp: new Date().toISOString(),
    };
  }
}

function percentile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;

  const idx = Math.floor(q * (sorted.length - 1));

  return sorted[idx];
}
