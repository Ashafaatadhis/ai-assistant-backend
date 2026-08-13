import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestAppWithMail,
  MailSpy,
  registerAndVerify,
  resetDatabase,
  testUser,
} from './test-utils';

describe('Token lifecycle after email verification (e2e)', () => {
  let app: INestApplication;
  let mail: MailSpy;

  beforeAll(async () => {
    ({ app, mail } = await createTestAppWithMail());
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  beforeEach(async () => {
    await resetDatabase(app);
    mail.sent.length = 0;
  });

  it('full flow: login → me → refresh (rotation) → logout (idempotent)', async () => {
    await registerAndVerify(app, mail);

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);
    const { accessToken, refreshToken } = loginRes.body.data;

    const meRes = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(meRes.body.data.email).toBe(testUser.email);
    expect(meRes.body.data).not.toHaveProperty('passwordHash');

    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(refreshRes.body.data.accessToken).toEqual(expect.any(String));
    expect(refreshRes.body.data.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect(refreshRes.body.data).not.toHaveProperty('user');

    const newRefreshToken = refreshRes.body.data.refreshToken;
    expect(newRefreshToken).not.toBe(refreshToken);

    // old token is dead (rotation proven)
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect((res) => {
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('INVALID_REFRESH_TOKEN');
      });

    // logout revokes; then the new token is dead too; logout idempotent
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

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: newRefreshToken })
      .expect(200);

    // wrong password stays 401 INVALID_CREDENTIALS even after verification
    const wrong = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testUser.email, password: 'password-salah' })
      .expect(401);
    expect(wrong.body.error).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.message).toBe('Email atau password salah');
  });

  it('concurrent refresh with the same token: exactly one succeeds', async () => {
    await registerAndVerify(app, mail);
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);
    const refreshToken = loginRes.body.data.refreshToken;

    const results = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken }),
      request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken }),
    ]);

    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 401]);
    const failed = results.find((res) => res.status === 401);
    expect(failed?.body.error).toBe('INVALID_REFRESH_TOKEN');
  });

  it('GET /me without token → 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);

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
