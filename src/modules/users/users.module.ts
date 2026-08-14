import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminUsersController } from './admin-users.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AccessControlService } from '../auth/services/access-control.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, AccessControlService],
})
export class UsersModule {}
