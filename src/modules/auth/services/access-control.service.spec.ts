import { UserRole } from '@prisma/client';
import { Test } from '@nestjs/testing';

import { AccessControlService } from './access-control.service';

describe('AccessControlService', () => {
  let service: AccessControlService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AccessControlService],
    }).compile();

    service = moduleRef.get(AccessControlService);
  });

  it('allows a role to access its own privilege level', () => {
    expect(
      service.isAuthorized({
        currentRole: UserRole.member,
        requiredRole: UserRole.member,
      }),
    ).toBe(true);
  });

  it('allows a higher role to access a lower privilege level', () => {
    expect(
      service.isAuthorized({
        currentRole: UserRole.admin,
        requiredRole: UserRole.member,
      }),
    ).toBe(true);
  });

  it('rejects a lower role from a higher privilege level', () => {
    expect(
      service.isAuthorized({
        currentRole: UserRole.member,
        requiredRole: UserRole.admin,
      }),
    ).toBe(false);
  });
});
