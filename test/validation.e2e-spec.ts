import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestApp, resetDatabase, testUser } from './test-utils';

describe('Validation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('register with invalid email → 400 VALIDATION_ERROR with details', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...testUser, email: 'bukan-email' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('Periksa kembali isian kamu');
    expect(res.body.data.details).toEqual(expect.any(Array));
    expect(res.body.data.details.join(' ')).toContain('email');
  });

  it('register with short password (< 8) → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...testUser, password: 'pendek' })
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.data.details.join(' ')).toContain('password');
  });

  it('register with missing fields → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({})
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.data.details.length).toBeGreaterThanOrEqual(1);
  });

  it('login with invalid email → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'bukan-email', password: 'apa-saja' })
      .expect(400);
  });

  it('refresh with malformed token → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'bukan-hex' })
      .expect(400);
  });

  it('verify-email with non-6-digit code → 400 VALIDATION_ERROR', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ email: testUser.email, code: '12' })
      .expect(400);
  });

  it('verify-email for an unregistered email → 400 INVALID_CODE (uniform)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ email: 'ghost@example.com', code: '123456' })
      .expect(400);

    expect(res.body.error).toBe('INVALID_CODE');
    expect(res.body.message).toBe('Kode tidak valid atau sudah kedaluwarsa');
  });

  it('resend-code with invalid email → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/resend-code')
      .send({ email: 'bukan-email' })
      .expect(400);
  });

  it('register with an already-taken email → 409 EMAIL_TAKEN envelope', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(409);

    expect(res.body).toEqual({
      success: false,
      message: 'Email sudah terdaftar',
      data: null,
      error: 'EMAIL_TAKEN',
    });
  });

  it('GET /me with an expired access token → 401 UNAUTHORIZED', async () => {
    const jwtService = app.get(JwtService);
    const expired = await jwtService.signAsync(
      { sub: 'nonexistent-user' },
      { expiresIn: '-1h' },
    );

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);

    expect(res.body.error).toBe('UNAUTHORIZED');
  });
});
