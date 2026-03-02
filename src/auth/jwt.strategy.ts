import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AccessTokenPayload } from './types/jwt-payload';

export type RequestUser = { userId: string; role: 'USER' | 'ADMIN' };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: AccessTokenPayload): RequestUser {
    if (!payload?.sub) {
      throw new UnauthorizedException({
        errorCode: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    }
    return { userId: payload.sub, role: payload.role };
  }
}
