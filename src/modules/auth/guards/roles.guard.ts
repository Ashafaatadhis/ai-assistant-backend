import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from './authenticated-user.type';
import { AppException, AuthErrorCodes } from './auth.errors';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) {
      return true;
    }
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    if (request.user && requiredRoles.includes(request.user.role)) {
      return true;
    }
    throw new AppException(
      AuthErrorCodes.FORBIDDEN,
      'Kamu tidak memiliki izin untuk melakukan tindakan ini',
      HttpStatus.FORBIDDEN,
    );
  }
}
