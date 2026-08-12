import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, resetDatabase, testUser } from './test-utils';

describe('Auth flow (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('GET /api/health returns the envelope with status ok', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      message: 'OK',
      data: { status: 'ok' },
    });
  });

  it('full flow: register → me → refresh (rotation) → logout', async () => {
    // 1. register → 201 + user + token pair
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    expect(registerRes.body.success).toBe(true);
    expect(registerRes.body.data.user).toMatchObject({
      email: testUser.email,
      name: testUser.name,
      authProvider: 'email',
      tier: 'free',
    });
    expect(registerRes.body.data.user).not.toHaveProperty('passwordHash');
    expect(registerRes.body.data.accessToken).toEqual(expect.any(String));
    expect(registerRes.body.data.refreshToken).toMatch(/^[0-9a-f]{64}$/);

    const { accessToken, refreshToken } = registerRes.body.data;

    // 2. GET /me with access token → 200, email matches, createdAt present
    const meRes = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meRes.body.success).toBe(true);
    expect(meRes.body.data.email).toBe(testUser.email);
    expect(meRes.body.data.createdAt).toEqual(expect.any(String));
    expect(meRes.body.data).not.toHaveProperty('passwordHash');

    // 3. refresh → 200 new pair; OLD refresh token must now be dead (rotation)
    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.data.accessToken).toEqual(expect.any(String));
    expect(refreshRes.body.data.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect(refreshRes.body.data).not.toHaveProperty('user');

    const newRefreshToken = refreshRes.body.data.refreshToken;
    expect(newRefreshToken).not.toBe(refreshToken);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect((res) => {
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('INVALID_REFRESH_TOKEN');
      });

    // 4. logout → 200; the new refresh token dies too
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: newRefreshToken })
      .expect((res) => {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          success: true,
          message: 'OK',
          data: null,
        });
      });

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: newRefreshToken })
      .expect((res) => {
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('INVALID_REFRESH_TOKEN');
      });

    // logout is idempotent — second call still 200
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: newRefreshToken })
      .expect(200);
  });

  it('login with correct credentials → 200 with token pair', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(testUser.email);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('login with wrong password → 401 INVALID_CREDENTIALS', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testUser.email, password: 'password-salah' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
    expect(res.body.message).toBe('Email atau password salah');
    expect(res.body.data).toBeNull();
  });

  it('GET /me without token → 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('UNAUTHORIZED');
    expect(res.body.message).toBe('Silakan masuk terlebih dahulu');
  });

  it('refresh with unknown token → 401 INVALID_REFRESH_TOKEN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'f'.repeat(64) })
      .expect(401);

    expect(res.body.error).toBe('INVALID_REFRESH_TOKEN');
  });
});
