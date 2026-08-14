import { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
}

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}
