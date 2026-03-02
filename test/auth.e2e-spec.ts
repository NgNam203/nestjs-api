/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import * as bcrypt from 'bcrypt';
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redisService: RedisService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableShutdownHooks();
    await app.init();

    prisma = app.get(PrismaService);
    redisService = app.get(RedisService);
    await redisService.waitReady();
  });

  beforeEach(async () => {
    // reset state trước mỗi test
    await prisma.user.deleteMany({});
    await redisService.getClient().flushdb();
  });

  async function seedUser(
    prisma: PrismaService,
    email: string,
    passwordHash: string,
    role: 'USER' | 'ADMIN' = 'USER',
  ) {
    return prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
        status: 'ACTIVE',
      },
      select: { id: true, email: true, role: true, status: true },
    });
  }

  async function login(app: INestApplication, email: string, password: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    return res.body as {
      accessToken: string;
      refreshToken: string | null;
      user: any;
    };
  }

  afterAll(async () => {
    // teardown đúng cách để Jest thoát sạch
    await app.close();
    redisService.getClient().disconnect();
    await prisma.$disconnect();
  });

  it('login -> call protected endpoint (/auth/logout-all) should work with access token', async () => {
    const email = 'u1@test.com';
    const password = 'P@ssw0rd!';

    // seed user (vì register cũng được, nhưng seed nhanh hơn + ổn định)
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, role: 'USER', status: 'ACTIVE' },
      select: { id: true },
    });

    // no token -> 401
    await request(app.getHttpServer()).post('/auth/logout-all').expect(401);

    const { accessToken } = await login(app, email, password);

    // with token -> 200
    await request(app.getHttpServer())
      .post('/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201); // POST default 201 nếu controller không @HttpCode
  });

  it('login -> access /profile should return 401 without token and 200 with token', async () => {
    const email = 'u2@test.com';
    const password = 'P@ssw0rd!';

    const passwordHash = await bcrypt.hash(password, 12);
    await seedUser(prisma, email, passwordHash);

    // không token -> 401
    await request(app.getHttpServer()).get('/profile').expect(401);

    const { accessToken } = await login(app, email, password);

    // có token -> 200 + đúng data
    const res = await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.email).toBe(email);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('login -> access /me should return token payload', async () => {
    const email = 'u3@test.com';
    const password = 'P@ssw0rd!';

    const passwordHash = await bcrypt.hash(password, 12);
    await seedUser(prisma, email, passwordHash);

    const { accessToken } = await login(app, email, password);

    const res = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.userId).toBeDefined();
    expect(res.body.role).toBe('USER');
  });

  it('access token expired -> refresh -> access protected endpoint OK', async () => {
    const email = 'u4@test.com';
    const password = 'P@ssw0rd!';

    const passwordHash = await bcrypt.hash(password, 12);
    await seedUser(prisma, email, passwordHash);

    const { accessToken, refreshToken } = await login(app, email, password);
    expect(refreshToken).toBeTruthy();

    // access ban đầu OK
    await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    // đợi access token hết hạn (TTL=1s)
    await new Promise((r) => setTimeout(r, 1100));

    // access token cũ -> 401
    await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    // refresh lấy token mới
    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    const newAccessToken = refreshRes.body.accessToken;
    expect(newAccessToken).toBeTruthy();

    // access lại với token mới -> 200
    await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(200);
  });

  it('logout -> refresh token should fail', async () => {
    const email = 'u5@test.com';
    const password = 'P@ssw0rd!';

    const passwordHash = await bcrypt.hash(password, 12);
    await seedUser(prisma, email, passwordHash);

    const { refreshToken } = await login(app, email, password);
    expect(refreshToken).toBeTruthy();

    // logout session hiện tại
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken })
      .expect(200);

    // dùng lại refresh token -> fail
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('refresh token reuse should revoke all sessions', async () => {
    const email = 'u6@test.com';
    const password = 'P@ssw0rd!';

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await seedUser(prisma, email, passwordHash);

    // login lần 1 -> session A
    const login1 = await login(app, email, password);
    const refreshTokenA = login1.refreshToken!;
    expect(refreshTokenA).toBeTruthy();

    // refresh lần 1 -> rotation -> session A có token mới
    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshTokenA })
      .expect(200);

    const refreshTokenANew = refreshRes.body.refreshToken;
    expect(refreshTokenANew).not.toBe(refreshTokenA);

    // dùng lại refresh token cũ -> reuse detected
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshTokenA })
      .expect(401);

    // lúc này toàn bộ session của user phải bị revoke
    // => refresh token mới cũng phải chết
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshTokenANew })
      .expect(401);

    // login lại phải tạo session mới hoàn toàn
    const login2 = await login(app, email, password);
    expect(login2.refreshToken).toBeTruthy();
  });

  it('admin endpoint without token -> 401', async () => {
    await request(app.getHttpServer()).get('/admin/ping').expect(401);
  });

  it('admin endpoint with USER role -> 403', async () => {
    const email = 'user-role@test.com';
    const password = 'P@ssw0rd!';
    const passwordHash = await bcrypt.hash(password, 12);

    await seedUser(prisma, email, passwordHash, 'USER');

    const { accessToken } = await login(app, email, password);

    await request(app.getHttpServer())
      .get('/admin/ping')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('admin endpoint with ADMIN role -> 200', async () => {
    const email = 'admin-role@test.com';
    const password = 'P@ssw0rd!';
    const passwordHash = await bcrypt.hash(password, 12);

    await seedUser(prisma, email, passwordHash, 'ADMIN');

    const { accessToken } = await login(app, email, password);

    const res = await request(app.getHttpServer())
      .get('/admin/ping')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.scope).toBe('admin');
  });

  it('login rate limit by email -> should return 429 after threshold', async () => {
    const email = 'ratelimit@test.com';

    // spam login fail (user không tồn tại cũng được, guard chạy trước)
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong' })
        .expect(401);
    }

    // lần tiếp theo vượt ngưỡng -> 429
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong' })
      .expect(429);
  });

  it('disabled user should be blocked on /profile even if access token still valid', async () => {
    const email = 'disabled1@test.com';
    const password = 'P@ssw0rd!';
    const passwordHash = await bcrypt.hash(password, 12);

    const u = await seedUser(prisma, email, passwordHash, 'USER');

    const { accessToken } = await login(app, email, password);

    // token còn hạn -> profile OK
    await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    // disable user trong DB
    await prisma.user.update({
      where: { id: u.id },
      data: { status: 'DISABLED' },
    });

    // gọi lại profile với access token cũ -> 401 (do DB check)
    await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('disabled user refresh should fail and revoke sessions', async () => {
    const email = 'disabled2@test.com';
    const password = 'P@ssw0rd!';
    const passwordHash = await bcrypt.hash(password, 12);

    const u = await seedUser(prisma, email, passwordHash, 'USER');

    const { refreshToken } = await login(app, email, password);
    expect(refreshToken).toBeTruthy();

    // disable user
    await prisma.user.update({
      where: { id: u.id },
      data: { status: 'DISABLED' },
    });

    // refresh phải fail
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    // chứng minh sessions bị revoke: login lại -> refresh token mới,
    // nhưng token cũ chắc chắn không còn trong redis (đã fail rồi).
    // (Optionally: check redis set rỗng)
    const sids = await redisService
      .getClient()
      .smembers(`user_sessions:${u.id}`);
    expect(sids.length).toBe(0);
  });
});
