import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, resetDatabase } from './test-utils';

describe('Rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks the 21st auth request within a minute with 429 envelope', async () => {
    let blocked = false;
    for (let i = 0; i < 25; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: `user${i}@example.com`, password: 'rahasia123' });

      if (res.status === 429) {
        blocked = true;
        expect(res.body).toEqual({
          success: false,
          message: 'Terlalu banyak permintaan, coba lagi nanti',
          data: null,
          error: 'RATE_LIMIT_EXCEEDED',
        });
        break;
      }
      expect(res.status).toBe(401); // INVALID_CREDENTIALS until limited
    }
    expect(blocked).toBe(true);
  }, 30000);
});
