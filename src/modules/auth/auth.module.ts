import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { OAuth2Client } from 'google-auth-library';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
 
import { PrismaModule } from '../../common/prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    MailModule,
    PrismaModule,
    PassportModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('ACCESS_TOKEN_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('ACCESS_TOKEN_TTL') ?? '15m',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: 'GOOGLE_OAUTH_CLIENT',
      useFactory: (config: ConfigService) =>
        new OAuth2Client(config.get<string>('GOOGLE_CLIENT_ID')),
      inject: [ConfigService],
    },
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
