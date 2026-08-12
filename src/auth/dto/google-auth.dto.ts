import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({ example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...' })
  @IsString({ message: 'idToken harus berupa teks' })
  @MinLength(1, { message: 'idToken wajib diisi' })
  idToken!: string;
}
