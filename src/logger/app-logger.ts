import { logger as base } from './logger';
import { getRequestId } from './request-context';

export const appLogger = {
  debug(obj: object, msg?: string) {
    base.debug({ requestId: getRequestId(), ...obj }, msg);
  },
  info(obj: object, msg?: string) {
    base.info({ requestId: getRequestId(), ...obj }, msg);
  },
  warn(obj: object, msg?: string) {
    base.warn({ requestId: getRequestId(), ...obj }, msg);
  },
  error(obj: object, msg?: string) {
    base.error({ requestId: getRequestId(), ...obj }, msg);
  },
};
