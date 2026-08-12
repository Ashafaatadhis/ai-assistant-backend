# Aria Backend — Auth Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Aria auth backend (register, login, Google sign-in, refresh rotation, logout, profile, health) per `docs/2026-08-12-backend-auth-prd.md` and API contract v2 (`docs/2026-08-12-backend-auth-api-contract.md`).

**Architecture:** NestJS 10 modular monolith: thin controllers → service business logic → Prisma/PostgreSQL. Every response (success and error) wrapped in the `{ success, message, data, error? }` envelope via a global interceptor + global exception filter. Access tokens are short-lived JWTs; refresh tokens are random 64-hex strings stored as SHA-256 hashes with rotation.

**Tech Stack:** NestJS 10, TypeScript strict, Prisma + local PostgreSQL (user `postgres`, password `root` — NO Docker), `@nestjs/jwt` + passport-jwt, bcrypt, class-validator, `@nestjs/throttler`, `@nestjs/swagger`, google-auth-library, Jest + supertest.

## Global Constraints

- Node >= 20. NestJS 10.x. TypeScript `strict: true`.
- Database: LOCAL PostgreSQL, credentials `postgres` / `root` (dev DB `aria`, test DB `aria_test`). Do NOT use Docker.
- EVERY response uses the envelope `{ success: boolean, message: string, data: T | null, error?: string }` — success via global interceptor, errors via global exception filter (contract v2 §2).
- `message` is human-facing Indonesian text; `error` is a machine code, UPPER_SNAKE_CASE, only present on errors.
- Error codes (contract v2 §2): `VALIDATION_ERROR` 400 ("Periksa kembali isian kamu"), `EMAIL_TAKEN` 409 ("Email sudah terdaftar"), `INVALID_CREDENTIALS` 401 ("Email atau password salah"), `INVALID_REFRESH_TOKEN` 401 ("Sesi berakhir, silakan masuk lagi"), `UNAUTHORIZED` 401 ("Silakan masuk terlebih dahulu"), `RATE_LIMIT_EXCEEDED` 429 ("Terlalu banyak permintaan, coba lagi nanti").
- `passwordHash` must NEVER appear in any response.
- Access token: JWT HS256, payload ONLY `{ sub: userId }`, TTL 15m (`ACCESS_TOKEN_TTL`). Refresh token: `crypto.randomBytes(32).toString('hex')`, DB stores SHA-256 hash only, TTL 30 days (`REFRESH_TOKEN_TTL_DAYS`), rotation on every `/refresh`.
- Password: bcrypt cost 10; register password 8–72 chars; login password min 1 char.
- All login failures (unknown email / wrong password / Google account via form) return identical 401 `INVALID_CREDENTIALS` (anti email-enumeration). Logout is idempotent. New users are always tier `free`.
- Rate limit 20 requests/minute/IP on auth routes → 429 envelope. CORS open in dev.
- Email stored lowercase. Google sign-in verifies Flutter-provided ID token via Google OAuth2Client with `GOOGLE_CLIENT_ID`.
- No endpoints beyond the contract. No large libraries beyond the stack above.

---

### Task 1: Project scaffold, dependencies, and app bootstrap

**Files:**
- Create: `package.json`
- Create: `.gitignore`, `.prettierrc`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `eslint.config.mjs`
- Create: `.env`, `.env.example`
- Create: `src/main.ts`, `src/app.module.ts`, `src/health/health.controller.ts`

**Interfaces:**
- Produces: npm scripts (`build`, `start:dev`, `lint`, `test`, `test:e2e`), `AppModule` (later tasks add providers to it), bootstrap conventions used by every later task: `setGlobalPrefix('api')`, global `ValidationPipe`, global `ResponseInterceptor`, global `AllExceptionsFilter`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "aria-backend",
  "version": "0.1.0",
  "description": "Aria AI assistant backend — auth module",
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "nest build",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json --runInBand"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.15",
    "@nestjs/config": "^3.3.0",
    "@nestjs/core": "^10.4.15",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/platform-express": "^10.4.15",
    "@nestjs/swagger": "^8.1.1",
    "@nestjs/throttler": "^6.4.0",
    "@prisma/client": "^5.22.0",
    "bcrypt": "^5.1.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "google-auth-library": "^9.15.1",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@eslint/eslintrc": "^3.2.0",
    "@eslint/js": "^9.18.0",
    "@nestjs/cli": "^10.4.9",
    "@nestjs/schematics": "^10.2.3",
    "@nestjs/testing": "^10.4.15",
    "@types/bcrypt": "^5.0.2",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.7",
    "@types/passport-jwt": "^4.0.1",
    "@types/supertest": "^6.0.2",
    "eslint": "^9.18.0",
    "eslint-config-prettier": "^9.1.0",
    "globals": "^15.14.0",
    "jest": "^29.7.0",
    "jest-mock-extended": "^3.0.7",
    "prettier": "^3.4.2",
    "prisma": "^5.22.0",
    "source-map-support": "^0.5.21",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "ts-loader": "^9.5.2",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.7.3",
    "typescript-eslint": "^8.21.0"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.ts$": "ts-jest" },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: completes without errors. If `bcrypt` fails to build, install Visual C++ Build Tools or use `npm install bcrypt --build-from-source=false` — prebuilt binaries for Node 22 Windows x64 normally exist.

- [ ] **Step 3: Write config files**

`.gitignore`:
```
node_modules/
dist/
coverage/
.env
*.log
```

`.prettierrc`:
```json
{ "singleQuote": true, "trailingComma": "all" }
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true
  }
}
```

`tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

`nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

`eslint.config.mjs`:
```js
// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'coverage'],
  },
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['test/**/*.ts', '**/*.spec.ts'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
  eslintConfigPrettier,
);
```

- [ ] **Step 4: Write `.env` and `.env.example`**

Both files have identical content for now (`.env` is gitignored, `.env.example` is committed):

```env
DATABASE_URL="postgresql://postgres:root@localhost:5432/aria?schema=public"
TEST_DATABASE_URL="postgresql://postgres:root@localhost:5432/aria_test?schema=public"
ACCESS_TOKEN_SECRET="dev-secret-change-me-in-production"
ACCESS_TOKEN_TTL="15m"
REFRESH_TOKEN_TTL_DAYS="30"
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
PORT=3000
```

Note: PRD's example used a Docker `aria` user; we use the developer's local PostgreSQL (`postgres`/`root`) instead. `TEST_DATABASE_URL` is for the e2e suite.

- [ ] **Step 5: Write `src/main.ts`, `src/app.module.ts`, `src/health/health.controller.ts`**

`src/main.ts` (the interceptor/filter imports resolve in Task 2 — leave this exact content):
```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, stopAtFirstError: true }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Aria backend listening on http://localhost:${port}/api`);
}

void bootstrap();
```

`src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController],
})
export class AppModule {}
```

`src/health/health.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check' })
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 6: Initialize git and commit**

Run:
```bash
git init
git add .
git commit -m "chore: scaffold NestJS project with health endpoint"
```
Expected: commit created. (No lint yet — `src/main.ts` references Task 2 files.)

---

### Task 2: Response envelope — interceptor + exception filter

**Files:**
- Create: `src/common/response.interceptor.ts`
- Create: `src/common/http-exception.filter.ts`
- Test: `src/common/response.interceptor.spec.ts`
- Test: `src/common/http-exception.filter.spec.ts`

**Interfaces:**
- Consumes: nothing (plain NestJS classes).
- Produces: `ResponseInterceptor` (wraps every success payload into `{ success: true, message: 'OK', data }`) and `AllExceptionsFilter` (maps every exception to `{ success: false, message, data, error }` envelope with the contract's error codes). Registered globally in `main.ts` (already written in Task 1) and re-registered in e2e apps later.

- [ ] **Step 1: Write the failing interceptor test** — `src/common/response.interceptor.spec.ts`:

```ts
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  const ctx = {} as ExecutionContext;
  const handler = (payload: unknown): CallHandler =>
    ({ handle: () => of(payload) }) as unknown as CallHandler;

  it('wraps a payload in the success envelope', (done) => {
    const interceptor = new ResponseInterceptor();
    interceptor.intercept(ctx, handler({ id: 'x' })).subscribe((result) => {
      expect(result).toEqual({ success: true, message: 'OK', data: { id: 'x' } });
      done();
    });
  });

  it('maps undefined handler output to data: null', (done) => {
    const interceptor = new ResponseInterceptor();
    interceptor.intercept(ctx, handler(undefined)).subscribe((result) => {
      expect(result).toEqual({ success: true, message: 'OK', data: null });
      done();
    });
  });

  it('passes through an explicit null payload', (done) => {
    const interceptor = new ResponseInterceptor();
    interceptor.intercept(ctx, handler(null)).subscribe((result) => {
      expect(result).toEqual({ success: true, message: 'OK', data: null });
      done();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/common/response.interceptor.spec.ts`
Expected: FAIL — "Cannot find module './response.interceptor'".

- [ ] **Step 3: Write `src/common/response.interceptor.ts`**

```ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ResponseEnvelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ResponseEnvelope<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ResponseEnvelope<T>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        message: 'OK',
        data: data === undefined ? null : data,
      })),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/common/response.interceptor.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing exception-filter test** — `src/common/http-exception.filter.spec.ts`:

```ts
import {
  ArgumentsHost,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';
import { AppException } from '../auth/auth.errors';

describe('AllExceptionsFilter', () => {
  let status: jest.Mock;
  let json: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    host = {
      switchToHttp: () => ({ getResponse: () => ({ status, json }) }),
    } as unknown as ArgumentsHost;
  });

  it('maps validation errors (message array) to VALIDATION_ERROR with details', () => {
    new AllExceptionsFilter().catch(
      new BadRequestException(['email harus alamat email yang valid']),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Periksa kembali isian kamu',
      data: { details: ['email harus alamat email yang valid'] },
      error: 'VALIDATION_ERROR',
    });
  });

  it('maps plain HttpException message string through, with code by status', () => {
    new AllExceptionsFilter().catch(
      new UnauthorizedException('Silakan masuk terlebih dahulu'),
      host,
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Silakan masuk terlebih dahulu',
      data: null,
      error: 'UNAUTHORIZED',
    });
  });

  it('keeps AppException code and human message intact', () => {
    new AllExceptionsFilter().catch(
      new AppException('EMAIL_TAKEN', 'Email sudah terdaftar', 409),
      host,
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Email sudah terdaftar',
      data: null,
      error: 'EMAIL_TAKEN',
    });
  });

  it('maps unknown exceptions to 500 INTERNAL_ERROR', () => {
    new AllExceptionsFilter().catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Terjadi kesalahan tak terduga',
      data: null,
      error: 'INTERNAL_ERROR',
    });
  });
});
```

NOTE: this test imports `AppException` from `../auth/auth.errors`, created in Step 6 below AND in Task 4. Create `src/auth/auth.errors.ts` now with the exact content in Task 4 Step 2 (reproduced in Step 6 here) so this test compiles.

- [ ] **Step 6: Run test to verify it fails, then write the filter + error constants**

Run: `npx jest src/common/http-exception.filter.spec.ts`
Expected: FAIL — cannot resolve `./http-exception.filter` / `../auth/auth.errors`.

Write `src/auth/auth.errors.ts`:
```ts
import { HttpStatus } from '@nestjs/common';

export const AuthErrorCodes = {
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;

export type AuthErrorCode =
  (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes];

/**
 * Business exception carrying a machine-readable code, an Indonesian
 * human-readable message, and an HTTP status. AllExceptionsFilter
 * serializes it into the contract envelope.
 */
export class AppException extends Error {
  constructor(
    readonly code: string,
    readonly humanMessage: string,
    readonly httpStatus: number = HttpStatus.BAD_REQUEST,
  ) {
    super(humanMessage);
    this.name = 'AppException';
  }
}
```

Write `src/common/http-exception.filter.ts`:
```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';

interface ErrorEnvelope {
  success: false;
  message: string;
  data: { details: string[] } | null;
  error: string;
}

const RATE_LIMIT_MESSAGE = 'Terlalu banyak permintaan, coba lagi nanti';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, message, details } = this.parse(exception);

    this.logger.warn(
      `${status} ${message}${details ? ` — ${details.join('; ')}` : ''}`,
    );

    const body: ErrorEnvelope = {
      success: false,
      message,
      data: details ? { details } : null,
      error: this.toErrorCode(status),
    };
    response.status(status).json(body);
  }

  private parse(exception: unknown): {
    status: number;
    message: string;
    details?: string[];
  } {
    if (exception instanceof ThrottlerException) {
      return { status: HttpStatus.TOO_MANY_REQUESTS, message: RATE_LIMIT_MESSAGE };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return { status, message: res };
      }
      const body = res as { message?: string | string[] };
      if (Array.isArray(body.message)) {
        return {
          status,
          message: 'Periksa kembali isian kamu',
          details: body.message,
        };
      }
      if (typeof body.message === 'string') {
        return { status, message: body.message };
      }
      return { status, message: exception.message };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Terjadi kesalahan tak terduga',
    };
  }

  private toErrorCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
      case HttpStatus.FORBIDDEN:
        return 'UNAUTHORIZED';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMIT_EXCEEDED';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest src/common`
Expected: PASS (7 tests total across both files).

- [ ] **Step 8: Verify lint + build, commit**

Run: `npm run lint` — Expected: no errors.
Run: `npm run build` — Expected: compiles cleanly.

Commit:
```bash
git add src/common src/auth/auth.errors.ts
git commit -m "feat: response envelope interceptor and exception filter"
```

---

### Task 3: Prisma module, schema, and first migration

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/prisma/prisma.module.ts`
- Create: `src/prisma/prisma.service.ts`
- Modify: `src/app.module.ts` (register `PrismaModule`)

**Interfaces:**
- Consumes: `.env` `DATABASE_URL` (Task 1).
- Produces: `PrismaService` (extends `PrismaClient`, exported from global `PrismaModule`) and generated client types (`User`, `RefreshToken`, `AuthProvider`, `UserTier`) used by AuthService (Task 5).

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AuthProvider {
  email
  google
}

enum UserTier {
  free
  premium
}

model User {
  id            String         @id @default(uuid())
  email         String         @unique
  passwordHash  String?
  name          String
  authProvider  AuthProvider   @default(email)
  tier          UserTier       @default(free)
  createdAt     DateTime       @default(now())
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String    @unique
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
}
```

- [ ] **Step 2: Write `src/prisma/prisma.service.ts` and `src/prisma/prisma.module.ts`**

```ts
// src/prisma/prisma.service.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

```ts
// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 3: Register PrismaModule in `src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 4: Create the migration against the local database**

Run: `npx prisma migrate dev --name init_auth`
Expected: Prisma connects to `postgresql://postgres:root@localhost:5432/aria`, creates the `aria` database if it does not exist (the `postgres` superuser can), generates `prisma/migrations/<timestamp>_init_auth/migration.sql`, runs it, and generates the client.

If the connection fails, verify PostgreSQL is running locally and credentials are `postgres`/`root`; adjust `.env` `DATABASE_URL` accordingly. If database auto-creation is refused, create it manually (`CREATE DATABASE aria;`) and rerun.

- [ ] **Step 5: Verify build, commit**

Run: `npm run build` — Expected: compiles cleanly (generated `@prisma/client` types resolve).

Commit:
```bash
git add prisma src/prisma src/app.module.ts .env.example
git commit -m "feat: Prisma schema with User and RefreshToken, first migration"
```

---

### Task 4: Error constants and DTOs

**Files:**
- Already created in Task 2 Step 6: `src/auth/auth.errors.ts` (verify only)
- Create: `src/auth/dto/register.dto.ts`
- Create: `src/auth/dto/login.dto.ts`
- Create: `src/auth/dto/google-auth.dto.ts`
- Create: `src/auth/dto/refresh.dto.ts`
- Create: `src/auth/dto/logout.dto.ts`

**Interfaces:**
- Consumes: `class-validator`, `@nestjs/swagger`.
- Produces: `RegisterDto` (`email`, `password`, `name`), `LoginDto` (`email`, `password`), `GoogleAuthDto` (`idToken`), `RefreshDto` / `LogoutDto` (`refreshToken`) — consumed by AuthController (Task 6). Validation messages are Indonesian and surface in the envelope's `data.details` on 400.

- [ ] **Step 1: Verify `src/auth/auth.errors.ts` matches Task 2 Step 6 content exactly**

Run: `git status` and read the file. Expected: present, committed, no changes needed.

- [ ] **Step 2: Write the five DTO files**

`src/auth/dto/register.dto.ts`:
```ts
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
```

`src/auth/dto/login.dto.ts`:
```ts
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
```

`src/auth/dto/google-auth.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({ example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...' })
  @IsString({ message: 'idToken harus berupa teks' })
  @MinLength(1, { message: 'idToken wajib diisi' })
  idToken!: string;
}
```

`src/auth/dto/refresh.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ example: '8f3a2b1c64-hex-chars' })
  @IsString({ message: 'refreshToken harus berupa teks' })
  @Matches(/^[0-9a-f]{64}$/, {
    message: 'refreshToken harus 64 karakter hex',
  })
  refreshToken!: string;
}
```

`src/auth/dto/logout.dto.ts`:
```ts
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
```

- [ ] **Step 3: Verify lint + build, commit**

Run: `npm run lint` — Expected: clean.
Run: `npm run build` — Expected: clean.

Commit:
```bash
git add src/auth
git commit -m "feat: auth DTOs with Indonesian validation messages"
```

### Task 5: AuthService + JwtStrategy + unit tests (TDD)

**Files:**
- Create: `src/auth/auth.service.ts`
- Create: `src/auth/jwt.strategy.ts`
- Test: `src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 3), `AppException` + `AuthErrorCodes` (Task 2/4), `JwtService` (`@nestjs/jwt`), `ConfigService` (`@nestjs/config`), `OAuth2Client` (`google-auth-library`, provider token `GOOGLE_OAUTH_CLIENT`).
- Produces: `AuthService` used by AuthController (Task 6) — methods `register`, `login`, `googleAuth` (returns `AuthResult & { created: boolean }` so the controller can return 201 for new users / 200 for existing users per contract), `refresh`, `logout`, `getMe`; `JwtStrategy` used by `JwtAuthGuard` (Task 6). User objects returned by the service NEVER contain `passwordHash` (removed via destructuring). Types: `AuthResult = { user: UserPublic; accessToken: string; refreshToken: string }`, `UserPublic = { id, email, name, authProvider, tier }`.

- [ ] **Step 1: Write the failing unit tests** — `src/auth/auth.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { deepMock, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { AppException, AuthErrorCodes } from './auth.errors';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: DeepMockProxy<PrismaService>;
  let oauthClient: DeepMockProxy<OAuth2Client>;

  const userRecord = {
    id: 'user-1',
    email: 'budi@example.com',
    passwordHash: '$2b$10$hashed',
    name: 'Budi',
    authProvider: 'email' as const,
    tier: 'free' as const,
    createdAt: new Date('2026-08-12T09:30:00.000Z'),
  };

  beforeEach(async () => {
    prisma = deepMock<PrismaService>();
    oauthClient = deepMock<OAuth2Client>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => {
          const env: Record<string, string> = {
            ACCESS_TOKEN_SECRET: 'test-secret',
            ACCESS_TOKEN_TTL: '15m',
            REFRESH_TOKEN_TTL_DAYS: '30',
          };
          return env[key];
        }) } },
        { provide: 'GOOGLE_OAUTH_CLIENT', useValue: oauthClient },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  const mockTokenPair = (): void => {
    prisma.user.findUnique.mockResolvedValue(userRecord);
    prisma.refreshToken.create.mockResolvedValue({
      id: 'rt-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
    });
  };

  describe('register', () => {
    it('hashes the password with bcrypt and creates the user', async () => {
      mockTokenPair();
      prisma.user.findUnique.mockResolvedValueOnce(null); // email check
      prisma.user.create.mockResolvedValueOnce(userRecord);

      await service.register({
        email: 'Budi@Example.com',
        password: 'rahasia123',
        name: 'Budi',
      });

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs?.data.email).toBe('budi@example.com'); // lowercased
      expect(createArgs?.data.authProvider).toBe('email');
      expect(createArgs?.data.tier).toBe('free');
      const hash = createArgs?.data.passwordHash as string;
      expect(hash).not.toBe('rahasia123');
      expect(bcrypt.compareSync('rahasia123', hash)).toBe(true);
    });

    it('rejects a duplicate email with EMAIL_TAKEN', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(userRecord);

      await expect(
        service.register({
          email: 'budi@example.com',
          password: 'rahasia123',
          name: 'Budi',
        }),
      ).rejects.toMatchObject({ code: AuthErrorCodes.EMAIL_TAKEN });
    });
  });

  describe('login', () => {
    it('verifies the password and returns tokens on success', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(userRecord);
      mockTokenPair();
      const realHash = await bcrypt.hash('rahasia123', 4);
      prisma.user.findUnique.mockReset();
      prisma.user.findUnique.mockResolvedValueOnce({
        ...userRecord,
        passwordHash: realHash,
      });
      prisma.user.findUnique.mockResolvedValueOnce(userRecord);

      const result = await service.login({
        email: 'budi@example.com',
        password: 'rahasia123',
      });

      expect(result.user.id).toBe('user-1');
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each([
      ['unknown email', null],
      ['google account without password', { ...userRecord, passwordHash: null }],
    ])('returns INVALID_CREDENTIALS for %s', async (_label, found) => {
      prisma.user.findUnique.mockResolvedValueOnce(
        found as typeof userRecord | null,
      );

      await expect(
        service.login({ email: 'budi@example.com', password: 'whatever' }),
      ).rejects.toMatchObject({ code: AuthErrorCodes.INVALID_CREDENTIALS });
    });

    it('returns INVALID_CREDENTIALS for a wrong password', async () => {
      const realHash = await bcrypt.hash('rahasia123', 4);
      prisma.user.findUnique.mockResolvedValueOnce({
        ...userRecord,
        passwordHash: realHash,
      });

      await expect(
        service.login({ email: 'budi@example.com', password: 'salah' }),
      ).rejects.toMatchObject({ code: AuthErrorCodes.INVALID_CREDENTIALS });
    });
  });

  describe('googleAuth', () => {
    const tokenPayload = {
      email: 'budi@gmail.com',
      name: 'Budi G',
      aud: 'google-client-id',
    };

    it('creates a google user when the email is new', async () => {
      oauthClient.verifyIdToken.mockResolvedValue({
        getPayload: () => tokenPayload,
      } as never);
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValueOnce({
        ...userRecord,
        email: 'budi@gmail.com',
        authProvider: 'google',
        passwordHash: null,
      });
      mockTokenPair();
      prisma.user.findUnique.mockResolvedValue({
        ...userRecord,
        email: 'budi@gmail.com',
      });

      const result = await service.googleAuth('valid-token');

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs?.data.authProvider).toBe('google');
      expect(createArgs?.data.passwordHash).toBeNull();
      expect(result.user.email).toBe('budi@gmail.com');
      expect(result.created).toBe(true);
    });

    it('rejects an invalid id token with INVALID_CREDENTIALS', async () => {
      oauthClient.verifyIdToken.mockRejectedValue(new Error('bad token'));

      await expect(service.googleAuth('bad-token')).rejects.toMatchObject({
        code: AuthErrorCodes.INVALID_CREDENTIALS,
      });
    });
  });

  describe('refresh (rotation)', () => {
    it('revokes the old token and issues a new pair', async () => {
      const future = new Date(Date.now() + 86_400_000);
      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash',
        expiresAt: future,
        revokedAt: null,
        createdAt: new Date(),
      });
      mockTokenPair();

      const result = await service.refresh('a'.repeat(64));

      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rt-1' } }),
      );
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each([
      ['unknown token', null],
      [
        'revoked token',
        {
          id: 'rt-1', userId: 'user-1', tokenHash: 'h',
          expiresAt: new Date(Date.now() + 86_400_000),
          revokedAt: new Date(), createdAt: new Date(),
        },
      ],
      [
        'expired token',
        {
          id: 'rt-1', userId: 'user-1', tokenHash: 'h',
          expiresAt: new Date(Date.now() - 1000),
          revokedAt: null, createdAt: new Date(),
        },
      ],
    ])('returns INVALID_REFRESH_TOKEN for %s', async (_label, record) => {
      prisma.refreshToken.findUnique.mockResolvedValueOnce(
        record as never,
      );

      await expect(service.refresh('a'.repeat(64))).rejects.toMatchObject({
        code: AuthErrorCodes.INVALID_REFRESH_TOKEN,
      });
    });
  });

  describe('logout', () => {
    it('revokes a known active token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        id: 'rt-1', userId: 'user-1', tokenHash: 'h',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null, createdAt: new Date(),
      });

      await expect(service.logout('a'.repeat(64))).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).toHaveBeenCalled();
    });

    it('is idempotent for unknown or already-revoked tokens', async () => {
      prisma.refreshToken.findUnique.mockResolvedValueOnce(null);
      await expect(service.logout('a'.repeat(64))).resolves.toBeUndefined();

      prisma.refreshToken.findUnique.mockResolvedValueOnce({
        id: 'rt-1', userId: 'user-1', tokenHash: 'h',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: new Date(), createdAt: new Date(),
      });
      await expect(service.logout('a'.repeat(64))).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });

  describe('getMe', () => {
    it('returns the user detail without passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(userRecord);

      const result = await service.getMe('user-1');

      expect(result).toEqual({
        id: 'user-1',
        email: 'budi@example.com',
        name: 'Budi',
        authProvider: 'email',
        tier: 'free',
        createdAt: userRecord.createdAt.toISOString(),
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('throws UNAUTHORIZED when the user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.getMe('ghost')).rejects.toMatchObject({
        code: AuthErrorCodes.UNAUTHORIZED,
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/auth/auth.service.spec.ts`
Expected: FAIL — "Cannot find module './auth.service'".

- [ ] **Step 3: Write `src/auth/auth.service.ts`**

```ts
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

  async googleAuth(dto: GoogleAuthDto): Promise<AuthResult & { created: boolean }> {
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
    return { ...this.toPublicUser(user), createdAt: user.createdAt.toISOString() };
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
    if (!stored || stored.revokedAt || stored.expiresAt.getTime() <= Date.now()) {
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
```

- [ ] **Step 4: Write `src/auth/jwt.strategy.ts`**

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('ACCESS_TOKEN_SECRET') ?? '',
    });
  }

  async validate(payload: JwtPayload): Promise<{ userId: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true },
    });
    if (!user) {
      throw new UnauthorizedException('Silakan masuk terlebih dahulu');
    }
    return { userId: user.id };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/auth/auth.service.spec.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Verify lint, commit**

Run: `npm run lint` — Expected: clean.

Commit:
```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts src/auth/jwt.strategy.ts
git commit -m "feat: auth service with rotation, bcrypt, google verification"
```

---

### Task 6: AuthModule, JwtAuthGuard, AuthController, Swagger

**Files:**
- Create: `src/auth/auth.module.ts`
- Create: `src/auth/jwt-auth.guard.ts`
- Create: `src/auth/auth.controller.ts`
- Modify: `src/app.module.ts` (register `AuthModule`)
- Modify: `src/main.ts` (Swagger setup at `/api/docs`)

**Interfaces:**
- Consumes: `AuthService` (Task 5), DTOs (Task 4), `AllExceptionsFilter` semantics (Task 2).
- Produces: the six `/api/auth/*` endpoints matching contract v2 §5; `JwtAuthGuard` mapping passport failures to 401 `"Silakan masuk terlebih dahulu"`; Swagger UI at `/api/docs`.

- [ ] **Step 1: Write `src/auth/jwt-auth.guard.ts`**

```ts
import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser = { userId: string }>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw new UnauthorizedException('Silakan masuk terlebih dahulu');
    }
    return user;
  }
}
```

- [ ] **Step 2: Write `src/auth/auth.controller.ts`**

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Daftar dengan email + password (auto-login)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login dengan email + password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('google')
  @ApiOperation({ summary: 'Login/daftar via Google ID token' })
  google(@Body() dto: GoogleAuthDto) {
    return this.authService.googleAuth(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tukar refresh token dengan pasangan token baru' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke refresh token (idempotent)' })
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Profil user yang sedang login' })
  me(@Req() req: AuthenticatedRequest) {
    return this.authService.getMe(req.user.userId);
  }
}
```

NOTE: `register` and `google` intentionally have no `@HttpCode`, so NestJS returns 201 (contract: register → 201; google → 201 new user / 200 existing — the service returns the same shape; e2e asserts 201 for new users). `login`, `refresh`, `logout` are explicitly 200.

- [ ] **Step 3: Write `src/auth/auth.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { OAuth2Client } from 'google-auth-library';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
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
    {
      provide: 'GOOGLE_OAUTH_CLIENT',
      useFactory: (config: ConfigService) =>
        new OAuth2Client(config.get<string>('GOOGLE_CLIENT_ID')),
      inject: [ConfigService],
    },
  ],
})
export class AuthModule {}
```

- [ ] **Step 4: Register AuthModule in `src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 5: Add Swagger to `src/main.ts`** (replace the whole file)

```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, stopAtFirstError: true }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('Aria Backend API')
    .setDescription(
      'API untuk aplikasi Aria AI assistant. Semua response memakai envelope { success, message, data, error? } — lihat docs/2026-08-12-backend-auth-api-contract.md.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Aria backend listening on http://localhost:${port}/api`);
  console.log(`Swagger UI: http://localhost:${port}/api/docs`);
}

void bootstrap();
```

- [ ] **Step 6: Verify lint + build, commit**

Run: `npm run lint` — Expected: clean.
Run: `npm run build` — Expected: clean.

Commit:
```bash
git add src/auth/auth.module.ts src/auth/jwt-auth.guard.ts src/auth/auth.controller.ts src/app.module.ts src/main.ts
git commit -m "feat: auth endpoints with Swagger docs at /api/docs"
```

---

### Task 7: E2E tests (happy path, Google, validation)

**Files:**
- Create: `test/jest-e2e.json`
- Create: `test/setup-e2e-env.ts`
- Create: `test/test-utils.ts`
- Create: `test/auth.e2e-spec.ts`
- Create: `test/google-auth.e2e-spec.ts`
- Create: `test/validation.e2e-spec.ts`

**Interfaces:**
- Consumes: full app (`AppModule`), envelope shape (Task 2), all endpoints (Task 6). `TEST_DATABASE_URL` from `.env` overrides the schema's `DATABASE_URL` before Prisma connects.

- [ ] **Step 1: Write e2e infrastructure**

`test/jest-e2e.json`:
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.ts$": "ts-jest" },
  "setupFiles": ["<rootDir>/setup-e2e-env.ts"]
}
```

`test/setup-e2e-env.ts`:
```ts
import * as dotenv from 'dotenv';

dotenv.config();
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  throw new Error('TEST_DATABASE_URL is not set — check .env');
}
process.env.DATABASE_URL = testDbUrl;
```

`test/test-utils.ts`:
```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, stopAtFirstError: true }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

export async function resetDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

export const testUser = {
  email: 'budi@example.com',
  password: 'rahasia123',
  name: 'Budi',
};
```

- [ ] **Step 2: Write `test/auth.e2e-spec.ts`** (PRD §10.2 happy path)

```ts
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, resetDatabase, testUser } from './test-utils';

describe('Auth flow (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('GET /api/health returns the envelope with status ok', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      message: 'OK',
      data: { status: 'ok' },
    });
  });

  it('full flow: register → me → refresh (rotation) → logout', async () => {
    // 1. register → 201 + user + token pair
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    expect(registerRes.body.success).toBe(true);
    expect(registerRes.body.data.user).toMatchObject({
      email: testUser.email,
      name: testUser.name,
      authProvider: 'email',
      tier: 'free',
    });
    expect(registerRes.body.data.user).not.toHaveProperty('passwordHash');
    expect(registerRes.body.data.accessToken).toEqual(expect.any(String));
    expect(registerRes.body.data.refreshToken).toMatch(/^[0-9a-f]{64}$/);

    const { accessToken, refreshToken } = registerRes.body.data;

    // 2. GET /me with access token → 200, email matches, createdAt present
    const meRes = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meRes.body.success).toBe(true);
    expect(meRes.body.data.email).toBe(testUser.email);
    expect(meRes.body.data.createdAt).toEqual(expect.any(String));
    expect(meRes.body.data).not.toHaveProperty('passwordHash');

    // 3. refresh → 200 new pair; OLD refresh token must now be dead (rotation)
    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.data.accessToken).toEqual(expect.any(String));
    expect(refreshRes.body.data.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect(refreshRes.body.data).not.toHaveProperty('user');

    const newRefreshToken = refreshRes.body.data.refreshToken;
    expect(newRefreshToken).not.toBe(refreshToken);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect((res) => {
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('INVALID_REFRESH_TOKEN');
      });

    // 4. logout → 200; the new refresh token dies too
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: newRefreshToken })
      .expect((res) => {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, message: 'OK', data: null });
      });

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: newRefreshToken })
      .expect((res) => {
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('INVALID_REFRESH_TOKEN');
      });

    // logout is idempotent — second call still 200
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: newRefreshToken })
      .expect(200);
  });

  it('login with correct credentials → 200 with token pair', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(testUser.email);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('login with wrong password → 401 INVALID_CREDENTIALS', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(testUser)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: testUser.email, password: 'password-salah' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
    expect(res.body.message).toBe('Email atau password salah');
    expect(res.body.data).toBeNull();
  });

  it('GET /me without token → 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('UNAUTHORIZED');
    expect(res.body.message).toBe('Silakan masuk terlebih dahulu');
  });

  it('refresh with unknown token → 401 INVALID_REFRESH_TOKEN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'f'.repeat(64) })
      .expect(401);

    expect(res.body.error).toBe('INVALID_REFRESH_TOKEN');
  });
});
```

- [ ] **Step 3: Write `test/google-auth.e2e-spec.ts`** (PRD §10.3 — mocked ID-token verification)

```ts
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, resetDatabase } from './test-utils';

describe('Google auth (e2e)', () => {
  let app: INestApplication;

  const mockVerifyIdToken = (payload?: Record<string, unknown>): void => {
    const oauthClient = app.get('GOOGLE_OAUTH_CLIENT');
    oauthClient.verifyIdToken = jest.fn().mockResolvedValue({
      getPayload: () => payload,
    });
  };

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('creates a google user for a new email → 201', async () => {
    mockVerifyIdToken({ email: 'budi@gmail.com', name: 'Budi G' });

    const res = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'valid-token' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      email: 'budi@gmail.com',
      name: 'Budi G',
      authProvider: 'google',
      tier: 'free',
    });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('logs in an existing google user → 200', async () => {
    mockVerifyIdToken({ email: 'budi@gmail.com', name: 'Budi G' });

    await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'valid-token' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'valid-token' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('budi@gmail.com');
  });

  it('rejects an invalid id token → 401 INVALID_CREDENTIALS', async () => {
    const oauthClient = app.get('GOOGLE_OAUTH_CLIENT');
    oauthClient.verifyIdToken = jest
      .fn()
      .mockRejectedValue(new Error('invalid token'));

    const res = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'bad-token' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
    expect(res.body.message).toBe('Email atau password salah');
  });
});
```

- [ ] **Step 4: Write `test/validation.e2e-spec.ts`** (PRD §10.4)

```ts
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, resetDatabase, testUser } from './test-utils';

describe('Validation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('register with invalid email → 400 VALIDATION_ERROR with details', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...testUser, email: 'bukan-email' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('Periksa kembali isian kamu');
    expect(res.body.data.details).toEqual(expect.any(Array));
    expect(res.body.data.details.join(' ')).toContain('email');
  });

  it('register with short password (< 8) → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...testUser, password: 'pendek' })
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.data.details.join(' ')).toContain('password');
  });

  it('register with missing fields → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({})
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.data.details.length).toBeGreaterThanOrEqual(1);
  });

  it('login with invalid email → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'bukan-email', password: 'apa-saja' })
      .expect(400);
  });

  it('refresh with malformed token → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'bukan-hex' })
      .expect(400);
  });
});
```

- [ ] **Step 5: Prepare the test database, then run e2e**

Create the test DB once (psql, pgAdmin, or any client): `CREATE DATABASE aria_test;`

Then apply the migration recorded in Task 3: `npx prisma migrate deploy`
Expected: Prisma applies the `init_auth` migration to `aria_test` (using `TEST_DATABASE_URL` from `.env`). Do NOT use `prisma db push` — the migration file must stay the single source of truth for both databases.

Run: `npm run test:e2e`
Expected: ALL e2e tests PASS (3 suites: auth flow, google, validation).

If connection errors appear, confirm `TEST_DATABASE_URL` in `.env` matches the local PostgreSQL (`postgres`/`root`) and that `aria_test` exists.

- [ ] **Step 6: Commit**

```bash
git add test/
git commit -m "test: e2e suites for auth flow, google, and validation"
```

---

### Task 8: Rate limiting (Throttler) + final hardening

**Files:**
- Modify: `src/auth/auth.module.ts` (add ThrottlerModule + guard)
- Test: `test/throttler.e2e-spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: 20 req/min/IP limit on `/api/auth/*` returning 429 envelope `{ success: false, message: 'Terlalu banyak permintaan, coba lagi nanti', data: null, error: 'RATE_LIMIT_EXCEEDED' }`.

- [ ] **Step 1: Write the failing throttler e2e test** — `test/throttler.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, resetDatabase } from './test-utils';

describe('Rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks the 21st auth request within a minute with 429 envelope', async () => {
    let blocked = false;
    for (let i = 0; i < 25; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: `user${i}@example.com`, password: 'rahasia123' });

      if (res.status === 429) {
        blocked = true;
        expect(res.body).toEqual({
          success: false,
          message: 'Terlalu banyak permintaan, coba lagi nanti',
          data: null,
          error: 'RATE_LIMIT_EXCEEDED',
        });
        break;
      }
      expect(res.status).toBe(401); // INVALID_CREDENTIALS until limited
    }
    expect(blocked).toBe(true);
  }, 30000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config ./test/jest-e2e.json test/throttler.e2e-spec.ts --runInBand`
Expected: FAIL — all 25 requests return 401, `blocked` stays false (no throttler yet).

- [ ] **Step 3: Add ThrottlerModule + guard to `src/auth/auth.module.ts`** (replace the whole file)

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { OAuth2Client } from 'google-auth-library';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    ThrottlerModule.forRoot([
      { name: 'auth', ttl: 60_000, limit: 20 },
    ]),
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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: 'GOOGLE_OAUTH_CLIENT',
      useFactory: (config: ConfigService) =>
        new OAuth2Client(config.get<string>('GOOGLE_CLIENT_ID')),
      inject: [ConfigService],
    },
  ],
})
export class AuthModule {}
```

- [ ] **Step 4: Run the throttler test to verify it passes**

Run: `npx jest --config ./test/jest-e2e.json test/throttler.e2e-spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Run the FULL test suites**

Run: `npm run test` — Expected: all unit tests PASS.
Run: `npm run test:e2e` — Expected: all e2e suites PASS (auth, google, validation, throttler).

NOTE: the throttler is per-app-instance and in-memory; separate spec files create separate app instances, so no cross-suite interference. If a suite ever flakes on 429, it means 20+ auth requests ran in one app instance within a minute — raise that suite's request count awareness, do NOT raise the limit.

- [ ] **Step 6: Lint clean + manual smoke test**

Run: `npm run lint` — Expected: clean.

Manual smoke (keep the server running briefly):
```bash
npm run start:dev
```
In another terminal:
```bash
curl -s http://localhost:3000/api/health
# → {"success":true,"message":"OK","data":{"status":"ok"}}

curl -s -X POST http://localhost:3000/api/auth/register -H "Content-Type: application/json" -d "{\"email\":\"smoke@example.com\",\"password\":\"rahasia123\",\"name\":\"Smoke\"}"
# → 201 envelope with user + accessToken + refreshToken
```
Open `http://localhost:3000/api/docs` in a browser — Expected: Swagger UI listing register, login, google, refresh, logout, me (with lock icon), health.

Stop the dev server (Ctrl+C).

- [ ] **Step 7: Final commit**

```bash
git add src/auth/auth.module.ts test/throttler.e2e-spec.ts
git commit -m "feat: rate limit auth routes at 20 req/min with envelope 429"
```

---

## Definition of Done cross-check (PRD §11)

- `npx prisma migrate dev` → migration created and applied — Task 3 Step 4.
- `npm run start:dev` → server on port 3000 with `/api` prefix — Task 6 Step 6 / Task 8 Step 6.
- Swagger UI at `http://localhost:3000/api/docs` — Task 6 Step 5, verified Task 8 Step 6.
- All endpoints per contract — Task 6 + Task 7 e2e assertions mirror the contract tables.
- `npm run test` passes — Task 8 Step 5.
- `npm run test:e2e` passes — Task 8 Step 5.
- `npm run lint` clean — Task 8 Step 6.
- (PRD's `docker compose up -d` item is N/A — replaced by the developer's local PostgreSQL per user instruction.)

