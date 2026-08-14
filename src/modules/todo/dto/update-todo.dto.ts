import { ApiPropertyOptional } from '@nestjs/swagger';
import { TodoPriority, TodoStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateTodoDto {
  @ApiPropertyOptional({ maxLength: 160 })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string | null;

  @ApiPropertyOptional({ enum: TodoPriority })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(TodoPriority)
  priority?: TodoPriority;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsDateString()
  reminderAt?: string | null;

  @ApiPropertyOptional({ maxLength: 255, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  localNotificationId?: string | null;

  @ApiPropertyOptional({ enum: TodoStatus })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(TodoStatus)
  status?: TodoStatus;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isArchived?: boolean;
}
