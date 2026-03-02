import { runtimeState } from './runtime-state';

export const DegradeConfig = {
  get disableOrdersList() {
    return (
      process.env.DEGRADE_DISABLE_ORDERS_LIST === '1' ||
      runtimeState.disableOrdersList
    );
  },
  get disableHeavyFilters() {
    return (
      process.env.DEGRADE_DISABLE_HEAVY_FILTERS === '1' ||
      runtimeState.disableHeavyFilters
    );
  },
};
