import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { AuthErrorCodes } from './auth.errors';
import * as bcrypt from 'bcrypt';

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: DeepMockProxy<PrismaService>;
  let oauthClient: DeepMockProxy<OAuth2Client>;
  let mail: DeepMockProxy<MailService>;

  const userRecord = {
    id: 'user-1',
    email: 'budi@example.com',
    passwordHash: '$2b$10$hashed',
    name: 'Budi',
    authProvider: 'email' as const,
    tier: 'free' as const,
    emailVerifiedAt: new Date('2026-08-12T08:00:00.000Z'),
    createdAt: new Date('2026-08-12T09:30:00.000Z'),
  };
  const unverifiedUser = { ...userRecord, emailVerifiedAt: null };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    oauthClient = mockDeep<OAuth2Client>();
    mail = mockDeep<MailService>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: new JwtService({ secret: 'test-secret' }),
        },
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const env: Record<string, string> = {
                ACCESS_TOKEN_SECRET: 'test-secret',
                ACCESS_TOKEN_TTL: '15m',
                REFRESH_TOKEN_TTL_DAYS: '30',
                GOOGLE_CLIENT_ID: 'google-client-id',
                CODE_TTL_MINUTES: '10',
                CODE_MAX_ATTEMPTS: '5',
                RESEND_COOLDOWN_SECONDS: '60',
              };
              return env[key];
            }),
          },
        },
        { provide: 'GOOGLE_OAUTH_CLIENT', useValue: oauthClient },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  const mockTokenPair = (): void => {
    prisma.user.findUnique.mockResolvedValue(userRecord);
    prisma.refreshToken.create.mockResolvedValue({
      id: 'rt-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
    });
  };

  describe('register', () => {
    it('creates an unverified user, hashes the password, sends a 6-digit code', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValueOnce(unverifiedUser);
      mail.sendVerificationCode.mockResolvedValue(undefined);

      await service.register({
        email: 'Budi@Example.com',
        password: 'rahasia123',
        name: 'Budi',
      });

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs?.data.email).toBe('budi@example.com');
      expect(createArgs?.data.emailVerifiedAt).toBeNull();
      expect(createArgs?.data.tier).toBe('free');
      const hash = createArgs?.data.passwordHash as string;
      expect(bcrypt.compareSync('rahasia123', hash)).toBe(true);

      // code stored as SHA-256 hash, never plaintext
      const codeArgs = prisma.verificationCode.create.mock.calls[0][0];
      expect(codeArgs?.data.codeHash).toMatch(/^[0-9a-f]{64}$/);

      // the code mailed is exactly 6 digits and matches the stored hash
      expect(mail.sendVerificationCode).toHaveBeenCalledTimes(1);
      const [to, name, code] = mail.sendVerificationCode.mock.calls[0];
      expect(to).toBe('budi@example.com');
      expect(name).toBe('Budi');
      expect(code).toMatch(/^\d{6}$/);
      expect(sha256(code)).toBe(codeArgs?.data.codeHash);
    });

    it('rejects a duplicate email with EMAIL_TAKEN', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(userRecord);

      await expect(
        service.register({
          email: 'budi@example.com',
          password: 'rahasia123',
          name: 'Budi',
        }),
      ).rejects.toMatchObject({ code: AuthErrorCodes.EMAIL_TAKEN });
    });

    it('maps a race-time unique violation (P2002) to EMAIL_TAKEN', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '5',
        }),
      );

      await expect(
        service.register({
          email: 'budi@example.com',
          password: 'rahasia123',
          name: 'Budi',
        }),
      ).rejects.toMatchObject({ code: AuthErrorCodes.EMAIL_TAKEN });
    });

    it('does not fail registration when SMTP fails', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValueOnce(unverifiedUser);
      mail.sendVerificationCode.mockRejectedValue(new Error('smtp down'));

      await expect(
        service.register({
          email: 'budi@example.com',
          password: 'rahasia123',
          name: 'Budi',
        }),
      ).resolves.toHaveProperty('resendAvailableAt');
    });

    it('returns resendAvailableAt ~60s ahead', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValueOnce(unverifiedUser);
      mail.sendVerificationCode.mockResolvedValue(undefined);

      const before = Date.now();
      const info = await service.register({
        email: 'budi@example.com',
        password: 'rahasia123',
        name: 'Budi',
      });
      const availableAt = new Date(info.resendAvailableAt).getTime();
      expect(availableAt).toBeGreaterThanOrEqual(before + 59_000);
      expect(availableAt).toBeLessThanOrEqual(before + 61_000);
    });
  });

  describe('verifyEmail', () => {
    const codeRecord = (overrides = {}) => ({
      id: 'vc-1',
      userId: 'user-1',
      codeHash: sha256('123456'),
      expiresAt: new Date(Date.now() + 600_000),
      attempts: 0,
      createdAt: new Date(),
      ...overrides,
    });

    it('verifies the correct code, sets emailVerifiedAt, returns tokens', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(unverifiedUser);
      prisma.verificationCode.findFirst.mockResolvedValueOnce(codeRecord());
      mockTokenPair();

      const result = await service.verifyEmail({
        email: 'budi@example.com',
        code: '123456',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            emailVerifiedAt: expect.any(Date),
          }),
        }),
      );
      expect(prisma.verificationCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects an unknown email with INVALID_CODE', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.verifyEmail({ email: 'ghost@example.com', code: '123456' }),
      ).rejects.toMatchObject({ code: AuthErrorCodes.INVALID_CODE });
    });

    it('rejects when no code exists', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(unverifiedUser);
      prisma.verificationCode.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.verifyEmail({ email: 'budi@example.com', code: '123456' }),
      ).rejects.toMatchObject({ code: AuthErrorCodes.INVALID_CODE });
    });

    it('rejects an expired code', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(unverifiedUser);
      prisma.verificationCode.findFirst.mockResolvedValueOnce(
        codeRecord({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.verifyEmail({ email: 'budi@example.com', code: '123456' }),
      ).rejects.toMatchObject({ code: AuthErrorCodes.INVALID_CODE });
    });

    it('increments attempts and rejects a wrong code', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(unverifiedUser);
      prisma.verificationCode.findFirst.mockResolvedValueOnce(codeRecord());

      await expect(
        service.verifyEmail({ email: 'budi@example.com', code: '000000' }),
      ).rejects.toMatchObject({ code: AuthErrorCodes.INVALID_CODE });
      expect(prisma.verificationCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'vc-1' },
          data: { attempts: { increment: 1 } },
        }),
      );
    });

    it('rejects when attempts are exhausted (5)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(unverifiedUser);
      prisma.verificationCode.findFirst.mockResolvedValueOnce(
        codeRecord({ attempts: 5 }),
      );

      await expect(
        service.verifyEmail({ email: 'budi@example.com', code: '123456' }),
      ).rejects.toMatchObject({ code: AuthErrorCodes.INVALID_CODE });
    });
  });

  describe('resendCode', () => {
    it('answers 200 for an unknown email without creating a code (anti-enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.resendCode({ email: 'ghost@example.com' }),
      ).resolves.toHaveProperty('resendAvailableAt');
      expect(prisma.verificationCode.create).not.toHaveBeenCalled();
    });

    it('rejects within the 60s cooldown with RESEND_TOO_SOON', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(unverifiedUser);
      prisma.verificationCode.findFirst.mockResolvedValueOnce({
        id: 'vc-1',
        userId: 'user-1',
        codeHash: 'h',
        expiresAt: new Date(Date.now() + 600_000),
        attempts: 0,
        createdAt: new Date(), // just now
      });

      await expect(
        service.resendCode({ email: 'budi@example.com' }),
      ).rejects.toMatchObject({
        code: AuthErrorCodes.RESEND_TOO_SOON,
        data: { retryAfterSeconds: expect.any(Number) },
      });
    });

    it('creates a new code after the cooldown and mails it', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(unverifiedUser);
      prisma.verificationCode.findFirst.mockResolvedValueOnce({
        id: 'vc-1',
        userId: 'user-1',
        codeHash: 'h',
        expiresAt: new Date(Date.now() + 600_000),
        attempts: 0,
        createdAt: new Date(Date.now() - 61_000), // > 60s ago
      });
      mail.sendVerificationCode.mockResolvedValue(undefined);

      const info = await service.resendCode({ email: 'budi@example.com' });

      expect(prisma.verificationCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(prisma.verificationCode.create).toHaveBeenCalled();
      expect(mail.sendVerificationCode).toHaveBeenCalledTimes(1);
      expect(new Date(info.resendAvailableAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });
  });

  describe('login', () => {
    it('verifies the password and returns tokens for a verified user', async () => {
      const realHash = await bcrypt.hash('rahasia123', 4);
      prisma.user.findUnique.mockResolvedValueOnce({
        ...userRecord,
        passwordHash: realHash,
      });
      mockTokenPair();

      const result = await service.login({
        email: 'budi@example.com',
        password: 'rahasia123',
      });

      expect(result.user.id).toBe('user-1');
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects an unverified account with EMAIL_NOT_VERIFIED (403)', async () => {
      const realHash = await bcrypt.hash('rahasia123', 4);
      prisma.user.findUnique.mockResolvedValueOnce({
        ...userRecord,
        passwordHash: realHash,
        emailVerifiedAt: null,
      });

      await expect(
        service.login({
          email: 'budi@example.com',
          password: 'rahasia123',
        }),
      ).rejects.toMatchObject({
        code: AuthErrorCodes.EMAIL_NOT_VERIFIED,
        httpStatus: 403,
      });
    });

    it('wrong password on unverified account → INVALID_CREDENTIALS, not EMAIL_NOT_VERIFIED', async () => {
      const realHash = await bcrypt.hash('rahasia123', 4);
      prisma.user.findUnique.mockResolvedValueOnce({
        ...userRecord,
        passwordHash: realHash,
        emailVerifiedAt: null,
      });

      await expect(
        service.login({
          email: 'budi@example.com',
          password: 'salah-semua',
        }),
      ).rejects.toMatchObject({
        code: AuthErrorCodes.INVALID_CREDENTIALS,
        httpStatus: 401,
      });
    });

    it.each([
      ['unknown email', null],
      [
        'google account without password',
        { ...userRecord, passwordHash: null },
      ],
    ])('returns INVALID_CREDENTIALS for %s', async (_label, found) => {
      prisma.user.findUnique.mockResolvedValueOnce(
        found as typeof userRecord | null,
      );

      await expect(
        service.login({
          email: 'budi@example.com',
          password: 'whatever',
        }),
      ).rejects.toMatchObject({
        code: AuthErrorCodes.INVALID_CREDENTIALS,
      });
    });

    it('returns INVALID_CREDENTIALS for a wrong password', async () => {
      const realHash = await bcrypt.hash('rahasia123', 4);
      prisma.user.findUnique.mockResolvedValueOnce({
        ...userRecord,
        passwordHash: realHash,
      });

      await expect(
        service.login({ email: 'budi@example.com', password: 'salah' }),
      ).rejects.toMatchObject({
        code: AuthErrorCodes.INVALID_CREDENTIALS,
      });
    });
  });

  describe('googleAuth', () => {
    const tokenPayload = {
      email: 'budi@gmail.com',
      name: 'Budi G',
      aud: 'google-client-id',
    };

    it('creates a google user with emailVerifiedAt set', async () => {
      oauthClient.verifyIdToken.mockResolvedValue({
        getPayload: () => tokenPayload,
      } as never);
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValueOnce({
        ...userRecord,
        email: 'budi@gmail.com',
        authProvider: 'google',
        passwordHash: null,
        emailVerifiedAt: new Date(),
      });
      mockTokenPair();

      const result = await service.googleAuth({ idToken: 'valid-token' });

      expect(oauthClient.verifyIdToken).toHaveBeenCalledWith({
        idToken: 'valid-token',
        audience: 'google-client-id',
      });
      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs?.data.authProvider).toBe('google');
      expect(createArgs?.data.passwordHash).toBeNull();
      expect(createArgs?.data.emailVerifiedAt).toBeInstanceOf(Date);
      expect(result.user.email).toBe('budi@gmail.com');
      expect(result.created).toBe(true);
    });

    it('rejects an invalid id token with INVALID_CREDENTIALS', async () => {
      oauthClient.verifyIdToken.mockRejectedValue(
        new Error('bad token') as never,
      );

      await expect(
        service.googleAuth({ idToken: 'bad-token' }),
      ).rejects.toMatchObject({
        code: AuthErrorCodes.INVALID_CREDENTIALS,
      });
    });
  });

  describe('refresh (rotation)', () => {
    it('atomically revokes the old token and issues a new pair', async () => {
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: new Date(),
        createdAt: new Date(),
      });
      mockTokenPair();

      const result = await service.refresh({ refreshToken: 'a'.repeat(64) });

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ revokedAt: null }),
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each([
      ['unknown token', null],
      ['revoked token', {}],
      ['expired token', {}],
    ])(
      'returns INVALID_REFRESH_TOKEN for %s (atomic claim matched nothing)',
      async () => {
        prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });

        await expect(
          service.refresh({ refreshToken: 'a'.repeat(64) }),
        ).rejects.toMatchObject({
          code: AuthErrorCodes.INVALID_REFRESH_TOKEN,
        });
      },
    );
  });

  describe('logout', () => {
    it('revokes a known active token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
        createdAt: new Date(),
      });

      await expect(
        service.logout({ refreshToken: 'a'.repeat(64) }),
      ).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).toHaveBeenCalled();
    });

    it('is idempotent for unknown or already-revoked tokens', async () => {
      prisma.refreshToken.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.logout({ refreshToken: 'a'.repeat(64) }),
      ).resolves.toBeUndefined();

      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: new Date(),
        createdAt: new Date(),
      });
      await expect(
        service.logout({ refreshToken: 'a'.repeat(64) }),
      ).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });

  describe('getMe', () => {
    it('returns the user detail without passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(userRecord);

      const result = await service.getMe('user-1');

      expect(result).toEqual({
        id: 'user-1',
        email: 'budi@example.com',
        name: 'Budi',
        authProvider: 'email',
        tier: 'free',
        createdAt: userRecord.createdAt.toISOString(),
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('throws UNAUTHORIZED when the user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.getMe('ghost')).rejects.toMatchObject({
        code: AuthErrorCodes.UNAUTHORIZED,
      });
    });
  });
});
