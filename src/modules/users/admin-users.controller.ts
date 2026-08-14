import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminCreateUserDto } from './dto/admin-create-user.dto';
import { AdminListUsersDto } from './dto/admin-list-users.dto';
import {
  AdminUpdateRoleDto,
  AdminUpdateStatusDto,
} from './dto/admin-update-user.dto';
import { UserIdParamDto } from './dto/user-id-param.dto';
import { UsersService } from './users.service';

@ApiTags('admin/users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Daftar user untuk admin' })
  list(@Query() query: AdminListUsersDto) {
    return this.usersService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail user untuk admin' })
  findOne(@Param() params: UserIdParamDto) {
    return this.usersService.findOne(params.id);
  }

  @Post()
  @ApiOperation({ summary: 'Buat user yang wajib memverifikasi email' })
  create(@Body() dto: AdminCreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Ubah role user' })
  updateRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UserIdParamDto,
    @Body() dto: AdminUpdateRoleDto,
  ) {
    return this.usersService.updateRole(actor.userId, params.id, dto.role);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Aktifkan atau nonaktifkan user' })
  updateStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UserIdParamDto,
    @Body() dto: AdminUpdateStatusDto,
  ) {
    return this.usersService.updateStatus(
      actor.userId,
      params.id,
      dto.isActive,
    );
  }
}
