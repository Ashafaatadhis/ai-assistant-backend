import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import {
  createTestAppWithMail,
  MailSpy,
  registerAndVerify,
  resetDatabase,
  testUser,
} from './test-utils';

describe('Profiles and RBAC (e2e)', () => {
  let app: INestApplication;
  let mail: MailSpy;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, mail } = await createTestAppWithMail());
    prisma = app.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  }, 30000);

  beforeEach(async () => {
    await resetDatabase(app);
    mail.sent.length = 0;
  });

  it('ignores public role input and lets member update only own profile', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...testUser, role: UserRole.admin })
      .expect(201);
    const verified = await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ email: testUser.email, code: mail.sent[0].code })
      .expect(200);
    const token = verified.body.data.accessToken as string;

    const profile = await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ bio: 'Updated profile', timezone: 'Asia/Makassar' })
      .expect(200);

    expect(profile.body.data).toMatchObject({
      role: UserRole.member,
      profile: { bio: 'Updated profile', timezone: 'Asia/Makassar' },
    });
    expect(profile.body.data).not.toHaveProperty('passwordHash');

    const forbidden = await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(forbidden.body.error).toBe('FORBIDDEN');
  });

  it('admin provisions, changes role, and suspends another user', async () => {
    await registerAndVerify(app, mail);
    await prisma.user.update({
      where: { email: testUser.email },
      data: { role: UserRole.admin },
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);
    const adminToken = adminLogin.body.data.accessToken as string;

    const created = await request(app.getHttpServer())
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'managed@example.com',
        password: 'temporary123',
        name: 'Managed User',
        role: UserRole.member,
      })
      .expect(201);
    const managedId = created.body.data.user.id as string;

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'managed@example.com', password: 'temporary123' })
      .expect(403);

    const managedCode = mail.sent.at(-1)?.code;
    const verified = await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ email: 'managed@example.com', code: managedCode })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/admin/users/${managedId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: UserRole.admin })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/admin/users/${managedId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${verified.body.data.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: verified.body.data.refreshToken })
      .expect(401);
  });
});
