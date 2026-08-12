import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AppException, AuthErrorCodes } from './auth.errors';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

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

type UserRow = {
  id: string;
  email: string;
  passwordHash: string | null;
  name: string;
  authProvider: 'email' | 'google';
  tier: 'free' | 'premium';
  createdAt: Date;
};

type RefreshTokenRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject('GOOGLE_OAUTH_CLIENT') private readonly oauthClient: OAuth2Client,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
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
    const user = await this.prisma.user.create({
      data: { email, passwordHash, name: dto.name },
    });
    return this.buildAuthResult(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw this.invalidCredentials();
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw this.invalidCredentials();
    }
    return this.buildAuthResult(user);
  }

  async googleAuth(
    dto: GoogleAuthDto,
  ): Promise<AuthResult & { created: boolean }> {
    let email: string | undefined;
    let name: string | undefined;
    try {
      const ticket = await this.oauthClient.verifyIdToken({
        idToken: dto.idToken,
        audience: this.config.get<string>('GOOGLE_CLIENT_ID'),
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
      },
    });
    return { ...(await this.buildAuthResult(user)), created: true };
  }

  async refresh(dto: RefreshDto): Promise<TokenPair> {
    const stored = await this.findValidRefreshToken(dto.refreshToken);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
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

  private async findValidRefreshToken(
    refreshToken: string,
  ): Promise<RefreshTokenRow> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt.getTime() <= Date.now()
    ) {
      throw new AppException(
        AuthErrorCodes.INVALID_REFRESH_TOKEN,
        'Sesi berakhir, silakan masuk lagi',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return stored;
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
}
