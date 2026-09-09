import { ForbiddenException } from '@nestjs/common';
import { IncidentController } from './incident.controller';
import { runtimeState } from './runtime-state';

describe('IncidentController authorization', () => {
  const originalSecret = process.env.INCIDENT_SECRET;
  const originalState = { ...runtimeState };
  const controller = new IncidentController();

  beforeEach(() => {
    runtimeState.disableOrdersList = false;
    runtimeState.disableHeavyFilters = false;
    runtimeState.shedOrdersList = false;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.INCIDENT_SECRET;
    else process.env.INCIDENT_SECRET = originalSecret;
    Object.assign(runtimeState, originalState);
  });

  it.each([
    [undefined, undefined],
    [undefined, 'supplied-secret'],
    ['', ''],
    ['configured-secret', undefined],
    ['configured-secret', ''],
    ['configured-secret', 'wrong-secret'],
  ])(
    'rejects config %p and header %p without changing state',
    (secret, header) => {
      if (secret === undefined) delete process.env.INCIDENT_SECRET;
      else process.env.INCIDENT_SECRET = secret;
      const before = { ...runtimeState };
      const actions = [
        () =>
          controller.setDegrade(header, {
            disableOrdersList: true,
            disableHeavyFilters: true,
          }),
        () => controller.setShed(header, { shedOrdersList: true }),
      ];
      for (const action of actions) {
        expect(action).toThrow(ForbiddenException);
        try {
          action();
        } catch (error) {
          expect((error as ForbiddenException).getStatus()).toBe(403);
        }
        expect(runtimeState).toEqual(before);
      }
    },
  );

  it('updates both endpoints with the correct secret', () => {
    process.env.INCIDENT_SECRET = 'configured-secret';
    expect(
      controller.setDegrade('configured-secret', {
        disableOrdersList: true,
        disableHeavyFilters: true,
      }),
    ).toEqual({ ok: true, state: runtimeState });
    expect(
      controller.setShed('configured-secret', {
        shedOrdersList: true,
      }),
    ).toEqual({ ok: true, state: runtimeState });
    expect(runtimeState).toMatchObject({
      disableOrdersList: true,
      disableHeavyFilters: true,
      shedOrdersList: true,
    });
  });
});
