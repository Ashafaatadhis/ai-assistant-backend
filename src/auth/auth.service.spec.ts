import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { AuthErrorCodes } from './auth.errors';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: DeepMockProxy<PrismaService>;
  let oauthClient: DeepMockProxy<OAuth2Client>;

  const userRecord = {
    id: 'user-1',
    email: 'budi@example.com',
    passwordHash: '$2b$10$hashed',
    name: 'Budi',
    authProvider: 'email' as const,
    tier: 'free' as const,
    createdAt: new Date('2026-08-12T09:30:00.000Z'),
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    oauthClient = mockDeep<OAuth2Client>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: new JwtService({ secret: 'test-secret' }),
        },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const env: Record<string, string> = {
                ACCESS_TOKEN_SECRET: 'test-secret',
                ACCESS_TOKEN_TTL: '15m',
                REFRESH_TOKEN_TTL_DAYS: '30',
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
    it('hashes the password with bcrypt and creates the user', async () => {
      mockTokenPair();
      prisma.user.findUnique.mockResolvedValueOnce(null); // email check
      prisma.user.create.mockResolvedValueOnce(userRecord);

      await service.register({
        email: 'Budi@Example.com',
        password: 'rahasia123',
        name: 'Budi',
      });

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs?.data.email).toBe('budi@example.com'); // lowercased
      expect(createArgs?.data.authProvider).toBe('email');
      expect(createArgs?.data.tier).toBe('free');
      const hash = createArgs?.data.passwordHash as string;
      expect(hash).not.toBe('rahasia123');
      expect(bcrypt.compareSync('rahasia123', hash)).toBe(true);
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
  });

  describe('login', () => {
    it('verifies the password and returns tokens on success', async () => {
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

    it.each([
      ['unknown email', null],
      [
        'google account without password',
        { ...userRecord, passwordHash: null },
      ],
    ])(
      'returns INVALID_CREDENTIALS for %s',
      async (_label, found) => {
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
      },
    );

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

    it('creates a google user when the email is new', async () => {
      oauthClient.verifyIdToken.mockResolvedValue({
        getPayload: () => tokenPayload,
      } as never);
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValueOnce({
        ...userRecord,
        email: 'budi@gmail.com',
        authProvider: 'google',
        passwordHash: null,
      });
      mockTokenPair();

      const result = await service.googleAuth({ idToken: 'valid-token' });

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs?.data.authProvider).toBe('google');
      expect(createArgs?.data.passwordHash).toBeNull();
      expect(result.user.email).toBe('budi@gmail.com');
      expect(result.created).toBe(true);
    });

    it('rejects an invalid id token with INVALID_CREDENTIALS', async () => {
      oauthClient.verifyIdToken.mockRejectedValue(new Error('bad token') as never);

      await expect(
        service.googleAuth({ idToken: 'bad-token' }),
      ).rejects.toMatchObject({
        code: AuthErrorCodes.INVALID_CREDENTIALS,
      });
    });
  });

  describe('refresh (rotation)', () => {
    it('revokes the old token and issues a new pair', async () => {
      const future = new Date(Date.now() + 86_400_000);
      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash',
        expiresAt: future,
        revokedAt: null,
        createdAt: new Date(),
      });
      mockTokenPair();

      const result = await service.refresh({ refreshToken: 'a'.repeat(64) });

      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rt-1' } }),
      );
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each([
      ['unknown token', null],
      [
        'revoked token',
        {
          id: 'rt-1',
          userId: 'user-1',
          tokenHash: 'h',
          expiresAt: new Date(Date.now() + 86_400_000),
          revokedAt: new Date(),
          createdAt: new Date(),
        },
      ],
      [
        'expired token',
        {
          id: 'rt-1',
          userId: 'user-1',
          tokenHash: 'h',
          expiresAt: new Date(Date.now() - 1000),
          revokedAt: null,
          createdAt: new Date(),
        },
      ],
    ])('returns INVALID_REFRESH_TOKEN for %s', async (_label, record) => {
      prisma.refreshToken.findUnique.mockResolvedValueOnce(record as never);

      await expect(service.refresh({ refreshToken: 'a'.repeat(64) })).rejects.toMatchObject({
        code: AuthErrorCodes.INVALID_REFRESH_TOKEN,
      });
    });
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

      await expect(service.logout({ refreshToken: 'a'.repeat(64) })).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).toHaveBeenCalled();
    });

    it('is idempotent for unknown or already-revoked tokens', async () => {
      prisma.refreshToken.findUnique.mockResolvedValueOnce(null);
      await expect(service.logout({ refreshToken: 'a'.repeat(64) })).resolves.toBeUndefined();

      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: new Date(),
        createdAt: new Date(),
      });
      await expect(service.logout({ refreshToken: 'a'.repeat(64) })).resolves.toBeUndefined();
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
