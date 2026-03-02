import { runtimeState } from './runtime-state';

export const ShedConfig = {
  get shedOrdersList() {
    return process.env.SHED_ORDERS_LIST === '1' || runtimeState.shedOrdersList;
  },
};
