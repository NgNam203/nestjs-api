/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DegradeConfig } from '../common/resilience/degrade.config';
import { ShedConfig } from '../common/resilience/shed.config';

@Injectable()
export class OrdersAvailabilityGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    if (DegradeConfig.disableOrdersList) {
      throw new ServiceUnavailableException({
        errorCode: 'DEGRADED',
        message: 'Service temporarily unavailable',
      });
    }

    if (ShedConfig.shedOrdersList) {
      throw new ServiceUnavailableException({
        errorCode: 'LOAD_SHED',
        message: 'Service temporarily unavailable',
      });
    }

    return true;
  }
}
