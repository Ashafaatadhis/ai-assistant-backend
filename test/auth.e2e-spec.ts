import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestAppWithMail,
  MailSpy,
  resetDatabase,
  testUser,
} from './test-utils';

describe('Register / verify-email / login (e2e)', () => {
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

  it('register returns 201 WITHOUT tokens and sends a 6-digit code', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    expect(res.body).toEqual({
      success: true,
      message: 'Kode verifikasi telah dikirim ke email kamu',
      data: { resendAvailableAt: expect.any(String) },
    });
    // resendAvailableAt ~60 detik dari sekarang (cooldown).
    const availableAt = new Date(res.body.data.resendAvailableAt).getTime();
    expect(availableAt).toBeGreaterThan(Date.now());
    expect(availableAt).toBeLessThanOrEqual(Date.now() + 61_000);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].code).toMatch(/^\d{6}$/);
    expect(mail.sent[0].to).toBe(testUser.email);
  });

  it('verify-email: wrong code → 400 INVALID_CODE, correct code → 200 with tokens, /me works', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    const code = mail.sent[0].code;
    const wrongCode = code === '000000' ? '111111' : '000000';

    const bad = await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ email: testUser.email, code: wrongCode })
      .expect(400);
    expect(bad.body.error).toBe('INVALID_CODE');
    expect(bad.body.message).toBe('Kode tidak valid atau sudah kedaluwarsa');

    const res = await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ email: testUser.email, code })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      email: testUser.email,
      authProvider: 'email',
      tier: 'free',
    });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toMatch(/^[0-9a-f]{64}$/);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`)
      .expect(200);
    expect(me.body.data.email).toBe(testUser.email);
  });

  it('login before verification → 403 EMAIL_NOT_VERIFIED; after → 200', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    const before = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(403);
    expect(before.body.error).toBe('EMAIL_NOT_VERIFIED');
    expect(before.body.message).toBe('Email kamu belum diverifikasi');

    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ email: testUser.email, code: mail.sent[0].code })
      .expect(200);

    const after = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);
    expect(after.body.success).toBe(true);
    expect(after.body.data.accessToken).toEqual(expect.any(String));
  });
});
