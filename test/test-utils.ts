import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MailService } from '../src/modules/mail/mail.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';

export interface SentMail {
  to: string;
  name: string;
  code: string;
}

export interface MailSpy {
  sent: SentMail[];
  sendVerificationCode: jest.Mock;
}

/** Mock MailService that records verification codes instead of sending SMTP. */
export function createMailSpy(): MailSpy {
  const sent: SentMail[] = [];
  const sendVerificationCode = jest.fn(
    async (to: string, name: string, code: string) => {
      sent.push({ to, name, code });
    },
  );
  return { sent, sendVerificationCode };
}

export async function createTestApp(
  mailSpy: MailSpy = createMailSpy(),
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MailService)
    .useValue(mailSpy)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

/** App + its mail spy, for tests that need to read the generated code. */
export async function createTestAppWithMail(): Promise<{
  app: INestApplication;
  mail: MailSpy;
}> {
  const mail = createMailSpy();
  const app = await createTestApp(mail);
  return { app, mail };
}

export async function resetDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.refreshToken.deleteMany();
  await prisma.verificationCode.deleteMany();
  await prisma.user.deleteMany();
}

export const testUser = {
  email: 'budi@example.com',
  password: 'rahasia123',
  name: 'Budi',
};

/** Registers testUser and verifies their email using the captured code. */
export async function registerAndVerify(
  app: INestApplication,
  mail: MailSpy,
): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/auth/register')
    .send(testUser)
    .expect(201);
  const code = mail.sent[mail.sent.length - 1]?.code;
  await request(app.getHttpServer())
    .post('/api/auth/verify-email')
    .send({ email: testUser.email, code })
    .expect(200);
}
