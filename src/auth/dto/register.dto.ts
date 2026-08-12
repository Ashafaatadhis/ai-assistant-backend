import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'budi@example.com' })
  @IsEmail({}, { message: 'email harus alamat email yang valid' })
  email!: string;

  @ApiProperty({ example: 'rahasia123', minLength: 8, maxLength: 72 })
  @IsString({ message: 'password harus berupa teks' })
  @Length(8, 72, {
    message: 'password minimal 8 karakter dan maksimal 72 karakter',
  })
  password!: string;

  @ApiProperty({ example: 'Budi', minLength: 1, maxLength: 100 })
  @IsString({ message: 'name harus berupa teks' })
  @Length(1, 100, {
    message: 'name minimal 1 karakter dan maksimal 100 karakter',
  })
  name!: string;
}
