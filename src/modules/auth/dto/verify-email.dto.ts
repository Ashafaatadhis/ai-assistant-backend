import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ example: 'budi@example.com' })
  @IsEmail({}, { message: 'email harus alamat email yang valid' })
  email!: string;

  @ApiProperty({ example: '123456' })
  @IsString({ message: 'code harus berupa teks' })
  @Matches(/^\d{6}$/, { message: 'code harus 6 digit angka' })
  code!: string;
}
