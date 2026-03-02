import {
  Controller,
  Post,
  Body,
  Headers,
  ForbiddenException,
} from '@nestjs/common';
import { runtimeState } from './runtime-state';

@Controller('_incident')
export class IncidentController {
  private auth(secret?: string) {
    const expected = process.env.INCIDENT_SECRET;
    if (!expected) return; // allow if not set (dev only)
    if (secret !== expected)
      throw new ForbiddenException({ errorCode: 'FORBIDDEN' });
  }

  @Post('degrade')
  setDegrade(
    @Headers('x-incident-secret') secret: string | undefined,
    @Body()
    body: { disableOrdersList?: boolean; disableHeavyFilters?: boolean },
  ) {
    this.auth(secret);
    if (typeof body.disableOrdersList === 'boolean') {
      runtimeState.disableOrdersList = body.disableOrdersList;
    }
    if (typeof body.disableHeavyFilters === 'boolean') {
      runtimeState.disableHeavyFilters = body.disableHeavyFilters;
    }
    return { ok: true, state: runtimeState };
  }

  @Post('shed')
  setShed(
    @Headers('x-incident-secret') secret: string | undefined,
    @Body() body: { shedOrdersList?: boolean },
  ) {
    this.auth(secret);
    if (typeof body.shedOrdersList === 'boolean') {
      runtimeState.shedOrdersList = body.shedOrdersList;
    }
    return { ok: true, state: runtimeState };
  }
}
