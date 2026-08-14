import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ResendCodeDto {
  @ApiProperty({ example: 'budi@example.com' })
  @IsEmail({}, { message: 'email harus alamat email yang valid' })
  email!: string;
}
