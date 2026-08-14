import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CreationSource, TodoPriority, TodoStatus } from '@prisma/client';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TodoService } from './todo.service';

describe('TodoService', () => {
  let service: TodoService;
  let prisma: DeepMockProxy<PrismaService>;

  const userId = '10000000-0000-4000-8000-000000000001';
  const todoId = '20000000-0000-4000-8000-000000000001';
  const categoryId = '30000000-0000-4000-8000-000000000001';
  const now = new Date('2026-08-14T12:00:00.000Z');
  const todo = {
    id: todoId,
    title: 'Bayar tagihan',
    description: null,
    categoryId: null,
    category: null,
    status: TodoStatus.pending,
    priority: TodoPriority.medium,
    dueAt: null,
    reminderAt: null,
    completedAt: null,
    isArchived: false,
    localNotificationId: null,
    source: CreationSource.manual,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    const moduleRef = await Test.createTestingModule({
      providers: [TodoService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(TodoService);
  });

  it('creates a manual todo owned by the authenticated user', async () => {
    prisma.todo.create.mockResolvedValue(todo as never);

    const result = await service.create(userId, { title: todo.title });

    expect(prisma.todo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId, title: todo.title }),
      }),
    );
    expect(result).toEqual(todo);
  });

  it('rejects a reminder later than the due date', async () => {
    await expect(
      service.create(userId, {
        title: todo.title,
        dueAt: '2026-08-14T12:00:00.000Z',
        reminderAt: '2026-08-14T13:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('rejects a category not owned by the authenticated user', async () => {
    prisma.category.findFirst.mockResolvedValue(null);

    await expect(
      service.create(userId, { title: todo.title, categoryId }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns only owned active todos with bounded pagination', async () => {
    prisma.todo.findMany.mockResolvedValue([todo] as never);
    prisma.todo.count.mockResolvedValue(1);

    const result = await service.findAll(userId, {
      isArchived: false,
      page: 2,
      limit: 10,
      status: TodoStatus.pending,
    });

    expect(prisma.todo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId,
          deletedAt: null,
          status: TodoStatus.pending,
        }),
        skip: 10,
        take: 10,
      }),
    );
    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it('sets completedAt when status becomes completed', async () => {
    prisma.todo.findFirst
      .mockResolvedValueOnce({
        id: todoId,
        status: TodoStatus.pending,
        dueAt: null,
        reminderAt: null,
      } as never)
      .mockResolvedValueOnce({
        ...todo,
        status: TodoStatus.completed,
        completedAt: now,
      } as never);
    prisma.todo.updateMany.mockResolvedValue({ count: 1 });

    await service.update(userId, todoId, {
      status: TodoStatus.completed,
    });

    expect(prisma.todo.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: todoId, userId, deletedAt: null },
        data: expect.objectContaining({ completedAt: expect.any(Date) }),
      }),
    );
  });

  it('soft deletes only an owned active todo', async () => {
    prisma.todo.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.remove(userId, todoId)).resolves.toEqual({
      id: todoId,
    });
    expect(prisma.todo.updateMany).toHaveBeenCalledWith({
      where: { id: todoId, userId, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
