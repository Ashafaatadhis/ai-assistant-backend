import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TodoPriority } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTodoDto {
  @ApiProperty({ example: 'Bayar tagihan listrik', maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title!: string;

  @ApiPropertyOptional({ example: 'Bayar sebelum jatuh tempo' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string | null;

  @ApiPropertyOptional({ enum: TodoPriority, default: TodoPriority.medium })
  @IsOptional()
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
}
