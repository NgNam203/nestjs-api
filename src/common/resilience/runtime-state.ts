export type RuntimeState = {
  shedOrdersList: boolean;
  disableOrdersList: boolean;
  disableHeavyFilters: boolean;
  lastRedisErrorAt?: number;
  lastDbTimeoutAt?: number;
};

export const runtimeState: RuntimeState = {
  shedOrdersList: false,
  disableOrdersList: false,
  disableHeavyFilters: false,
};
