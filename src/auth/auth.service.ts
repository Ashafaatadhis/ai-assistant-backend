import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppException, AuthErrorCodes } from './auth.errors';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendCodeDto } from './dto/resend-code.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

const BCRYPT_ROUNDS = 10;

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  authProvider: 'email' | 'google';
  tier: 'free' | 'premium';
}

export interface AuthResult {
  user: UserPublic;
  accessToken: string;
  refreshToken: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface ResendInfo {
  /** ISO 8601 UTC — kapan user boleh kirim ulang kode lagi (dari DB). */
  resendAvailableAt: string;
}

type UserRow = {
  id: string;
  email: string;
  passwordHash: string | null;
  name: string;
  authProvider: 'email' | 'google';
  tier: 'free' | 'premium';
  emailVerifiedAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
    @Inject('GOOGLE_OAUTH_CLIENT') private readonly oauthClient: OAuth2Client,
  ) {}

  async register(dto: RegisterDto): Promise<ResendInfo> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppException(
        AuthErrorCodes.EMAIL_TAKEN,
        'Email sudah terdaftar',
        HttpStatus.CONFLICT,
      );
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    let user: UserRow;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          name: dto.name,
          authProvider: 'email',
          tier: 'free',
          emailVerifiedAt: null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppException(
          AuthErrorCodes.EMAIL_TAKEN,
          'Email sudah terdaftar',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
    return this.createAndSendCode(user.id, email, dto.name);
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw this.invalidCode();
    }
    const code = await this.prisma.verificationCode.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (
      !code ||
      code.expiresAt.getTime() <= Date.now() ||
      code.attempts >= this.codeMaxAttempts()
    ) {
      throw this.invalidCode();
    }
    if (code.codeHash !== this.hashToken(dto.code)) {
      await this.prisma.verificationCode.update({
        where: { id: code.id },
        data: { attempts: { increment: 1 } },
      });
      throw this.invalidCode();
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    await this.prisma.verificationCode.deleteMany({
      where: { userId: user.id },
    });
    return this.buildAuthResult(user);
  }

  async resendCode(dto: ResendCodeDto): Promise<ResendInfo> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Anti-enumeration: bentuk response dibuat sama persis dengan kasus
      // email dikenal (cooldown dari "sekarang").
      return this.resendInfoFrom(Date.now());
    }
    const last = await this.prisma.verificationCode.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    const cooldownSeconds = this.cooldownSeconds();
    if (last) {
      const availableAt =
        last.createdAt.getTime() + cooldownSeconds * 1000;
      const remaining = Math.ceil((availableAt - Date.now()) / 1000);
      if (remaining > 0) {
        throw new AppException(
          AuthErrorCodes.RESEND_TOO_SOON,
          'Tunggu sebentar sebelum mengirim ulang',
          HttpStatus.TOO_MANY_REQUESTS,
          { retryAfterSeconds: remaining },
        );
      }
    }
    return this.createAndSendCode(user.id, user.email, user.name);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw this.invalidCredentials();
    }
    // Cek password dulu — user harus tahu kalau passwordnya salah,
    // baru urusan verifikasi. Lebih sesuai intuisi.
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw this.invalidCredentials();
    }
    if (!user.emailVerifiedAt) {
      throw new AppException(
        AuthErrorCodes.EMAIL_NOT_VERIFIED,
        'Email kamu belum diverifikasi',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.buildAuthResult(user);
  }

  async googleAuth(
    dto: GoogleAuthDto,
  ): Promise<AuthResult & { created: boolean }> {
    const audience = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!audience) {
      throw new Error('GOOGLE_CLIENT_ID is not configured');
    }
    let email: string | undefined;
    let name: string | undefined;
    try {
      const ticket = await this.oauthClient.verifyIdToken({
        idToken: dto.idToken,
        audience,
      });
      const payload = ticket.getPayload();
      email = payload?.email;
      name = payload?.name;
    } catch {
      throw this.invalidCredentials();
    }
    if (!email) {
      throw this.invalidCredentials();
    }
    email = email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return { ...(await this.buildAuthResult(existing)), created: false };
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        name: name ?? email,
        authProvider: 'google',
        passwordHash: null,
        emailVerifiedAt: new Date(),
      },
    });
    return { ...(await this.buildAuthResult(user)), created: true };
  }

  async refresh(dto: RefreshDto): Promise<TokenPair> {
    const tokenHash = this.hashToken(dto.refreshToken);
    const claimed = await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new AppException(
        AuthErrorCodes.INVALID_REFRESH_TOKEN,
        'Sesi berakhir, silakan masuk lagi',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!stored) {
      // Unreachable: updateMany just matched this row.
      throw new AppException(
        AuthErrorCodes.INVALID_REFRESH_TOKEN,
        'Sesi berakhir, silakan masuk lagi',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.issueTokenPair(stored.userId);
  }

  async logout(dto: LogoutDto): Promise<void> {
    const tokenHash = this.hashToken(dto.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!stored || stored.revokedAt) {
      return; // idempotent
    }
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string): Promise<UserPublic & { createdAt: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new AppException(
        AuthErrorCodes.UNAUTHORIZED,
        'Silakan masuk terlebih dahulu',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return {
      ...this.toPublicUser(user),
      createdAt: user.createdAt.toISOString(),
    };
  }

  private async buildAuthResult(user: UserRow): Promise<AuthResult> {
    const pair = await this.issueTokenPair(user.id);
    return { user: this.toPublicUser(user), ...pair };
  }

  private async issueTokenPair(userId: string): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync({ sub: userId });
    const refreshToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(refreshToken);
    const ttlDays = Number(this.config.get('REFRESH_TOKEN_TTL_DAYS') ?? 30);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });
    return { accessToken, refreshToken };
  }

  private async createAndSendCode(
    userId: string,
    email: string,
    name: string,
  ): Promise<ResendInfo> {
    await this.prisma.verificationCode.deleteMany({ where: { userId } });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ttlMinutes = Number(this.config.get('CODE_TTL_MINUTES') ?? 10);
    const createdAt = Date.now();
    const expiresAt = new Date(createdAt + ttlMinutes * 60 * 1000);
    await this.prisma.verificationCode.create({
      data: {
        userId,
        codeHash: this.hashToken(code),
        expiresAt,
      },
    });
    try {
      await this.mailService.sendVerificationCode(email, name, code);
    } catch (error) {
      // SMTP failure must not cancel registration; user can resend-code.
      this.logger.error(`Gagal mengirim email verifikasi ke ${email}`, error);
    }
    return this.resendInfoFrom(createdAt);
  }

  private resendInfoFrom(codeCreatedAtMs: number): ResendInfo {
    const availableAt = new Date(
      codeCreatedAtMs + this.cooldownSeconds() * 1000,
    );
    return { resendAvailableAt: availableAt.toISOString() };
  }

  private cooldownSeconds(): number {
    return Number(this.config.get('RESEND_COOLDOWN_SECONDS') ?? 60);
  }

  private codeMaxAttempts(): number {
    return Number(this.config.get('CODE_MAX_ATTEMPTS') ?? 5);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toPublicUser(user: UserRow): UserPublic {
    const { id, email, name, authProvider, tier } = user;
    return { id, email, name, authProvider, tier };
  }

  private invalidCredentials(): AppException {
    return new AppException(
      AuthErrorCodes.INVALID_CREDENTIALS,
      'Email atau password salah',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private invalidCode(): AppException {
    return new AppException(
      AuthErrorCodes.INVALID_CODE,
      'Kode tidak valid atau sudah kedaluwarsa',
      HttpStatus.BAD_REQUEST,
    );
  }
}
