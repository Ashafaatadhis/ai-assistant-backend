import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'budi@example.com' })
  @IsEmail({}, { message: 'email harus alamat email yang valid' })
  email!: string;

  @ApiProperty({ example: 'rahasia123' })
  @IsString({ message: 'password harus berupa teks' })
  @MinLength(1, { message: 'password wajib diisi' })
  password!: string;
}
