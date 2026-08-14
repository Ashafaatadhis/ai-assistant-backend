import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthProvider, User, UserRole, UserTier } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuthErrorCodes } from './auth.errors';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: DeepMockProxy<PrismaService>;
  let oauthClient: DeepMockProxy<OAuth2Client>;
  let mail: DeepMockProxy<MailService>;

  const user: User = {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'budi@example.com',
    passwordHash: '$2b$10$hashed',
    name: 'Budi',
    authProvider: AuthProvider.email,
    tier: UserTier.free,
    role: UserRole.member,
    emailVerifiedAt: new Date('2026-08-12T08:00:00.000Z'),
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date('2026-08-12T09:30:00.000Z'),
    updatedAt: new Date('2026-08-12T09:30:00.000Z'),
    deletedAt: null,
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    oauthClient = mockDeep<OAuth2Client>();
    mail = mockDeep<MailService>();
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (operation: (client: PrismaService) => unknown) =>
        operation(prisma),
    );
    prisma.refreshToken.create.mockResolvedValue({
      id: 'refresh-1',
      userId: user.id,
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: new JwtService({ secret: 'test' }) },
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string) =>
                ({
                  GOOGLE_CLIENT_ID: 'google-client-id',
                  REFRESH_TOKEN_TTL_DAYS: '30',
                  CODE_TTL_MINUTES: '10',
                  CODE_MAX_ATTEMPTS: '5',
                  RESEND_COOLDOWN_SECONDS: '60',
                })[key],
            ),
          },
        },
        { provide: 'GOOGLE_OAUTH_CLIENT', useValue: oauthClient },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('public registration always creates member with profile and verification code', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ ...user, emailVerifiedAt: null });
    mail.sendVerificationCode.mockResolvedValue(undefined);

    const result = await service.register({
      email: 'BUDI@example.com',
      password: 'rahasia123',
      name: 'Budi',
    });

    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      email: 'budi@example.com',
      role: UserRole.member,
      profile: { create: {} },
    });
    expect(
      await bcrypt.compare('rahasia123', data.passwordHash as string),
    ).toBe(true);
    expect(prisma.verificationCode.create).toHaveBeenCalled();
    expect(mail.sendVerificationCode).toHaveBeenCalledWith(
      'budi@example.com',
      'Budi',
      expect.stringMatching(/^\d{6}$/),
    );
    expect(result.resendAvailableAt).toEqual(expect.any(String));
  });

  it('admin provisioning applies requested role but remains unverified', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      ...user,
      role: UserRole.admin,
      emailVerifiedAt: null,
    });

    const result = await service.registerByAdmin(
      { email: user.email, password: 'rahasia123', name: user.name },
      UserRole.admin,
    );

    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
      role: UserRole.admin,
      emailVerifiedAt: null,
    });
    expect(result.user.role).toBe(UserRole.admin);
  });

  it('rejects duplicate registration', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(
      service.register({
        email: user.email,
        password: 'rahasia123',
        name: user.name,
      }),
    ).rejects.toMatchObject({ code: AuthErrorCodes.EMAIL_TAKEN });
  });

  it('login stores request metadata and updates lastLoginAt', async () => {
    const passwordHash = await bcrypt.hash('rahasia123', 4);
    prisma.user.findUnique.mockResolvedValue({ ...user, passwordHash });
    prisma.user.update.mockResolvedValue({ ...user, passwordHash });

    const result = await service.login(
      { email: user.email, password: 'rahasia123' },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastLoginAt: expect.any(Date) } }),
    );
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
        }),
      }),
    );
    expect(result.user.role).toBe(UserRole.member);
  });

  it('rejects valid credentials for inactive account', async () => {
    const passwordHash = await bcrypt.hash('rahasia123', 4);
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      passwordHash,
      isActive: false,
    });
    await expect(
      service.login({ email: user.email, password: 'rahasia123' }),
    ).rejects.toMatchObject({ code: AuthErrorCodes.ACCOUNT_DISABLED });
  });

  it('verifies email and issues token in one transaction', async () => {
    const unverified = { ...user, emailVerifiedAt: null };
    prisma.user.findUnique.mockResolvedValue(unverified);
    prisma.verificationCode.findFirst.mockResolvedValue({
      id: 'code-1',
      userId: user.id,
      codeHash: createHash('sha256').update('123456').digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      createdAt: new Date(),
    });
    prisma.user.update.mockResolvedValue(user);

    const result = await service.verifyEmail({
      email: user.email,
      code: '123456',
    });

    expect(prisma.verificationCode.deleteMany).toHaveBeenCalled();
    expect(prisma.refreshToken.create).toHaveBeenCalled();
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it('rotates active refresh token atomically', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'refresh-1',
      userId: user.id,
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
      user,
    } as never);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.refresh({ refreshToken: 'a'.repeat(64) });

    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(prisma.refreshToken.create).toHaveBeenCalled();
    expect(result.refreshToken).not.toBe('a'.repeat(64));
  });

  it('rejects refresh for inactive user', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'refresh-1',
      userId: user.id,
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
      user: { ...user, isActive: false },
    } as never);
    await expect(
      service.refresh({ refreshToken: 'a'.repeat(64) }),
    ).rejects.toMatchObject({ code: AuthErrorCodes.INVALID_REFRESH_TOKEN });
  });

  it('returns safe me response with profile', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      profile: {
        id: 'profile-1',
        userId: user.id,
        avatarUrl: null,
        bio: 'Hello',
        phoneNumber: null,
        gender: null,
        dateOfBirth: null,
        timezone: 'Asia/Jakarta',
        locale: 'id-ID',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    const result = await service.getMe(user.id);

    expect(result).toMatchObject({
      role: UserRole.member,
      profile: { bio: 'Hello' },
    });
    expect(result).not.toHaveProperty('passwordHash');
  });
});
