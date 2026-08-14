import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TodoStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateTodoDto } from './dto/create-todo.dto';
import { ListTodosDto } from './dto/list-todos.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';

const TODO_SELECT = {
  id: true,
  title: true,
  description: true,
  categoryId: true,
  category: { select: { id: true, name: true, color: true } },
  status: true,
  priority: true,
  dueAt: true,
  reminderAt: true,
  completedAt: true,
  isArchived: true,
  localNotificationId: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TodoSelect;

@Injectable()
export class TodoService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateTodoDto) {
    await this.assertCategoryOwnership(userId, dto.categoryId);

    const dueAt = this.parseDate(dto.dueAt);
    const reminderAt = this.parseDate(dto.reminderAt);
    this.assertSchedule(dueAt, reminderAt);

    return this.prisma.todo.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        categoryId: dto.categoryId,
        priority: dto.priority,
        dueAt,
        reminderAt,
        localNotificationId: dto.localNotificationId,
      },
      select: TODO_SELECT,
    });
  }

  async findAll(userId: string, query: ListTodosDto) {
    const search = query.search?.trim();
    const dueFrom = query.dueFrom ? new Date(query.dueFrom) : undefined;
    const dueTo = query.dueTo ? new Date(query.dueTo) : undefined;
    if (dueFrom && dueTo && dueFrom > dueTo) {
      throw new BadRequestException(
        'Batas awal tenggat tidak boleh setelah batas akhir',
      );
    }
    const where: Prisma.TodoWhereInput = {
      userId,
      deletedAt: null,
      status: query.status,
      priority: query.priority,
      categoryId: query.categoryId,
      isArchived: query.isArchived,
      dueAt:
        dueFrom || dueTo
          ? {
              gte: dueFrom,
              lte: dueTo,
            }
          : undefined,
      OR: search
        ? [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.prisma.todo.findMany({
        where,
        select: TODO_SELECT,
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.todo.count({ where }),
    ]);

    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(userId: string, id: string) {
    const todo = await this.prisma.todo.findFirst({
      where: { id, userId, deletedAt: null },
      select: TODO_SELECT,
    });
    if (!todo) {
      throw new NotFoundException('Todo tidak ditemukan');
    }
    return todo;
  }

  async update(userId: string, id: string, dto: UpdateTodoDto) {
    const existing = await this.prisma.todo.findFirst({
      where: { id, userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        dueAt: true,
        reminderAt: true,
      },
    });
    if (!existing) {
      throw new NotFoundException('Todo tidak ditemukan');
    }

    await this.assertCategoryOwnership(userId, dto.categoryId);
    const dueAt =
      dto.dueAt === undefined ? existing.dueAt : this.parseDate(dto.dueAt);
    const reminderAt =
      dto.reminderAt === undefined
        ? existing.reminderAt
        : this.parseDate(dto.reminderAt);
    this.assertSchedule(dueAt, reminderAt);

    const completedAt =
      dto.status === TodoStatus.completed &&
      existing.status !== TodoStatus.completed
        ? new Date()
        : dto.status !== undefined && dto.status !== TodoStatus.completed
          ? null
          : undefined;

    const result = await this.prisma.todo.updateMany({
      where: { id, userId, deletedAt: null },
      data: {
        title: dto.title,
        description: dto.description,
        categoryId: dto.categoryId,
        priority: dto.priority,
        dueAt: dto.dueAt === undefined ? undefined : dueAt,
        reminderAt: dto.reminderAt === undefined ? undefined : reminderAt,
        localNotificationId: dto.localNotificationId,
        status: dto.status,
        isArchived: dto.isArchived,
        completedAt,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('Todo tidak ditemukan');
    }
    return this.findOne(userId, id);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const result = await this.prisma.todo.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException('Todo tidak ditemukan');
    }
    return { id };
  }

  private async assertCategoryOwnership(
    userId: string,
    categoryId: string | null | undefined,
  ): Promise<void> {
    if (!categoryId) return;

    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, userId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Kategori tidak ditemukan');
    }
  }

  private parseDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined;
    return value === null ? null : new Date(value);
  }

  private assertSchedule(
    dueAt: Date | null | undefined,
    reminderAt: Date | null | undefined,
  ): void {
    if (dueAt && reminderAt && reminderAt > dueAt) {
      throw new BadRequestException(
        'Waktu pengingat tidak boleh setelah tenggat todo',
      );
    }
  }
}
