export const RateLimitPolicies = {
  loginIp: { limit: 10, windowSec: 60, policy: 'fail-close' as const },
  loginEmail: { limit: 5, windowSec: 60, policy: 'fail-close' as const }, // optional
  createOrder: { limit: 30, windowSec: 60, policy: 'fail-open' as const },
};
