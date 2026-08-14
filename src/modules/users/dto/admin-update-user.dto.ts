import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsEnum } from 'class-validator';

export class AdminUpdateRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role!: UserRole;
}

export class AdminUpdateStatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}
