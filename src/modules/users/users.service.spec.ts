import { Test } from '@nestjs/testing';
import { AuthProvider, UserRole, UserTier } from '@prisma/client';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuthErrorCodes } from '../auth/auth.errors';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: DeepMockProxy<PrismaService>;
  let authService: jest.Mocked<Pick<AuthService, 'registerByAdmin'>>;

  const safeUser = {
    id: '10000000-0000-4000-8000-000000000002',
    email: 'member@example.com',
    name: 'Member',
    authProvider: AuthProvider.email,
    tier: UserTier.free,
    role: UserRole.member,
    emailVerifiedAt: new Date(),
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    profile: null,
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    authService = { registerByAdmin: jest.fn() };
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (operation: (client: PrismaService) => unknown) =>
        operation(prisma),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('prevents admin from changing own role', async () => {
    await expect(
      service.updateRole('same-id', 'same-id', UserRole.member),
    ).rejects.toMatchObject({
      code: AuthErrorCodes.SELF_MANAGEMENT_FORBIDDEN,
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('changes another user role', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: safeUser.id } as never);
    prisma.user.update.mockResolvedValue({
      ...safeUser,
      role: UserRole.admin,
    } as never);

    const result = await service.updateRole(
      'admin-id',
      safeUser.id,
      UserRole.admin,
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: UserRole.admin } }),
    );
    expect(result.role).toBe(UserRole.admin);
  });

  it('suspends user and revokes active refresh tokens transactionally', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: safeUser.id } as never);
    prisma.user.update.mockResolvedValue({
      ...safeUser,
      isActive: false,
    } as never);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.updateStatus('admin-id', safeUser.id, false);

    expect(result.isActive).toBe(false);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: safeUser.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
