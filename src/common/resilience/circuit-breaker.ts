type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private failureCount = 0;
  private openedAt = 0;

  constructor(
    private readonly failureThreshold: number, // e.g. 5
    private readonly openDurationMs: number, // e.g. 30_000
    private readonly halfOpenMaxCalls: number = 1,
  ) {}

  private halfOpenCalls = 0;

  canRequest(): boolean {
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.openedAt >= this.openDurationMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenCalls = 0;
        return true;
      }
      return false;
    }

    // HALF_OPEN
    if (this.halfOpenCalls < this.halfOpenMaxCalls) {
      this.halfOpenCalls++;
      return true;
    }
    return false;
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failureCount++;
    if (this.state === 'HALF_OPEN') {
      this.trip();
      return;
    }
    if (this.failureCount >= this.failureThreshold) {
      this.trip();
    }
  }

  private trip() {
    this.state = 'OPEN';
    this.openedAt = Date.now();
  }

  getState() {
    return this.state;
  }
}
