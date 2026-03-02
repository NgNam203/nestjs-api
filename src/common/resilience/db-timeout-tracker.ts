import { runtimeState } from './runtime-state';

let recent: number[] = []; // timestamps (ms)
let shedUntil = 0;

export function recordDbTimeout(now = Date.now()) {
  runtimeState.lastDbTimeoutAt = now;
  recent.push(now);

  // keep last 10s
  const cutoff = now - 10_000;
  recent = recent.filter((t) => t >= cutoff);

  // rule: >= 5 timeouts in 10s => shed list for 15s
  if (recent.length >= 5) {
    shedUntil = now + 15_000;
    runtimeState.shedOrdersList = true;
  }
}

export function tickShed(now = Date.now()) {
  if (runtimeState.shedOrdersList && now >= shedUntil) {
    runtimeState.shedOrdersList = false;
    recent = [];
  }
}
