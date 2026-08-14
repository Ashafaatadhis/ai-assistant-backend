import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider, Prisma, User, UserRole, UserTier } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AppException, AuthErrorCodes } from './auth.errors';
import { RequestMetadata } from './interfaces/authenticated-user.interface';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendCodeDto } from './dto/resend-code.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

const BCRYPT_ROUNDS = 10;

type UserRow = Pick<
  User,
  | 'id'
  | 'email'
  | 'passwordHash'
  | 'name'
  | 'authProvider'
  | 'tier'
  | 'role'
  | 'emailVerifiedAt'
  | 'isActive'
  | 'createdAt'
  | 'deletedAt'
>;

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  authProvider: AuthProvider;
  tier: UserTier;
  role: UserRole;
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
  resendAvailableAt: string;
}

export interface ProvisionedUser {
  user: UserPublic;
  resendAvailableAt: string;
}

interface TokenMaterial extends TokenPair {
  tokenHash: string;
  expiresAt: Date;
}

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
    const result = await this.provisionEmailUser(dto, UserRole.member);
    return { resendAvailableAt: result.resendAvailableAt };
  }

  async registerByAdmin(
    dto: RegisterDto,
    role: UserRole,
  ): Promise<ProvisionedUser> {
    return this.provisionEmailUser(dto, role);
  }

  async verifyEmail(
    dto: VerifyEmailDto,
    metadata: RequestMetadata = {},
  ): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive || user.deletedAt) {
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

    const token = await this.createTokenMaterial(user.id);
    const verifiedUser = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date(), lastLoginAt: new Date() },
      });
      await tx.verificationCode.deleteMany({ where: { userId: user.id } });
      await this.storeRefreshToken(tx, user.id, token, metadata);
      return updated;
    });
    return {
      user: this.toPublicUser(verifiedUser),
      ...this.toTokenPair(token),
    };
  }

  async resendCode(dto: ResendCodeDto): Promise<ResendInfo> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive || user.deletedAt) {
      return this.resendInfoFrom(Date.now());
    }
    const last = await this.prisma.verificationCode.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (last) {
      const availableAt =
        last.createdAt.getTime() + this.cooldownSeconds() * 1000;
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
    return this.replaceAndSendCode(user.id, user.email, user.name);
  }

  async login(
    dto: LoginDto,
    metadata: RequestMetadata = {},
  ): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) {
      throw this.invalidCredentials();
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw this.invalidCredentials();
    }
    this.assertActive(user);
    if (!user.emailVerifiedAt) {
      throw new AppException(
        AuthErrorCodes.EMAIL_NOT_VERIFIED,
        'Email kamu belum diverifikasi',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.buildAuthResult(user, metadata, true);
  }

  async googleAuth(
    dto: GoogleAuthDto,
    metadata: RequestMetadata = {},
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
      this.assertActive(existing);
      return {
        ...(await this.buildAuthResult(existing, metadata, true)),
        created: false,
      };
    }

    const tokenUserId = randomUUID();
    const token = await this.createTokenMaterial(tokenUserId);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: tokenUserId,
          email,
          name: name ?? email,
          authProvider: AuthProvider.google,
          passwordHash: null,
          tier: UserTier.free,
          role: UserRole.member,
          emailVerifiedAt: new Date(),
          lastLoginAt: new Date(),
          profile: { create: {} },
        },
      });
      await this.storeRefreshToken(tx, created.id, token, metadata);
      return created;
    });
    return {
      user: this.toPublicUser(user),
      ...this.toTokenPair(token),
      created: true,
    };
  }

  async refresh(
    dto: RefreshDto,
    metadata: RequestMetadata = {},
  ): Promise<TokenPair> {
    const tokenHash = this.hashToken(dto.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt.getTime() <= Date.now() ||
      !stored.user.isActive ||
      stored.user.deletedAt
    ) {
      throw this.invalidRefreshToken();
    }
    const replacement = await this.createTokenMaterial(stored.userId);
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: {
          id: stored.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });
      if (result.count === 0) {
        return false;
      }
      await this.storeRefreshToken(tx, stored.userId, replacement, metadata);
      return true;
    });
    if (!claimed) {
      throw this.invalidRefreshToken();
    }
    return this.toTokenPair(replacement);
  }

  async logout(dto: LogoutDto): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(dto.refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user || !user.isActive || user.deletedAt) {
      throw new AppException(
        AuthErrorCodes.UNAUTHORIZED,
        'Silakan masuk terlebih dahulu',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return {
      ...this.toPublicUser(user),
      createdAt: user.createdAt.toISOString(),
      profile: user.profile
        ? {
            avatarUrl: user.profile.avatarUrl,
            bio: user.profile.bio,
            phoneNumber: user.profile.phoneNumber,
            gender: user.profile.gender,
            dateOfBirth: user.profile.dateOfBirth?.toISOString() ?? null,
            timezone: user.profile.timezone,
            locale: user.profile.locale,
          }
        : null,
    };
  }

  private async provisionEmailUser(
    dto: RegisterDto,
    role: UserRole,
  ): Promise<ProvisionedUser> {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw this.emailTaken();
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const createdAt = Date.now();
    const expiresAt = new Date(createdAt + this.codeTtlMinutes() * 60 * 1000);
    let user: UserRow;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            name: dto.name,
            authProvider: AuthProvider.email,
            tier: UserTier.free,
            role,
            emailVerifiedAt: null,
            profile: { create: {} },
          },
        });
        await tx.verificationCode.create({
          data: {
            userId: created.id,
            codeHash: this.hashToken(code),
            expiresAt,
          },
        });
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.emailTaken();
      }
      throw error;
    }
    await this.sendCode(email, dto.name, code);
    return {
      user: this.toPublicUser(user),
      ...this.resendInfoFrom(createdAt),
    };
  }

  private async buildAuthResult(
    user: UserRow,
    metadata: RequestMetadata,
    updateLastLogin: boolean,
  ): Promise<AuthResult> {
    const token = await this.createTokenMaterial(user.id);
    const currentUser = await this.prisma.$transaction(async (tx) => {
      const updated = updateLastLogin
        ? await tx.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          })
        : user;
      await this.storeRefreshToken(tx, user.id, token, metadata);
      return updated;
    });
    return { user: this.toPublicUser(currentUser), ...this.toTokenPair(token) };
  }

  private async replaceAndSendCode(
    userId: string,
    email: string,
    name: string,
  ): Promise<ResendInfo> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const createdAt = Date.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.verificationCode.deleteMany({ where: { userId } });
      await tx.verificationCode.create({
        data: {
          userId,
          codeHash: this.hashToken(code),
          expiresAt: new Date(createdAt + this.codeTtlMinutes() * 60 * 1000),
        },
      });
    });
    await this.sendCode(email, name, code);
    return this.resendInfoFrom(createdAt);
  }

  private async sendCode(
    email: string,
    name: string,
    code: string,
  ): Promise<void> {
    try {
      await this.mailService.sendVerificationCode(email, name, code);
    } catch (error) {
      this.logger.error(`Gagal mengirim email verifikasi ke ${email}`, error);
    }
  }

  private async createTokenMaterial(userId: string): Promise<TokenMaterial> {
    const accessToken = await this.jwtService.signAsync({ sub: userId });
    const refreshToken = randomBytes(32).toString('hex');
    const ttlDays = Number(this.config.get('REFRESH_TOKEN_TTL_DAYS') ?? 30);
    return {
      accessToken,
      refreshToken,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    };
  }

  private async storeRefreshToken(
    tx: Prisma.TransactionClient,
    userId: string,
    token: TokenMaterial,
    metadata: RequestMetadata,
  ): Promise<void> {
    await tx.refreshToken.create({
      data: {
        userId,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null,
      },
    });
  }

  private toTokenPair(token: TokenMaterial): TokenPair {
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
    };
  }

  private toPublicUser(user: UserRow): UserPublic {
    const { id, email, name, authProvider, tier, role } = user;
    return { id, email, name, authProvider, tier, role };
  }

  private assertActive(user: Pick<User, 'isActive' | 'deletedAt'>): void {
    if (!user.isActive || user.deletedAt) {
      throw new AppException(
        AuthErrorCodes.ACCOUNT_DISABLED,
        'Akun kamu dinonaktifkan',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private resendInfoFrom(codeCreatedAtMs: number): ResendInfo {
    return {
      resendAvailableAt: new Date(
        codeCreatedAtMs + this.cooldownSeconds() * 1000,
      ).toISOString(),
    };
  }

  private cooldownSeconds(): number {
    return Number(this.config.get('RESEND_COOLDOWN_SECONDS') ?? 60);
  }

  private codeTtlMinutes(): number {
    return Number(this.config.get('CODE_TTL_MINUTES') ?? 10);
  }

  private codeMaxAttempts(): number {
    return Number(this.config.get('CODE_MAX_ATTEMPTS') ?? 5);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private emailTaken(): AppException {
    return new AppException(
      AuthErrorCodes.EMAIL_TAKEN,
      'Email sudah terdaftar',
      HttpStatus.CONFLICT,
    );
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

  private invalidRefreshToken(): AppException {
    return new AppException(
      AuthErrorCodes.INVALID_REFRESH_TOKEN,
      'Sesi berakhir, silakan masuk lagi',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
