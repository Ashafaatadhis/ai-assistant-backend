import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { TodoController } from './todo.controller';
import { TodoService } from './todo.service';

describe('TodoController', () => {
  let controller: TodoController;
  let service: jest.Mocked<
    Pick<TodoService, 'create' | 'findAll' | 'findOne' | 'update' | 'remove'>
  >;

  const user: AuthenticatedUser = {
    userId: '10000000-0000-4000-8000-000000000001',
    role: UserRole.member,
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [TodoController],
      providers: [{ provide: TodoService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(TodoController);
  });

  it('passes authenticated ownership into create', async () => {
    const dto = { title: 'Bayar tagihan' };

    await controller.create(user, dto);

    expect(service.create).toHaveBeenCalledWith(user.userId, dto);
  });

  it('passes authenticated ownership into remove', async () => {
    const id = '20000000-0000-4000-8000-000000000001';

    await controller.remove(user, id);

    expect(service.remove).toHaveBeenCalledWith(user.userId, id);
  });
});
