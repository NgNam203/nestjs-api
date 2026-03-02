/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from '../common/utils/normalize-email';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { hashToken } from './token-hash';
import type { RefreshPayload } from './auth.types';
import ms, { StringValue } from 'ms';
import { maskEmail } from '../common/utils/mask';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds = 12;
  // Dummy hash để vẫn chạy bcrypt.compare khi user không tồn tại (anti-timing).
  // Tạo 1 lần bằng bcrypt.hash("dummy", 12) rồi hardcode.
  private readonly dummyHash =
    '$2b$12$C6UzMDM.H6dfI/f/IKcEeO9r7uUQn.0w3V7q4eWk0Gd0x1k7m0b1e';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  private signAccessToken(payload: { sub: string; role: 'USER' | 'ADMIN' }) {
    // Access dùng secret + ttl từ env
    const secret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    const ttl = this.config.getOrThrow<StringValue>('JWT_ACCESS_TTL'); // ex: 15m, 10s
    return this.jwt.signAsync(payload, { secret, expiresIn: ttl });
  }

  private signRefreshToken(payload: {
    sub: string;
    sid: string;
    type: 'refresh';
    jti: string;
  }) {
    const secret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    const ttl = this.config.getOrThrow<StringValue>('JWT_REFRESH_TTL'); // ex: 7d
    return this.jwt.signAsync(payload, { secret, expiresIn: ttl });
  }

  async refresh(refreshToken: string) {
    let payload: RefreshPayload;

    try {
      const secret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret,
      });
    } catch {
      this.logger.warn(`SECURITY refresh_rejected reason=jwt_verify_failed`);

      throw new UnauthorizedException({
        errorCode: 'REFRESH_TOKEN_INVALID',
        message: 'Unauthorized',
      });
    }

    if (payload.type !== 'refresh' || !payload.sid || !payload.sub) {
      throw new UnauthorizedException({
        errorCode: 'REFRESH_TOKEN_INVALID',
        message: 'Unauthorized',
      });
    }

    const userId = payload.sub;
    const sid = payload.sid;

    const redis = this.redisService.getClient();
    let sessionRaw: string | null;
    try {
      sessionRaw = await redis.get(`refresh:${sid}`);
    } catch (e) {
      this.logger.warn(
        `SECURITY refresh_rejected userId=${userId} sid=${sid} reason=redis_down`,
      );
      throw new UnauthorizedException({
        errorCode: 'REFRESH_TOKEN_INVALID',
        message: 'Unauthorized',
      });
    }
    if (!sessionRaw) {
      this.logger.warn(
        `SECURITY refresh_rejected userId=${userId} sid=${sid} reason=session_missing`,
      );
      throw new UnauthorizedException({
        errorCode: 'REFRESH_TOKEN_INVALID',
        message: 'Unauthorized',
      });
    }

    const session = JSON.parse(sessionRaw) as {
      userId: string;
      tokenHash: string;
    };
    const incomingHash = hashToken(refreshToken);

    if (session.userId !== userId) {
      throw new UnauthorizedException({
        errorCode: 'REFRESH_TOKEN_INVALID',
        message: 'Unauthorized',
      });
    }

    if (session.tokenHash !== incomingHash) {
      // reuse detected => revoke all sessions
      await this.revokeAllSessions(userId);
      this.logger.error(
        `SECURITY refresh_reuse_detected userId=${userId} sid=${sid} action=revoke_all`,
      );

      throw new UnauthorizedException({
        errorCode: 'REFRESH_TOKEN_INVALID',
        message: 'Unauthorized',
      });
    }

    // check user status from DB (enforce disabled immediately)
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    });

    if (!dbUser || dbUser.status === 'DISABLED') {
      await this.revokeAllSessions(userId);
      throw new UnauthorizedException({
        errorCode: 'REFRESH_TOKEN_INVALID',
        message: 'Unauthorized',
      });
    }

    // Rotation: issue new refresh token, keep same sid
    const newRefreshToken = await this.signRefreshToken({
      sub: userId,
      sid,
      type: 'refresh',
      jti: randomUUID(),
    });
    const newHash = hashToken(newRefreshToken);

    // keep remaining TTL
    let ttl: number;
    try {
      ttl = await redis.ttl(`refresh:${sid}`);
    } catch (e) {
      this.logger.warn(
        `SECURITY refresh_rejected userId=${userId} sid=${sid} reason=redis_down_ttl`,
      );
      throw new UnauthorizedException({
        errorCode: 'REFRESH_TOKEN_INVALID',
        message: 'Unauthorized',
      });
    }
    if (ttl <= 0) {
      throw new UnauthorizedException({
        errorCode: 'REFRESH_TOKEN_INVALID',
        message: 'Unauthorized',
      });
    }

    try {
      await redis.set(
        `refresh:${sid}`,
        JSON.stringify({ userId, tokenHash: newHash }),
        'EX',
        ttl,
      );
    } catch (e) {
      this.logger.warn(
        `SECURITY refresh_rejected userId=${userId} sid=${sid} reason=redis_down_set`,
      );
      throw new UnauthorizedException({
        errorCode: 'REFRESH_TOKEN_INVALID',
        message: 'Unauthorized',
      });
    }

    const newAccessToken = await this.signAccessToken({
      sub: userId,
      role: dbUser.role,
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  private async revokeAllSessions(userId: string) {
    const redis = this.redisService.getClient();
    const sids = await redis.smembers(`user_sessions:${userId}`);

    if (sids.length > 0) {
      await redis.del(...sids.map((sid) => `refresh:${sid}`));
    }

    await redis.del(`user_sessions:${userId}`);
  }

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException({
        errorCode: 'EMAIL_ALREADY_EXISTS',
        message: 'Email already in use',
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    return user;
  }

  async login(dto: LoginDto) {
    const email = normalizeEmail(dto.email);

    const user = await this.prisma.user.findUnique({ where: { email } });

    const hashToCompare = user?.passwordHash ?? this.dummyHash;
    const passwordOk = await bcrypt.compare(dto.password, hashToCompare);

    // Không phân biệt: user không tồn tại vs sai password vs disabled
    if (!user || !passwordOk || user.status === 'DISABLED') {
      this.logger.warn(`SECURITY login_fail email=${maskEmail(email)} `);
      throw new UnauthorizedException({
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }
    const sid = randomUUID();

    const accessToken = await this.signAccessToken({
      sub: user.id,
      role: user.role,
    });

    let refreshToken: string | null = null;
    try {
      refreshToken = await this.signRefreshToken({
        sub: user.id,
        sid,
        type: 'refresh',
        jti: randomUUID(),
      });

      const redis = this.redisService.getClient();
      const rtHash = hashToken(refreshToken);

      const refreshTtl =
        this.config.get<StringValue>('JWT_REFRESH_TTL') ?? '7d';
      const ttlMs = ms(refreshTtl);
      if (!ttlMs || ttlMs <= 0) {
        throw new Error('Invalid JWT_REFRESH_TTL');
      }
      const ttlSeconds = Math.floor(ttlMs / 1000);

      await redis.set(
        `refresh:${sid}`,
        JSON.stringify({ userId: user.id, tokenHash: rtHash }),
        'EX',
        ttlSeconds,
      );

      await redis.sadd(`user_sessions:${user.id}`, sid);
    } catch (err) {
      // degrade: không có refresh session
      this.logger.warn(
        `SECURITY login_degraded reason=redis_error userId=${user.id}`,
      );
      refreshToken = null;
    }

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async logout(refreshToken: string) {
    let payload: RefreshPayload;

    try {
      const secret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret,
      });
    } catch {
      // logout fail cũng coi như ok (không leak)
      return { ok: true };
    }

    if (payload.type !== 'refresh' || !payload.sid || !payload.sub)
      return { ok: true };

    const redis = this.redisService.getClient();
    await redis.del(`refresh:${payload.sid}`);
    await redis.srem(`user_sessions:${payload.sub}`, payload.sid);

    return { ok: true };
  }

  async logoutAll(userId: string) {
    await this.revokeAllSessions(userId);
    return { ok: true };
  }
}
