import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { AppException, AuthErrorCodes } from '../auth.errors';
import { AccessControlService } from '../services/access-control.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControlService: AccessControlService,
  ) {}

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
    const user = request.user;
    if (
      user &&
      requiredRoles.some((requiredRole) =>
        this.accessControlService.isAuthorized({
          currentRole: user.role,
          requiredRole,
        }),
      )
    ) {
      return true;
    }
    throw new AppException(
      AuthErrorCodes.FORBIDDEN,
      'Kamu tidak memiliki izin untuk melakukan tindakan ini',
      HttpStatus.FORBIDDEN,
    );
  }
}
