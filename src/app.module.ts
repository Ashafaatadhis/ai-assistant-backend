import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './health/health.controller';
import { TodoModule } from './modules/todo/todo.module';
import { UsersModule } from './modules/users/users.module';

function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const invalid: string[] = [];
  for (const key of [
    'DATABASE_URL',
    'ACCESS_TOKEN_SECRET',
    'ACCESS_TOKEN_TTL',
    'GOOGLE_CLIENT_ID',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'MAIL_FROM',
  ]) {
    if (!config[key]) {
      invalid.push(key);
    }
  }
  const ttlDays = Number(config['REFRESH_TOKEN_TTL_DAYS']);
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
    invalid.push('REFRESH_TOKEN_TTL_DAYS (harus angka positif)');
  }
  const codeTtl = Number(config['CODE_TTL_MINUTES']);
  if (!Number.isFinite(codeTtl) || codeTtl <= 0) {
    invalid.push('CODE_TTL_MINUTES (harus angka positif)');
  }
  const maxAttempts = Number(config['CODE_MAX_ATTEMPTS']);
  if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
    invalid.push('CODE_MAX_ATTEMPTS (harus angka positif)');
  }
  const cooldown = Number(config['RESEND_COOLDOWN_SECONDS']);
  if (!Number.isFinite(cooldown) || cooldown < 0) {
    invalid.push('RESEND_COOLDOWN_SECONDS (harus angka non-negatif)');
  }
  if (invalid.length > 0) {
    throw new Error(`Environment configuration invalid: ${invalid.join(', ')}`);
  }
  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    AuthModule,
    TodoModule,
    UsersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
