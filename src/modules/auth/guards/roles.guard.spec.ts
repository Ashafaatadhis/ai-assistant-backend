import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { AuthErrorCodes } from './auth.errors';
import { RolesGuard } from './roles.guard';

const contextWithRole = (role?: UserRole): ExecutionContext =>
  ({
    getHandler: () => RolesGuard,
    getClass: () => RolesGuard,
    switchToHttp: () => ({
      getRequest: () =>
        role ? { user: { userId: 'user-1', role } } : { user: undefined },
    }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();
    guard = moduleRef.get(RolesGuard);
    reflector = moduleRef.get(Reflector);
  });

  it('allows routes without required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextWithRole(UserRole.member))).toBe(true);
  });

  it('allows matching role and rejects member on admin route', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.admin]);
    expect(guard.canActivate(contextWithRole(UserRole.admin))).toBe(true);
    expect(() => guard.canActivate(contextWithRole(UserRole.member))).toThrow(
      expect.objectContaining({ code: AuthErrorCodes.FORBIDDEN }),
    );
  });
});
