import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, resetDatabase, testUser } from './test-utils';

describe('Validation (e2e)', () => {
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
});
