import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';

interface AuthorizationRoles {
  currentRole: UserRole;
  requiredRole: UserRole;
}

@Injectable()
export class AccessControlService {
  private readonly hierarchies: ReadonlyArray<ReadonlyMap<UserRole, number>> = [
    new Map<UserRole, number>([
      [UserRole.member, 0],
      [UserRole.admin, 1],
    ]),
  ];

  isAuthorized({ currentRole, requiredRole }: AuthorizationRoles): boolean {
    return this.hierarchies.some((hierarchy) => {
      const currentPriority = hierarchy.get(currentRole);
      const requiredPriority = hierarchy.get(requiredRole);

      return (
        currentPriority !== undefined &&
        requiredPriority !== undefined &&
        currentPriority >= requiredPriority
      );
    });
  }
}
