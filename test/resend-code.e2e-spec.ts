import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestAppWithMail,
  MailSpy,
  resetDatabase,
  testUser,
} from './test-utils';

describe('Resend code (e2e)', () => {
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

  it('resend within the 60s cooldown → 429 RESEND_TOO_SOON', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/auth/resend-code')
      .send({ email: testUser.email })
      .expect(429);

    expect(res.body).toEqual({
      success: false,
      message: 'Tunggu sebentar sebelum mengirim ulang',
      data: { retryAfterSeconds: expect.any(Number) },
      error: 'RESEND_TOO_SOON',
    });
    // Sisa tunggu masuk akal: tidak lebih dari cooldown 60 detik.
    expect(res.body.data.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.body.data.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(mail.sent).toHaveLength(1); // no new code sent
  });

  it('resend for an unknown email → 200 generic, no code created (anti-enumeration)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/resend-code')
      .send({ email: 'nobody@example.com' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Kode verifikasi telah dikirim ulang');
    // Bentuknya sama dengan email yang dikenal (anti-enumeration).
    expect(res.body.data).toEqual({
      resendAvailableAt: expect.any(String),
    });
    expect(mail.sent).toHaveLength(0);
  });
});
