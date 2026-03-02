/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';

describe('JWT unit', () => {
  let jwt: JwtService;

  const ACCESS_SECRET = 'unit-access-secret';
  const REFRESH_SECRET = 'unit-refresh-secret';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: ACCESS_SECRET,
        }),
      ],
    }).compile();

    jwt = mod.get(JwtService);
  });

  it('should sign & verify access token payload', async () => {
    const token = await jwt.signAsync(
      { sub: 'u1', role: 'USER' },
      { secret: ACCESS_SECRET, expiresIn: '10s' },
    );

    const payload = await jwt.verifyAsync<{ sub: string; role: string }>(
      token,
      {
        secret: ACCESS_SECRET,
      },
    );

    expect(payload.sub).toBe('u1');
    expect(payload.role).toBe('USER');
  });

  it('should fail verify when secret is wrong', async () => {
    const token = await jwt.signAsync(
      { sub: 'u1', role: 'USER' },
      { secret: ACCESS_SECRET, expiresIn: '10s' },
    );

    await expect(
      jwt.verifyAsync(token, { secret: REFRESH_SECRET }),
    ).rejects.toBeTruthy();
  });

  it('should expire token', async () => {
    const token = await jwt.signAsync(
      { sub: 'u1', role: 'USER' },
      { secret: ACCESS_SECRET, expiresIn: '1s' },
    );

    // đợi > 1s
    await new Promise((r) => setTimeout(r, 1100));

    await expect(
      jwt.verifyAsync(token, { secret: ACCESS_SECRET }),
    ).rejects.toBeTruthy();
  });

  it('should sign & verify refresh payload shape', async () => {
    const token = await jwt.signAsync(
      { sub: 'u1', sid: 's1', type: 'refresh' },
      { secret: REFRESH_SECRET, expiresIn: '10s' },
    );

    const payload = await jwt.verifyAsync<any>(token, {
      secret: REFRESH_SECRET,
    });
    expect(payload.sub).toBe('u1');
    expect(payload.sid).toBe('s1');
    expect(payload.type).toBe('refresh');
  });
});
