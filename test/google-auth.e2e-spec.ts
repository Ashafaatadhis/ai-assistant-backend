import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, resetDatabase } from './test-utils';

describe('Google auth (e2e)', () => {
  let app: INestApplication;

  const mockVerifyIdToken = (payload?: Record<string, unknown>): void => {
    const oauthClient = app.get('GOOGLE_OAUTH_CLIENT');
    oauthClient.verifyIdToken = jest.fn().mockResolvedValue({
      getPayload: () => payload,
    });
  };

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('creates a google user for a new email → 201', async () => {
    mockVerifyIdToken({ email: 'budi@gmail.com', name: 'Budi G' });

    const res = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'valid-token' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      email: 'budi@gmail.com',
      name: 'Budi G',
      authProvider: 'google',
      tier: 'free',
    });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.data).not.toHaveProperty('created');
  });

  it('logs in an existing google user → 200', async () => {
    mockVerifyIdToken({ email: 'budi@gmail.com', name: 'Budi G' });

    await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'valid-token' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'valid-token' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('budi@gmail.com');
    expect(res.body.data).not.toHaveProperty('created');
  });

  it('rejects an invalid id token → 401 INVALID_CREDENTIALS', async () => {
    const oauthClient = app.get('GOOGLE_OAUTH_CLIENT');
    oauthClient.verifyIdToken = jest
      .fn()
      .mockRejectedValue(new Error('invalid token'));

    const res = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'bad-token' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
    expect(res.body.message).toBe('Email atau password salah');
  });
});
