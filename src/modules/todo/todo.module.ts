import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TodoService } from './todo.service';
import { TodoController } from './todo.controller';
import { AccessControlService } from '../auth/services/access-control.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TodoController],
  providers: [TodoService, AccessControlService],
})
export class TodoModule {}
