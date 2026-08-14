import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class LogoutDto {
  @ApiProperty({ example: '8f3a2b1c64-hex-chars' })
  @IsString({ message: 'refreshToken harus berupa teks' })
  @Matches(/^[0-9a-f]{64}$/, {
    message: 'refreshToken harus 64 karakter hex',
  })
  refreshToken!: string;
}
