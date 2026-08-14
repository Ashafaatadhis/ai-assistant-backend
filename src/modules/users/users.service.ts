import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AppException, AuthErrorCodes } from '../auth/auth.errors';
import { AdminCreateUserDto } from './dto/admin-create-user.dto';
import { AdminListUsersDto } from './dto/admin-list-users.dto';
import { UpdateMeDto } from './dto/update-me.dto';

const safeUserSelect = {
  id: true,
  email: true,
  name: true,
  authProvider: true,
  tier: true,
  role: true,
  emailVerifiedAt: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  profile: {
    select: {
      avatarUrl: true,
      bio: true,
      phoneNumber: true,
      gender: true,
      dateOfBirth: true,
      timezone: true,
      locale: true,
    },
  },
} satisfies Prisma.UserSelect;

type SafeUser = Prisma.UserGetPayload<{ select: typeof safeUserSelect }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async getMe(userId: string) {
    return this.findSafeUser(userId);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const { name, dateOfBirth, ...profile } = dto;
    await this.prisma.$transaction(async (tx) => {
      if (name !== undefined) {
        await tx.user.update({ where: { id: userId }, data: { name } });
      }
      const profileData = {
        ...profile,
        ...(dateOfBirth !== undefined
          ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }
          : {}),
      };
      await tx.profile.upsert({
        where: { userId },
        update: profileData,
        create: { userId, ...profileData },
      });
    });
    return this.findSafeUser(userId);
  }

  async list(query: AdminListUsersDto) {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(query.role ? { role: query.role } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      },
      select: safeUserSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
    const hasMore = users.length > query.limit;
    const items = hasMore ? users.slice(0, query.limit) : users;
    return {
      items: items.map((user) => this.toSafeResponse(user)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async findOne(id: string) {
    return this.findSafeUser(id);
  }

  async create(dto: AdminCreateUserDto) {
    return this.authService.registerByAdmin(
      { email: dto.email, password: dto.password, name: dto.name },
      dto.role,
    );
  }

  async updateRole(actorId: string, userId: string, role: UserRole) {
    this.assertNotSelf(actorId, userId);
    await this.ensureUserExists(userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: safeUserSelect,
    });
    return this.toSafeResponse(user);
  }

  async updateStatus(actorId: string, userId: string, isActive: boolean) {
    this.assertNotSelf(actorId, userId);
    await this.ensureUserExists(userId);
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive },
        select: safeUserSelect,
      });
      if (!isActive) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return updated;
    });
    return this.toSafeResponse(user);
  }

  private async findSafeUser(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: safeUserSelect,
    });
    if (!user) {
      throw this.userNotFound();
    }
    return this.toSafeResponse(user);
  }

  private async ensureUserExists(id: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      throw this.userNotFound();
    }
  }

  private toSafeResponse(user: SafeUser) {
    return {
      ...user,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      profile: user.profile
        ? {
            ...user.profile,
            dateOfBirth: user.profile.dateOfBirth?.toISOString() ?? null,
          }
        : null,
    };
  }

  private assertNotSelf(actorId: string, userId: string): void {
    if (actorId === userId) {
      throw new AppException(
        AuthErrorCodes.SELF_MANAGEMENT_FORBIDDEN,
        'Admin tidak dapat mengubah role atau status akunnya sendiri',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private userNotFound(): AppException {
    return new AppException(
      AuthErrorCodes.USER_NOT_FOUND,
      'User tidak ditemukan',
      HttpStatus.NOT_FOUND,
    );
  }
}
