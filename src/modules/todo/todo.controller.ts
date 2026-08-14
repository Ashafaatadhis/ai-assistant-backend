import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SuccessMessage } from '../../common/success-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateTodoDto } from './dto/create-todo.dto';
import { ListTodosDto } from './dto/list-todos.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { TodoService } from './todo.service';

@ApiTags('todo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.member)
@Controller('todo')
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  @Post()
  @SuccessMessage('Todo berhasil dibuat')
  @ApiOperation({ summary: 'Buat todo baru' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTodoDto) {
    return this.todoService.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Daftar todo milik user dengan filter dan pagination',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTodosDto,
  ) {
    return this.todoService.findAll(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail todo milik user' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.todoService.findOne(user.userId, id);
  }

  @Patch(':id')
  @SuccessMessage('Todo berhasil diperbarui')
  @ApiOperation({ summary: 'Perbarui todo, status, atau arsip' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTodoDto,
  ) {
    return this.todoService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @SuccessMessage('Todo berhasil dihapus')
  @ApiOperation({ summary: 'Soft delete todo' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.todoService.remove(user.userId, id);
  }
}
